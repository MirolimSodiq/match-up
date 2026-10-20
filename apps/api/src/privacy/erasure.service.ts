import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { audit } from '../admin/audit';
import { decideRefund, type PolicyRule } from '../bookings/policy';
import { SeatsService } from '../commerce/seats.service';
import { WalletService } from '../commerce/wallet.service';
import { emit } from '../common/outbox';
import { DB, type Db, iso, one, rows, type Tx } from '../db/db';
import { FILE_STORAGE, type FileStorage } from './storage';

/** Erasure bajarilmasligi sababi (foydalanuvchiga va support'ga ko'rsatiladi). */
export type BlockedReason =
  | { code: 'wallet_balance'; amount: number; currency: string }
  | { code: 'active_host_assignment'; match_code: string; starts_at: string | null; status: string };

class ErasureBlocked extends Error {
  constructor(readonly reasons: BlockedReason[]) {
    super('erasure_blocked');
  }
}

export type ErasureOutcome = 'erased' | 'blocked' | 'skipped';

/**
 * GDPR Art. 17: grace muddati (ERASURE_GRACE_DAYS) o'tgan so'rovlar uchun anonimlashtirish.
 *
 *  - users: telefon, email, ismlar, tug'ilgan sana, avatar -> NULL; display_name = 'Deleted user'; status = deleted.
 *  - O'chiriladi: auth_identities, user_sessions, device_tokens, highlight_tags, eksport fayllari.
 *  - O'zgarmaydi (huquqiy dalil / soliq): consents, waiver_signatures, payments, refunds, wallet ledger.
 *  - Kelgusi booking'lar cancellation policy bo'yicha bekor qilinadi.
 *  - Bloklanadi: hamyonda balans (pul qaytarilishi kerak) yoki faol host tayinlovi.
 * Hammasi bitta tranzaksiyada; bloklansa — hech narsa o'zgarmaydi, sababi so'rovga yoziladi va keyingi
 * ishga tushishda qayta tekshiriladi.
 */
