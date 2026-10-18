import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import type { Locale } from '../common/i18n';
import { emit } from '../common/outbox';
import { SeatsService } from '../commerce/seats.service';
import { WalletService } from '../commerce/wallet.service';
import { DB, type Db, one, pgError, PG, rows } from '../db/db';
import { MatchesService } from '../matches/matches.service';

export interface AdminMatchInput {
  pitch_id: string;
  sport: string;
  starts_at: string;
  duration_min: number;
  format: string;
  players_per_side: number;
  min_players: number;
  max_players: number;
  price: { amount: number; currency: string };
  lease_cost: { amount: number; currency: string };
  host_fee?: { amount: number; currency: string };
  level?: { min?: string | null; max?: string | null };
  gender_policy: 'any' | 'male' | 'female' | 'mixed';
  visibility: 'public' | 'unlisted' | 'private';
  title?: Record<string, string>;
  cancellation_policy_code: string;
}

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const publicCode = () => 'MU-' + Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly matches: MatchesService,
    private readonly seats: SeatsService,
    private readonly wallet: WalletService,
  ) {}

  /** Lease + draft match + 2 side bitta tranzaksiyada. Ustma-ust lease -> LEASE_OVERLAP. */
  async createMatch(adminId: string, input: AdminMatchInput, locale: Locale) {
    if (input.min_players > input.max_players) {
      throw new AppError('VALIDATION_FAILED', {}, [{ field: 'min_players', code: 'too_big', message: 'min_players <= max_players' }]);
    }
    if (new Date(input.starts_at).getTime() <= Date.now() + 60 * 60 * 1000) {
      throw new AppError('VALIDATION_FAILED', {}, [{ field: 'starts_at', code: 'too_soon', message: 'Kamida 1 soat keyin bo\'lishi kerak' }]);
    }
    const pitch = await one<{ id: string; city_id: number; currency: string; sport_id: number | null; policy_id: number | null }>(
      this.db,
      sql`SELECT p.id, v.city_id, c.default_currency AS currency,
                 (SELECT ps.sport_id FROM pitch_sports ps JOIN sports s ON s.id = ps.sport_id
                  WHERE ps.pitch_id = p.id AND s.code = ${input.sport}) AS sport_id,
                 (SELECT id FROM cancellation_policies WHERE code = ${input.cancellation_policy_code}) AS policy_id
          FROM pitches p JOIN venues v ON v.id = p.venue_id JOIN cities c ON c.id = v.city_id
          WHERE p.id = ${input.pitch_id} AND p.is_active`,
    );
    if (!pitch) throw new AppError('NOT_FOUND');
    const fieldErr = (field: string, message: string) => new AppError('VALIDATION_FAILED', {}, [{ field, code: 'invalid', message }]);
    if (!pitch.sport_id) throw fieldErr('sport', 'Bu maydonda bu sport turi o\'ynalmaydi');
    if (!pitch.policy_id) throw fieldErr('cancellation_policy_code', 'Bekor qilish siyosati topilmadi');
    if (input.price.currency !== pitch.currency) throw fieldErr('price.currency', `Shahar valyutasi: ${pitch.currency}`);

    let matchId: string;
    try {
      matchId = await this.db.transaction(async (tx) => {
        const lease = await one<{ id: string }>(
          tx,
          sql`INSERT INTO field_leases (pitch_id, period, cost_amount, currency, status, created_by)
              VALUES (${pitch.id}, tstzrange(${input.starts_at}::timestamptz,
                      ${input.starts_at}::timestamptz + make_interval(mins => ${input.duration_min}), '[)'),
                      ${input.lease_cost.amount}, ${input.lease_cost.currency}, 'confirmed', ${adminId})
              RETURNING id`,
        );
        const m = await one<{ id: string }>(
          tx,
          sql`INSERT INTO matches (public_code, sport_id, pitch_id, lease_id, city_id, location, title, starts_at, ends_at,
                                   format, players_per_side, min_players, max_players, price_amount, currency,
                                   skill_min, skill_max, gender_policy, visibility, status, cancellation_policy_id,
                                   booking_closes_at, min_players_deadline, host_fee_amount, created_by)
              SELECT ${publicCode()}, ${pitch.sport_id}, p.id, ${lease!.id}, v.city_id, v.location,
                     ${JSON.stringify(input.title ?? {})}::jsonb,
                     ${input.starts_at}::timestamptz, ${input.starts_at}::timestamptz + make_interval(mins => ${input.duration_min}),
                     ${input.format}, ${input.players_per_side}, ${input.min_players}, ${input.max_players},
                     ${input.price.amount}, ${input.price.currency},
                     ${input.level?.min ?? null}::skill_level, ${input.level?.max ?? null}::skill_level,
                     ${input.gender_policy}, ${input.visibility}, 'draft', ${pitch.policy_id},
                     ${input.starts_at}::timestamptz - interval '30 minutes',
                     greatest(${input.starts_at}::timestamptz - interval '3 hours', now()),
                     ${input.host_fee?.amount ?? 0}, ${adminId}
              FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE p.id = ${pitch.id}
              RETURNING id`,
        );
        await tx.execute(
          sql`INSERT INTO match_sides (match_id, side_no, label, bib_color)
              VALUES (${m!.id}, 1, 'Oranges', '#FF7A00'), (${m!.id}, 2, 'Blues', '#1F6FEB')`,
        );
        await tx.execute(
          sql`INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, changes)
              VALUES (${adminId}, 'admin', 'match.create', 'match', ${m!.id}, ${JSON.stringify(input)}::jsonb)`,
        );
        return m!.id;
      });
    } catch (err) {
      if (pgError(err)?.code === PG.EXCLUSION_VIOLATION) throw new AppError('LEASE_OVERLAP');
      throw err;
    }
    return this.matches.detail(matchId, locale, undefined, { includeDraft: true });
  }

  async publish(adminId: string, matchId: string, locale: Locale) {
    const r = await this.db.transaction(async (tx) => {
      const m = await one<{ id: string }>(
        tx,
        sql`UPDATE matches SET status = 'open', published_at = now() WHERE id = ${matchId} AND status = 'draft' RETURNING id`,
      );
      if (!m) return false;
      await emit(tx, 'match', matchId, 'MatchPublished');
      await tx.execute(
        sql`INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id)
            VALUES (${adminId}, 'admin', 'match.publish', 'match', ${matchId})`,
      );
      return true;
    });
    if (!r) throw new AppError('INVALID_STATE');
    return this.matches.detail(matchId, locale);
  }

  /** Platforma match'ni bekor qiladi: barcha to'lovlarga 100% refund (+ ixtiyoriy wallet bonus). */
  async cancelMatch(
    actorId: string | null,
    matchId: string,
    p: { reason: string; refund_destination: 'original_method' | 'wallet'; wallet_bonus_pct: number },
  ) {
    return this.db.transaction(async (tx) => {
      const m = await one<{ status: string }>(tx, sql`SELECT status FROM matches WHERE id = ${matchId} FOR UPDATE`);
      if (!m) throw new AppError('NOT_FOUND');
      if (['completed', 'cancelled', 'in_progress'].includes(m.status)) throw new AppError('INVALID_STATE');

      const bookings = await rows<{ id: string; user_id: string; status: string; total_amount: number; wallet_applied_amount: number; currency: string }>(
        tx,
        sql`SELECT id, user_id, status, total_amount, wallet_applied_amount, currency FROM bookings
            WHERE match_id = ${matchId} AND status IN ('pending_payment', 'confirmed')`,
      );
      let refunds = 0;
      for (const b of bookings) {
        await this.seats.release(tx, b.id, 'cancelled', 'match_cancelled');
        if (b.status !== 'confirmed') continue;
        const paid = b.total_amount + b.wallet_applied_amount;
        const toWallet = p.refund_destination === 'wallet' || b.total_amount === 0;
        const payment = await one<{ id: string }>(
          tx,
          sql`SELECT id FROM payments WHERE booking_id = ${b.id} AND status = 'succeeded' AND provider <> 'wallet' LIMIT 1`,
        );
        const refund = await one<{ id: string }>(
          tx,
          sql`INSERT INTO refunds (payment_id, booking_id, amount, currency, destination, status, reason, initiated_by, completed_at)
              VALUES (${payment?.id ?? null}, ${b.id}, ${paid}, ${b.currency}, ${toWallet ? 'wallet' : 'original_method'},
                      ${toWallet ? 'succeeded' : 'pending'}, 'match_cancelled', ${actorId}, ${toWallet ? sql`now()` : null})
              RETURNING id`,
        );
        if (toWallet) {
          const bonus = Math.floor((paid * p.wallet_bonus_pct) / 100);
          await this.wallet.credit(tx, { userId: b.user_id, currency: b.currency, amount: paid + bonus, type: 'refund_credit', bookingId: b.id, refundId: refund!.id, note: bonus ? `bonus ${p.wallet_bonus_pct}%` : undefined });
          await emit(tx, 'refund', refund!.id, 'RefundIssued', { booking_id: b.id, amount: paid + bonus, destination: 'wallet' });
        } else {
          await emit(tx, 'refund', refund!.id, 'RefundRequested', { booking_id: b.id, payment_id: payment?.id, amount: paid });
        }
        refunds++;
      }
      await tx.execute(
        sql`UPDATE matches SET status = 'cancelled', cancelled_at = now(), cancel_reason = ${p.reason} WHERE id = ${matchId}`,
      );
      await tx.execute(
        sql`UPDATE host_assignments SET status = 'cancelled' WHERE match_id = ${matchId} AND status IN ('offered', 'accepted', 'arrived')`,
      );
      await tx.execute(sql`UPDATE match_waitlist SET status = 'cancelled' WHERE match_id = ${matchId} AND status IN ('waiting', 'notified')`);
      await emit(tx, 'match', matchId, 'MatchCancelled', { reason: p.reason, refunds });
      await tx.execute(
        sql`INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, changes)
            VALUES (${actorId}, ${actorId ? 'admin' : null}, 'match.cancel', 'match', ${matchId}, ${JSON.stringify(p)}::jsonb)`,
      );
      return { refunds_queued: refunds };
    });
  }

  /** min_players_deadline o'tgan va minimumga yetmagan match'lar — avto-bekor (job). */
  async cancelUnderfilled(): Promise<number> {
    const due = await rows<{ id: string }>(
      this.db,
      sql`SELECT id FROM matches
          WHERE status = 'open' AND min_players_deadline <= now() AND confirmed_slots < min_players AND starts_at > now()`,
    );
    for (const m of due) {
      await this.cancelMatch(null, m.id, { reason: 'min_players_not_reached', refund_destination: 'original_method', wallet_bonus_pct: 0 });
    }
    return due.length;
  }
}
