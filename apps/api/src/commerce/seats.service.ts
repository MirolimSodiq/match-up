import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { emit } from '../common/outbox';
import { DB, type Db, one, pgError, PG, rows, type Tx } from '../db/db';

export interface HeldBooking {
  id: string;
  match_id: string;
  seats: number;
  total_amount: number;
  currency: string;
}

export interface LockedBooking {
  id: string;
  user_id: string;
  match_id: string;
  seats: number;
  status: 'pending_payment' | 'confirmed' | 'cancelled' | 'expired' | 'completed';
  total_amount: number;
  wallet_applied_amount: number;
  currency: string;
  match_started: boolean;
}

export type ConfirmOutcome = 'confirmed' | 'already_confirmed' | 'no_seat' | 'not_payable';

/**
 * Joylar inventari — db/queries/*.sql dagi tekshirilgan mantiqning kod ko'rinishi.
 * Barcha metodlar chaqiruvchining tranzaksiyasi ichida ishlaydi.
 */
@Injectable()
export class SeatsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Atomik hold (hold_seat.sql): shartli UPDATE matches qatorini lock qiladi va WHERE'ni
   * yangi qiymat bilan qayta tekshiradi -> oversell imkonsiz. null = joy yo'q / yopiq.
   */
  async hold(
    tx: Tx,
    p: { matchId: string; userId: string; seats: number; guests: string[]; signatureId: string; idempotencyKey: string },
  ): Promise<HeldBooking | null> {
    const held = await one<{ id: string; price_amount: number; currency: string }>(
      tx,
      sql`UPDATE matches SET held_slots = held_slots + ${p.seats}
          WHERE id = ${p.matchId} AND status = 'open' AND now() < booking_closes_at
            AND held_slots + confirmed_slots + ${p.seats}
                + (SELECT count(*) FROM match_waitlist w           -- kutish ro'yxati takliflari: 10 daq eksklyuziv
                   WHERE w.match_id = matches.id AND w.status = 'notified'
                     AND w.offer_expires_at > now() AND w.user_id <> ${p.userId}) <= max_players
          RETURNING id, price_amount, currency`,
    );
    if (!held) return null;
    const booking = await one<HeldBooking>(
      tx,
      sql`INSERT INTO bookings (user_id, match_id, seats, unit_price_amount, total_amount, currency,
                                waiver_signature_id, idempotency_key, expires_at)
          VALUES (${p.userId}, ${held.id}, ${p.seats}, ${held.price_amount}, ${held.price_amount * p.seats}, ${held.currency},
                  ${p.signatureId}, ${p.idempotencyKey}, now() + make_interval(mins => ${this.env.HOLD_MINUTES}))
          RETURNING id, match_id, seats, total_amount, currency`,
    );
    await tx.execute(
      sql`INSERT INTO match_participants (match_id, booking_id, user_id, status, source)
          VALUES (${held.id}, ${booking!.id}, ${p.userId}, 'held', 'booking')`,
    );
    for (const guest of p.guests) {
      await tx.execute(
        sql`INSERT INTO match_participants (match_id, booking_id, guest_name, status, source)
            VALUES (${held.id}, ${booking!.id}, ${guest}, 'held', 'booking')`,
      );
    }
    await emit(tx, 'booking', booking!.id, 'BookingHeld', { match_id: held.id, seats: p.seats });
    return booking!;
  }

  async lockBooking(tx: Tx, bookingId: string): Promise<LockedBooking | undefined> {
    return one<LockedBooking>(
      tx,
      sql`SELECT b.id, b.user_id, b.match_id, b.seats, b.status, b.total_amount, b.wallet_applied_amount, b.currency,
                 m.starts_at <= now() AS match_started
          FROM bookings b JOIN matches m ON m.id = b.match_id
          WHERE b.id = ${bookingId}
          FOR UPDATE OF b`,
    );
  }

  /**
   * Muddati o'tgan (sweeper ozod qilgan) booking uchun joyni qayta egallashga urinish —
   * "late payment" holati. Savepoint ichida: roster unique index buzilsa ham tashqi tx tirik qoladi.
   */
  async rehold(tx: Tx, b: LockedBooking): Promise<boolean> {
    try {
      return await tx.transaction(async (sp) => {
        const ok = await one(
          sp,
          sql`UPDATE matches SET held_slots = held_slots + ${b.seats}
              WHERE id = ${b.match_id} AND status = 'open' AND starts_at > now()
                AND held_slots + confirmed_slots + ${b.seats} <= max_players
              RETURNING id`,
        );
        if (!ok) return false;
        await sp.execute(sql`UPDATE match_participants SET status = 'held' WHERE booking_id = ${b.id} AND status = 'expired'`);
        await sp.execute(
          sql`UPDATE bookings SET status = 'pending_payment', expires_at = now() + make_interval(mins => ${this.env.HOLD_MINUTES})
              WHERE id = ${b.id}`,
        );
        b.status = 'pending_payment';
        return true;
      });
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) return false;
      throw err;
    }
  }

  /** Hold'ni uzaytirish (masalan, Payme CreateTransaction kelganda). */
  async extendHold(tx: Tx, bookingId: string): Promise<void> {
    await tx.execute(
      sql`UPDATE bookings SET expires_at = greatest(expires_at, now() + make_interval(mins => ${this.env.HOLD_MINUTES}))
          WHERE id = ${bookingId} AND status = 'pending_payment'`,
    );
  }

  /** Booking to'lovga yaroqlimi: pending — ha; expired — joy bo'lsa qayta hold; qolganlari — yo'q. */
  async ensurePayable(tx: Tx, b: LockedBooking): Promise<'ok' | 'no_seat' | 'not_payable'> {
    if (b.status === 'pending_payment') return 'ok';
    if (b.status === 'expired') return (await this.rehold(tx, b)) ? 'ok' : 'no_seat';
    return 'not_payable';
  }

  /** To'lov muvaffaqiyatli (confirm_payment.sql): held -> confirmed, kerak bo'lsa match FULL. */
  async confirmPaid(tx: Tx, bookingId: string): Promise<ConfirmOutcome> {
    const b = await this.lockBooking(tx, bookingId);
    if (!b) return 'not_payable';
    if (b.status === 'confirmed') return 'already_confirmed';
    const payable = await this.ensurePayable(tx, b);
    if (payable !== 'ok') return payable;

    await tx.execute(sql`UPDATE match_participants SET status = 'confirmed' WHERE booking_id = ${b.id} AND status = 'held'`);
    const m = await one<{ status: string }>(
      tx,
      sql`UPDATE matches
             SET held_slots = held_slots - ${b.seats},
                 confirmed_slots = confirmed_slots + ${b.seats},
                 status = CASE WHEN confirmed_slots + ${b.seats} = max_players THEN 'full'::match_status ELSE status END
           WHERE id = ${b.match_id}
           RETURNING status`,
    );
    await tx.execute(sql`UPDATE bookings SET status = 'confirmed', confirmed_at = now(), expires_at = NULL WHERE id = ${b.id}`);
    await emit(tx, 'booking', b.id, 'BookingConfirmed', { match_id: b.match_id, user_id: b.user_id, seats: b.seats });
    if (m?.status === 'full') await emit(tx, 'match', b.match_id, 'MatchFull');
    return 'confirmed';
  }

  /**
   * Joylarni qaytarish: pending -> hold ozod qilinadi; confirmed -> confirmed joy qaytadi, FULL -> OPEN.
   * Qaytaradi: oldingi status (yoki undefined — o'zgartirish bo'lmadi).
   */
  async release(
    tx: Tx,
    bookingId: string,
    to: 'expired' | 'cancelled',
    reason: string,
    cancelledBy?: string,
    opts: { onlyPending?: boolean } = {},
  ): Promise<'pending_payment' | 'confirmed' | undefined> {
    const b = await this.lockBooking(tx, bookingId);
    if (!b || (b.status !== 'pending_payment' && b.status !== 'confirmed')) return undefined;
    // To'lov bekor bo'lganda faqat hold ozod qilinadi — boshqa usul bilan tasdiqlangan booking'ga tegilmaydi
    if (opts.onlyPending && b.status !== 'pending_payment') return undefined;
    const prev = b.status;
    const participantFrom = prev === 'pending_payment' ? 'held' : 'confirmed';
    const participantTo = to === 'expired' ? 'expired' : 'cancelled';

    await tx.execute(
      sql`UPDATE bookings
             SET status = ${to}::booking_status,
                 cancelled_at = CASE WHEN ${to} = 'cancelled' THEN now() END,
                 cancelled_by = ${cancelledBy ?? null},
                 cancel_reason = ${reason}
           WHERE id = ${b.id}`,
    );
    await tx.execute(
      sql`UPDATE match_participants SET status = ${participantTo}::participant_status
          WHERE booking_id = ${b.id} AND status = ${participantFrom}::participant_status`,
    );
    if (prev === 'pending_payment') {
      await tx.execute(sql`UPDATE matches SET held_slots = held_slots - ${b.seats} WHERE id = ${b.match_id}`);
    } else {
      await tx.execute(
        sql`UPDATE matches
               SET confirmed_slots = confirmed_slots - ${b.seats},
                   status = CASE WHEN status = 'full' AND starts_at > now() THEN 'open'::match_status ELSE status END
             WHERE id = ${b.match_id}`,
      );
    }
    await emit(tx, 'booking', b.id, to === 'expired' ? 'BookingExpired' : 'BookingCancelled', {
      match_id: b.match_id,
      seats: b.seats,
      previous_status: prev,
      reason,
    });
    await emit(tx, 'match', b.match_id, 'SlotsReleased', { seats: b.seats });
    return prev;
  }

  /** Hold sweeper (expire_holds.sql). BullMQ har 30 soniyada chaqiradi. */
  async expireDue(limit = 500): Promise<number> {
    const due = await rows<{ id: string }>(
      this.db,
      sql`SELECT id FROM bookings WHERE status = 'pending_payment' AND expires_at < now() ORDER BY expires_at LIMIT ${limit}`,
    );
    let n = 0;
    for (const { id } of due) {
      // Har booking alohida tranzaksiyada: webhook bilan poyga bo'lsa, lockBooking navbatga qo'yadi
      const done = await this.db.transaction(async (tx) => {
        const b = await this.lockBooking(tx, id);
        if (!b || b.status !== 'pending_payment') return false;
        const still = await one(tx, sql`SELECT 1 FROM bookings WHERE id = ${id} AND expires_at < now()`);
        if (!still) return false;
        return !!(await this.release(tx, id, 'expired', 'hold_timeout'));
      });
      if (done) n++;
    }
    return n;
  }
}
