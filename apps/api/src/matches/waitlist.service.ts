import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Db, type Executor, one, rows, type Tx } from '../db/db';

export interface WaitlistOffer {
  id: string;
  user_id: string;
  offer_expires_at: string;
}

/**
 * Kutish ro'yxati takliflari (match_waitlist — Matches moduliga tegishli).
 * Joy bo'shasa navbatdagi birinchiga 10 daqiqalik eksklyuziv oyna beriladi: shu vaqt ichida
 * boshqalar o'sha joyni hold qila olmaydi (SeatsService.hold faol takliflarni hisobga oladi).
 */
@Injectable()
export class WaitlistService {
  static readonly OFFER_MINUTES = 10;

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Bo'sh joylar (hold/confirmed va faol takliflardan tashqari) soniga qadar navbatdagilarga taklif.
   * Chaqiruvchining tranzaksiyasi ichida: match qatori lock qilinadi (hold bilan poyga yo'q).
   */
  async offerNext(tx: Tx, matchId: string): Promise<WaitlistOffer[]> {
    const m = await one<{ free: number }>(
      tx,
      sql`SELECT max_players - held_slots - confirmed_slots AS free FROM matches
          WHERE id = ${matchId} AND status = 'open' AND now() < booking_closes_at
          FOR UPDATE`,
    );
    if (!m) return [];
    const active = await one<{ n: number }>(
      tx,
      sql`SELECT count(*)::int AS n FROM match_waitlist
          WHERE match_id = ${matchId} AND status = 'notified' AND offer_expires_at > now()`,
    );
    const n = m.free - (active?.n ?? 0);
    if (n <= 0) return [];
    return rows<WaitlistOffer>(
      tx,
      sql`UPDATE match_waitlist w
             SET status = 'notified', notified_at = now(),
                 offer_expires_at = now() + make_interval(mins => ${WaitlistService.OFFER_MINUTES})
           WHERE w.id IN (
             SELECT q.id FROM match_waitlist q
             WHERE q.match_id = ${matchId} AND q.status = 'waiting'
               AND NOT EXISTS (SELECT 1 FROM match_participants mp
                               WHERE mp.match_id = q.match_id AND mp.user_id = q.user_id
                                 AND mp.status IN ('held', 'confirmed', 'checked_in'))
             ORDER BY q.created_at
             LIMIT ${n}
             FOR UPDATE SKIP LOCKED)
           RETURNING w.id, w.user_id, w.offer_expires_at`,
    );
  }

  /** Muddati o'tgan takliflar -> expired. Qaytaradi: navbat qayta ko'rib chiqilishi kerak bo'lgan match'lar. */
  async expireOffers(limit = 500): Promise<string[]> {
    const expired = await rows<{ match_id: string }>(
      this.db,
      sql`UPDATE match_waitlist SET status = 'expired'
          WHERE id IN (SELECT id FROM match_waitlist
                       WHERE status = 'notified' AND offer_expires_at <= now()
                       ORDER BY offer_expires_at LIMIT ${limit})
          RETURNING match_id`,
    );
    return [...new Set(expired.map((e) => e.match_id))];
  }

  /** O'yinchi joy oldi — navbatdagi yozuvi yopiladi. */
  async markConverted(ex: Executor, matchId: string, userId: string): Promise<boolean> {
    const res = await ex.execute(
      sql`UPDATE match_waitlist SET status = 'converted'
          WHERE match_id = ${matchId} AND user_id = ${userId} AND status IN ('waiting', 'notified')`,
    );
    return (res.rowCount ?? 0) > 0;
  }
}
