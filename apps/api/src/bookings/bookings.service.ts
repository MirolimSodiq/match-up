import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { SIGNING_KEYS, type SigningKeys } from '../config/keys';
import { AppError } from '../common/errors';
import { decodeCursor, encodeCursor } from '../common/http';
import type { Locale } from '../common/i18n';
import { signCompact } from '../common/jwt';
import { money } from '../common/money';
import { emit } from '../common/outbox';
import { CheckoutService, type CheckoutProvider } from '../commerce/checkout.service';
import { SeatsService } from '../commerce/seats.service';
import { WalletService } from '../commerce/wallet.service';
import { DB, type Db, iso, one, pgError, PG, rows, type Tx } from '../db/db';
import { UsersService } from '../identity/users.service';
import { MATCH_JOINS, MATCH_SUMMARY_COLUMNS, MatchesService, type MatchSummaryRow, toMatchSummary } from '../matches/matches.service';
import { WaiversService } from '../waivers/waivers.module';
import { decideRefund, type PolicyRule, ruleLabel } from './policy';

export interface CreateBookingInput {
  match_id: string;
  seats: number;
  guests: { name: string }[];
  payment_method: 'payme' | 'click' | 'uzum' | 'stripe' | 'paypal' | 'wallet';
  use_wallet: boolean;
  waiver_signature_id: string;
  return_url?: string;
}

interface BookingRow {
  id: string;
  match_id: string;
  user_id: string;
  status: string;
  seats: number;
  unit_price_amount: number;
  discount_amount: number;
  wallet_applied_amount: number;
  total_amount: number;
  currency: string;
  expires_at: string | null;
  confirmed_at: string | null;
  idempotency_key: string;
}

const LEVELS = ['beginner', 'intermediate', 'advanced', 'pro'];