@Injectable()
export class ErasureService {
  private readonly log = new Logger('Erasure');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly seats: SeatsService,
    private readonly wallet: WalletService,
  ) {}

  /** BullMQ `dsr-erasures`: muddati yetgan so'rovlar. */
  async run(limit = 50): Promise<{ erased: number; blocked: number }> {
    const due = await rows<{ id: string }>(
      this.db,
      sql`SELECT id FROM data_subject_requests
          WHERE type = 'erasure' AND status IN ('received', 'in_progress') AND due_at <= now()
          ORDER BY due_at LIMIT ${limit}`,
    );
    const result = { erased: 0, blocked: 0 };
    for (const { id } of due) {
      try {
        const outcome = await this.eraseOne(id);
        if (outcome === 'erased') result.erased++;
        if (outcome === 'blocked') result.blocked++;
      } catch (err) {
        this.log.error(`Erasure ${id} bajarilmadi: ${(err as Error).message}`);
      }
    }
    return result;
  }

  async eraseOne(requestId: string): Promise<ErasureOutcome> {
    let exportFiles: string[] = [];
    try {
      const done = await this.db.transaction(async (tx) => {
        const r = await one<{ id: string; user_id: string }>(
          tx,
          sql`SELECT id, user_id FROM data_subject_requests
              WHERE id = ${requestId} AND type = 'erasure' AND status IN ('received', 'in_progress') AND due_at <= now()
              FOR UPDATE SKIP LOCKED`,
        );
        if (!r) return false;
        // User qatori lock: parallel booking/wallet operatsiyalari erasure bilan aralashmaydi
        await tx.execute(sql`SELECT 1 FROM users WHERE id = ${r.user_id} FOR UPDATE`);

        const blockers = await this.hostBlockers(tx, r.user_id);
        const cancelled = await this.cancelUpcomingBookings(tx, r.user_id);
        // Balans booking refund'laridan KEYIN tekshiriladi: hamyon bilan to'langan kelgusi o'yin ham pul qarzi
        const balances = await rows<{ currency: string; balance: number }>(
          tx,
          sql`SELECT currency, balance FROM wallet_accounts WHERE user_id = ${r.user_id} AND balance > 0 ORDER BY currency`,
        );
        for (const b of balances) blockers.push({ code: 'wallet_balance', amount: Number(b.balance), currency: b.currency });
        if (blockers.length) throw new ErasureBlocked(blockers);

        exportFiles = await this.anonymize(tx, r.user_id, r.id, cancelled);
        return true;
      });
      if (!done) return 'skipped';
    } catch (err) {
      if (!(err instanceof ErasureBlocked)) throw err;
      await this.db.execute(
        sql`UPDATE data_subject_requests SET blocked_reasons = ${JSON.stringify(err.reasons)}::jsonb, blocked_at = now()
            WHERE id = ${requestId} AND status IN ('received', 'in_progress')`,
      );
      this.log.warn(`Erasure ${requestId} bloklandi: ${err.reasons.map((r) => r.code).join(', ')}`);
      return 'blocked';
    }
    // Fayllar commit'dan keyin o'chiriladi (rollback bo'lsa eksport saqlanib qoladi)
    for (const key of exportFiles) await this.storage.remove(key).catch(() => undefined);
    return 'erased';
  }

  /** Faol host tayinlovi (qabul qilingan / yetib kelgan) — o'yin o'tmaguncha erasure kutadi. */
  private async hostBlockers(tx: Tx, userId: string): Promise<BlockedReason[]> {
    const active = await rows<{ public_code: string; starts_at: string; status: string }>(
      tx,
      sql`SELECT m.public_code, m.starts_at, a.status
          FROM host_assignments a JOIN matches m ON m.id = a.match_id
          WHERE a.host_user_id = ${userId} AND a.status IN ('accepted', 'arrived') AND m.status NOT IN ('completed', 'cancelled')
          ORDER BY m.starts_at`,
    );
    return active.map((a) => ({ code: 'active_host_assignment', match_code: a.public_code, starts_at: iso(a.starts_at), status: a.status }));
  }

  /**
   * Kelgusi booking'lar: hold -> ozod; tasdiqlangan -> policy bo'yicha refund foizi. Provider orqali to'langan
   * qism kartaga qaytadi (anonim akkauntning hamyonini hech kim ishlata olmaydi), hamyondan to'langan qism —
   * hamyonga (natijada balans erasure'ni bloklaydi va support pulni qaytaradi).
   */
  private async cancelUpcomingBookings(tx: Tx, userId: string): Promise<{ booking_id: string; refund_amount: number }[]> {
    const upcoming = await rows<{ id: string }>(
      tx,
      sql`SELECT b.id FROM bookings b JOIN matches m ON m.id = b.match_id
          WHERE b.user_id = ${userId} AND b.status IN ('pending_payment', 'confirmed') AND m.starts_at > now()
          ORDER BY m.starts_at`,
    );
    const out: { booking_id: string; refund_amount: number }[] = [];
    for (const { id } of upcoming) {
      const b = await this.seats.lockBooking(tx, id);
      if (!b || (b.status !== 'pending_payment' && b.status !== 'confirmed') || b.match_started) continue;
      if (b.status === 'pending_payment') {
        await this.seats.release(tx, b.id, 'cancelled', 'account_erasure');
        await tx.execute(sql`UPDATE payments SET status = 'cancelled', cancelled_at = now() WHERE booking_id = ${b.id} AND status = 'created'`);
        out.push({ booking_id: b.id, refund_amount: 0 });
        continue;
      }
      const m = await one<{ hours_before: number; rules: PolicyRule[] }>(
        tx,
        sql`SELECT extract(epoch FROM m.starts_at - now()) / 3600 AS hours_before, cp.rules
            FROM matches m JOIN cancellation_policies cp ON cp.id = m.cancellation_policy_id WHERE m.id = ${b.match_id}`,
      );
      const { refundPct } = decideRefund(m!.rules, Number(m!.hours_before));
      await this.seats.release(tx, b.id, 'cancelled', 'account_erasure');

      const cardPart = Math.floor((b.total_amount * refundPct) / 100);
      const walletPart = Math.floor((b.wallet_applied_amount * refundPct) / 100);
      const payment = await one<{ id: string }>(
        tx,
        sql`SELECT id FROM payments WHERE booking_id = ${b.id} AND status = 'succeeded' AND provider <> 'wallet'
            ORDER BY created_at DESC LIMIT 1`,
      );
      if (cardPart > 0 && payment) {
        const refund = await one<{ id: string }>(
          tx,
          sql`INSERT INTO refunds (payment_id, booking_id, amount, currency, destination, status, reason)
              VALUES (${payment.id}, ${b.id}, ${cardPart}, ${b.currency}, 'original_method', 'pending', 'account_erasure')
              RETURNING id`,
        );
        await emit(tx, 'refund', refund!.id, 'RefundRequested', { booking_id: b.id, payment_id: payment.id, amount: cardPart });
      }
      if (walletPart > 0) {
        const refund = await one<{ id: string }>(
          tx,
          sql`INSERT INTO refunds (booking_id, amount, currency, destination, status, reason, completed_at)
              VALUES (${b.id}, ${walletPart}, ${b.currency}, 'wallet', 'succeeded', 'account_erasure', now())
              RETURNING id`,
        );
        await this.wallet.credit(tx, { userId, currency: b.currency, amount: walletPart, type: 'refund_credit', bookingId: b.id, refundId: refund!.id });
      }
      out.push({ booking_id: b.id, refund_amount: cardPart + walletPart });
    }
    return out;
  }

  /** PII'ni olib tashlaydi; o'chirilgan eksport fayllari kalitlarini qaytaradi. */
  private async anonymize(
    tx: Tx,
    userId: string,
    requestId: string,
    cancelled: { booking_id: string; refund_amount: number }[],
  ): Promise<string[]> {
    const count = async (query: ReturnType<typeof sql>) => (await tx.execute(query)).rowCount ?? 0;

    const avatar = await one<{ avatar_media_id: string | null }>(tx, sql`SELECT avatar_media_id FROM users WHERE id = ${userId}`);
    await tx.execute(
      sql`UPDATE users
             SET phone_e164 = NULL, email = NULL, first_name = NULL, last_name = NULL, birth_date = NULL,
                 avatar_media_id = NULL, display_name = 'Deleted user', gender = 'undisclosed', last_seen_at = NULL,
                 status = 'deleted', deleted_at = now(), anonymized_at = now()
           WHERE id = ${userId}`,
    );
    if (avatar?.avatar_media_id) {
      // Obyektning o'zini media pipeline o'chiradi (status = deleted)
      await tx.execute(sql`UPDATE media_assets SET status = 'deleted', deleted_at = now() WHERE id = ${avatar.avatar_media_id}`);
    }
    const deleted = {
      auth_identities: await count(sql`DELETE FROM auth_identities WHERE user_id = ${userId}`),
      user_sessions: await count(sql`DELETE FROM user_sessions WHERE user_id = ${userId}`),
      device_tokens: await count(sql`DELETE FROM device_tokens WHERE user_id = ${userId}`),
      highlight_tags: await count(sql`DELETE FROM highlight_tags WHERE user_id = ${userId}`),
    };
    await tx.execute(
      sql`UPDATE match_waitlist SET status = 'cancelled' WHERE user_id = ${userId} AND status IN ('waiting', 'notified')`,
    );
    const exports = await rows<{ export_path: string }>(
      tx,
      sql`SELECT export_path FROM data_subject_requests WHERE user_id = ${userId} AND export_path IS NOT NULL`,
    );
    await tx.execute(sql`UPDATE data_subject_requests SET export_path = NULL WHERE user_id = ${userId} AND export_path IS NOT NULL`);
    await tx.execute(
      sql`UPDATE data_subject_requests SET status = 'completed', completed_at = now(), blocked_reasons = NULL, blocked_at = NULL
          WHERE id = ${requestId}`,
    );
    await audit(tx, null, 'user.erase', 'user', userId, {
      request_id: requestId,
      deleted,
      cancelled_bookings: cancelled,
      export_files_removed: exports.length,
      retained: ['consents', 'waiver_signatures', 'payments', 'refunds', 'wallet_transactions'],
    });
    await emit(tx, 'user', userId, 'UserErased', { request_id: requestId, user_id: userId });
    return exports.map((e) => e.export_path);
  }
}