@Injectable()
export class BookingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SIGNING_KEYS) private readonly keys: SigningKeys,
    private readonly seats: SeatsService,
    private readonly wallet: WalletService,
    private readonly checkout: CheckoutService,
    private readonly matches: MatchesService,
    private readonly waivers: WaiversService,
    private readonly users: UsersService,
  ) {}

  // -------------------------------------------------------------------------
  // Ko'rinish
  // -------------------------------------------------------------------------
  private async present(b: BookingRow, locale: Locale) {
    const m = await one<MatchSummaryRow>(this.db, sql`SELECT ${MATCH_SUMMARY_COLUMNS} FROM matches m ${MATCH_JOINS} WHERE m.id = ${b.match_id}`);
    return {
      id: b.id,
      match_id: b.match_id,
      status: b.status,
      seats: b.seats,
      unit_price: money(b.unit_price_amount, b.currency, locale),
      discount: money(b.discount_amount, b.currency, locale),
      wallet_applied: money(b.wallet_applied_amount, b.currency, locale),
      total: money(b.total_amount, b.currency, locale),
      expires_at: b.status === 'pending_payment' ? iso(b.expires_at) : null,
      confirmed_at: iso(b.confirmed_at),
      match: m ? toMatchSummary(m, locale) : undefined,
    };
  }

  private async getOwned(bookingId: string, userId: string): Promise<BookingRow> {
    const b = await one<BookingRow>(this.db, sql`SELECT * FROM bookings WHERE id = ${bookingId} AND user_id = ${userId}`);
    if (!b) throw new AppError('NOT_FOUND');
    return b;
  }

  async get(bookingId: string, userId: string, locale: Locale) {
    return this.present(await this.getOwned(bookingId, userId), locale);
  }

  async listMine(userId: string, scope: 'upcoming' | 'past', cursor: string | undefined, limit: number, locale: Locale) {
    const cur = decodeCursor<{ t: string; id: string }>(cursor);
    const upcoming = scope === 'upcoming';
    const conds: SQL[] = [sql`b.user_id = ${userId}`];
    conds.push(
      upcoming
        ? sql`b.status IN ('pending_payment', 'confirmed') AND m.ends_at > now()`
        : sql`(b.status IN ('completed', 'cancelled', 'expired') OR m.ends_at <= now())`,
    );
    if (cur) {
      conds.push(
        upcoming
          ? sql`(m.starts_at, b.id) > (${cur.t}::timestamptz, ${cur.id}::uuid)`
          : sql`(m.starts_at, b.id) < (${cur.t}::timestamptz, ${cur.id}::uuid)`,
      );
    }
    const list = await rows<BookingRow & { starts_at: string }>(
      this.db,
      sql`SELECT b.*, m.starts_at FROM bookings b JOIN matches m ON m.id = b.match_id
          WHERE ${sql.join(conds, sql` AND `)}
          ORDER BY m.starts_at ${upcoming ? sql`ASC` : sql`DESC`}, b.id ${upcoming ? sql`ASC` : sql`DESC`}
          LIMIT ${limit + 1}`,
    );
    const page = list.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await Promise.all(page.map((b) => this.present(b, locale))),
      next_cursor: list.length > limit && last ? encodeCursor({ t: last.starts_at, id: last.id }) : null,
    };
  }

  // -------------------------------------------------------------------------
  // Yaratish: waiver -> atomik hold -> checkout (yoki wallet bilan darhol confirm)
  // -------------------------------------------------------------------------
  async create(userId: string, input: CreateBookingInput, idempotencyKey: string, locale: Locale) {
    const existing = await one<BookingRow>(
      this.db,
      sql`SELECT * FROM bookings WHERE user_id = ${userId} AND idempotency_key = ${idempotencyKey}`,
    );
    if (existing) return this.replay(existing, input, locale);

    if (input.guests.length !== input.seats - 1) {
      throw new AppError('VALIDATION_FAILED', {}, [
        { field: 'guests', code: 'count_mismatch', message: 'seats = 1 + mehmonlar soni bo\'lishi kerak' },
      ]);
    }

    const m = await this.matches.summaryRow(input.match_id);
    if (m.status === 'full') throw new AppError('MATCH_FULL');
    if (m.status !== 'open') throw new AppError('BOOKING_CLOSED');

    const user = await this.users.get(userId);
    const minAge = (await one<{ min_age: number }>(this.db, sql`SELECT min_age FROM matches WHERE id = ${m.id}`))!.min_age;
    const age = UsersService.ageAt(user.birth_date, new Date(iso(m.starts_at)!));
    if (age !== undefined && age < minAge) throw new AppError('AGE_RESTRICTED');

    const profile = await one<{ self_level: string }>(
      this.db,
      sql`SELECT self_level FROM player_sport_profiles WHERE user_id = ${userId} AND sport_id = ${m.sport_id as number}`,
    );
    if (profile) {
      const lvl = LEVELS.indexOf(profile.self_level);
      if ((m.skill_min && lvl < LEVELS.indexOf(m.skill_min)) || (m.skill_max && lvl > LEVELS.indexOf(m.skill_max))) {
        throw new AppError('SKILL_LEVEL_MISMATCH');
      }
    }

    const signature = await this.waivers.validSignature(userId, m.waiver_template_code as string, input.waiver_signature_id);
    if (!signature) throw new AppError('WAIVER_REQUIRED');

    const payWithWallet = input.payment_method === 'wallet' || input.use_wallet;
    const available = await this.checkout.availableProviders(m.id);
    const method = payWithWallet ? 'wallet' : input.payment_method;
    if (!available.includes(method)) throw new AppError('PAYMENT_METHOD_UNAVAILABLE');
    const total = m.price_amount * input.seats;
    if (payWithWallet && (await this.wallet.balance(userId, m.currency)) < total) throw new AppError('WALLET_INSUFFICIENT');

    let bookingId: string;
    try {
      bookingId = await this.db.transaction(async (tx) => {
        const held = await this.seats.hold(tx, {
          matchId: m.id,
          userId,
          seats: input.seats,
          guests: input.guests.map((g) => g.name),
          signatureId: signature.id,
          idempotencyKey,
        });
        if (!held) throw await this.holdFailure(tx, m.id, userId);

        if (payWithWallet) {
          await this.wallet.debit(tx, { userId, currency: held.currency, amount: held.total_amount, type: 'booking_debit', bookingId: held.id });
          await tx.execute(
            sql`UPDATE bookings SET wallet_applied_amount = total_amount, total_amount = 0 WHERE id = ${held.id}`,
          );
          await tx.execute(
            sql`INSERT INTO payments (booking_id, user_id, provider, amount, currency, status, succeeded_at)
                VALUES (${held.id}, ${userId}, 'wallet', ${held.total_amount}, ${held.currency}, 'succeeded', now())`,
          );
          const outcome = await this.seats.confirmPaid(tx, held.id);
          if (outcome !== 'confirmed') throw new AppError('INVALID_STATE');
        } else {
          const co = this.checkout.buildRedirect(method as CheckoutProvider, {
            bookingId: held.id,
            amount: held.total_amount,
            currency: held.currency,
            returnUrl: input.return_url,
            locale,
          });
          await tx.execute(
            sql`INSERT INTO payments (booking_id, user_id, provider, amount, currency, status, checkout_url)
                VALUES (${held.id}, ${userId}, ${method}, ${held.total_amount}, ${held.currency}, 'created', ${co.url})`,
          );
        }
        return held.id;
      });
    } catch (err) {
      const pg = pgError(err);
      if (pg?.code === PG.UNIQUE_VIOLATION && pg.constraint === 'match_participants_one_active_per_user') {
        throw new AppError('ALREADY_BOOKED');
      }
      if (pg?.code === PG.UNIQUE_VIOLATION && pg.constraint === 'bookings_user_id_idempotency_key_key') {
        // Parallel takroriy so'rov — birinchisi yutdi
        const again = await one<BookingRow>(
          this.db,
          sql`SELECT * FROM bookings WHERE user_id = ${userId} AND idempotency_key = ${idempotencyKey}`,
        );
        if (again) return this.replay(again, input, locale);
      }
      throw err;
    }
    const b = await this.getOwned(bookingId, userId);
    return { booking: await this.present(b, locale), checkout: await this.checkoutFor(b) };
  }

  private async holdFailure(tx: Tx, matchId: string, userId: string): Promise<AppError> {
    const mine = await one(
      tx,
      sql`SELECT 1 FROM match_participants WHERE match_id = ${matchId} AND user_id = ${userId}
          AND status IN ('held', 'confirmed', 'checked_in', 'no_show')`,
    );
    if (mine) return new AppError('ALREADY_BOOKED');
    const closed = await one(tx, sql`SELECT 1 FROM matches WHERE id = ${matchId} AND (status <> 'open' OR now() >= booking_closes_at)`);
    const full = await one(tx, sql`SELECT 1 FROM matches WHERE id = ${matchId} AND status = 'full'`);
    if (closed && !full) return new AppError('BOOKING_CLOSED');
    return new AppError('MATCH_FULL');
  }

  private async replay(b: BookingRow, input: CreateBookingInput, locale: Locale) {
    if (b.match_id !== input.match_id || b.seats !== input.seats) throw new AppError('IDEMPOTENCY_CONFLICT');
    return { booking: await this.present(b, locale), checkout: await this.checkoutFor(b) };
  }

  private async checkoutFor(b: BookingRow) {
    if (b.status !== 'pending_payment') return { type: 'none' as const };
    const p = await one<{ provider: string; checkout_url: string | null }>(
      this.db,
      sql`SELECT provider, checkout_url FROM payments WHERE booking_id = ${b.id} AND checkout_url IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
    );
    if (!p?.checkout_url) return { type: 'none' as const };
    return { type: 'redirect' as const, provider: p.provider, url: p.checkout_url, expires_at: iso(b.expires_at) };
  }

  // -------------------------------------------------------------------------
  // Bekor qilish (cancellation policy bo'yicha refund)
  // -------------------------------------------------------------------------
  async cancel(userId: string, bookingId: string, body: { reason?: string; refund_destination?: 'original_method' | 'wallet' }, locale: Locale) {
    const result = await this.db.transaction(async (tx) => {
      const b = await this.seats.lockBooking(tx, bookingId);
      if (!b || b.user_id !== userId) throw new AppError('NOT_FOUND');
      if (b.status === 'cancelled') return { refund: null };
      if (b.status !== 'pending_payment' && b.status !== 'confirmed') throw new AppError('INVALID_STATE');
      if (b.match_started) throw new AppError('INVALID_STATE');

      if (b.status === 'pending_payment') {
        await this.seats.release(tx, b.id, 'cancelled', body.reason ?? 'user_cancel', userId);
        await tx.execute(sql`UPDATE payments SET status = 'cancelled', cancelled_at = now() WHERE booking_id = ${b.id} AND status = 'created'`);
        return { refund: null };
      }

      const m = await one<{ hours_before: number; rules: PolicyRule[] }>(
        tx,
        sql`SELECT extract(epoch FROM m.starts_at - now()) / 3600 AS hours_before, cp.rules
            FROM matches m JOIN cancellation_policies cp ON cp.id = m.cancellation_policy_id WHERE m.id = ${b.match_id}`,
      );
      const decision = decideRefund(m!.rules, Number(m!.hours_before));
      await this.seats.release(tx, b.id, 'cancelled', body.reason ?? 'user_cancel', userId);

      const paid = b.total_amount + b.wallet_applied_amount;
      const amount = Math.floor((paid * decision.refundPct) / 100);
      if (amount <= 0) return { refund: null };

      // Wallet bilan to'langan yoki policy faqat wallet'ga ruxsat bergan bo'lsa — wallet; foydalanuvchi har doim wallet'ni tanlashi mumkin
      const walletOnly = b.total_amount === 0 || decision.destination === 'wallet';
      const destination = walletOnly || body.refund_destination === 'wallet' ? 'wallet' : 'original_method';
      const payment = await one<{ id: string }>(
        tx,
        sql`SELECT id FROM payments WHERE booking_id = ${b.id} AND status = 'succeeded' AND provider <> 'wallet'
            ORDER BY created_at DESC LIMIT 1`,
      );
      const refund = await one<{ id: string }>(
        tx,
        sql`INSERT INTO refunds (payment_id, booking_id, amount, currency, destination, status, reason, initiated_by, completed_at)
            VALUES (${payment?.id ?? null}, ${b.id}, ${amount}, ${b.currency}, ${destination},
                    ${destination === 'wallet' ? 'succeeded' : 'pending'}, 'user_cancel', ${userId},
                    ${destination === 'wallet' ? sql`now()` : null})
            RETURNING id`,
      );
      if (destination === 'wallet') {
        await this.wallet.credit(tx, { userId, currency: b.currency, amount, type: 'refund_credit', bookingId: b.id, refundId: refund!.id });
        await emit(tx, 'refund', refund!.id, 'RefundIssued', { booking_id: b.id, amount, destination });
      } else {
        // Provider refund (Payme Subscribe API / Click) — RefundRequested consumer'i bajaradi
        await emit(tx, 'refund', refund!.id, 'RefundRequested', { booking_id: b.id, payment_id: payment?.id, amount });
      }
      return {
        refund: {
          amount: money(amount, b.currency, locale),
          destination,
          status: destination === 'wallet' ? 'succeeded' : 'pending',
          policy_rule: ruleLabel(decision.rule),
        },
      };
    });
    return { booking: await this.get(bookingId, userId, locale), refund: result.refund };
  }

  // -------------------------------------------------------------------------
  // QR chipta (Ed25519, host app offline tekshiradi)
  // -------------------------------------------------------------------------
  async tickets(userId: string, bookingId: string) {
    const b = await this.getOwned(bookingId, userId);
    if (b.status !== 'confirmed') throw new AppError('INVALID_STATE');
    const list = await rows<{ id: string; holder: string; ends_at: string }>(
      this.db,
      sql`SELECT mp.id, coalesce(u.display_name, mp.guest_name) AS holder, m.ends_at
          FROM match_participants mp
          JOIN matches m ON m.id = mp.match_id
          LEFT JOIN users u ON u.id = mp.user_id
          WHERE mp.booking_id = ${b.id} AND mp.status IN ('confirmed', 'checked_in')
          ORDER BY mp.created_at`,
    );
    return {
      tickets: list.map((t) => {
        const exp = Math.floor(new Date(iso(t.ends_at)!).getTime() / 1000) + 2 * 3600;
        return {
          participant_id: t.id,
          holder_name: t.holder,
          qr_payload: signCompact('mu1', { p: t.id, m: b.match_id, e: exp }, this.keys.ticket.privateKey),
          expires_at: new Date(exp * 1000).toISOString(),
        };
      }),
    };
  }
}
