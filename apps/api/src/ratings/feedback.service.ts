import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { DB, type Db, type Executor, iso, one, rows } from '../db/db';

/** Match yakunlangandan keyin feedback qoldirish muddati. */
export const FEEDBACK_WINDOW_DAYS = 7;

export interface FeedbackItem {
  target: 'host' | 'player' | 'match' | 'venue';
  to_user_id?: string;
  rating: number;
  tags?: string[];
  comment?: string;
}

interface Ctx {
  open_until: string;
  open: boolean;
  host: { user_id: string; display_name: string } | null;
  players: { user_id: string; display_name: string; side_no: number | null }[];
}

/**
 * O'yin haqida feedback (`match.rate` push'idan keyin): host, boshqa o'yinchilar, o'yin va maydon — 1–5 baho,
 * teglar va izoh. Faqat o'yinga kelgan (`checked_in`) o'yinchi, yakunlangandan keyin FEEDBACK_WINDOW_DAYS ichida.
 * Qayta yuborish — yangilash. Host baholari `host_profiles.rating_avg` ga (dispatch tartibi) yig'iladi.
 */
@Injectable()
export class FeedbackService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async get(userId: string, matchId: string) {
    const ctx = await this.context(this.db, userId, matchId);
    return this.present(matchId, userId, ctx);
  }

  async submit(userId: string, matchId: string, items: FeedbackItem[]) {
    await this.db.transaction(async (tx) => {
      const ctx = await this.context(tx, userId, matchId);
      if (!ctx.open) throw new AppError('INVALID_STATE', { open_until: iso(ctx.open_until) ?? '' });
      const players = new Set(ctx.players.map((p) => p.user_id));
      const errors = items.flatMap((it, i) => {
        const field = `items[${i}].to_user_id`;
        if (it.target === 'host') {
          if (!ctx.host) return [{ field: `items[${i}].target`, code: 'no_host', message: "Bu o'yinda host bo'lmagan" }];
          if (it.to_user_id && it.to_user_id !== ctx.host.user_id) return [{ field, code: 'invalid', message: "Bu o'yinning host'i emas" }];
        } else if (it.target === 'player') {
          if (!it.to_user_id || !players.has(it.to_user_id)) return [{ field, code: 'invalid', message: "O'yinda qatnashgan boshqa o'yinchi bo'lishi kerak" }];
        } else if (it.to_user_id) {
          return [{ field, code: 'not_allowed', message: 'match/venue uchun to_user_id berilmaydi' }];
        }
        return [];
      });
      if (errors.length) throw new AppError('VALIDATION_FAILED', {}, errors);

      for (const it of items) {
        const to = it.target === 'host' ? ctx.host!.user_id : it.target === 'player' ? it.to_user_id! : null;
        const tags = it.tags ?? [];
        await tx.execute(
          sql`INSERT INTO match_feedback (match_id, from_user_id, target, to_user_id, rating, tags, comment)
              VALUES (${matchId}, ${userId}, ${it.target}, ${to}, ${it.rating},
                      string_to_array(${tags.join(',')}, ',')::text[], ${it.comment ?? null})
              ON CONFLICT ON CONSTRAINT match_feedback_unique
              DO UPDATE SET rating = EXCLUDED.rating, tags = EXCLUDED.tags, comment = EXCLUDED.comment`,
        );
      }
      if (ctx.host && items.some((it) => it.target === 'host')) {
        await tx.execute(
          sql`UPDATE host_profiles hp
                 SET rating_avg = f.avg, rating_count = f.n, updated_at = now()
                FROM (SELECT round(avg(rating), 2) AS avg, count(*)::int AS n FROM match_feedback
                      WHERE target = 'host' AND to_user_id = ${ctx.host.user_id}) f
               WHERE hp.user_id = ${ctx.host.user_id}`,
        );
      }
    });
    return this.get(userId, matchId);
  }

  /** Match holati, host va baholanadigan o'yinchilar; foydalanuvchi o'yinga kelmagan bo'lsa — 403. */
  private async context(ex: Executor, userId: string, matchId: string): Promise<Ctx> {
    const m = await one<{ status: string; completed_at: string | null; open_until: string | null; open: boolean }>(
      ex,
      sql`SELECT status, completed_at,
                 completed_at + make_interval(days => ${FEEDBACK_WINDOW_DAYS}) AS open_until,
                 coalesce(completed_at + make_interval(days => ${FEEDBACK_WINDOW_DAYS}) > now(), false) AS open
          FROM matches WHERE id = ${matchId}`,
    );
    if (!m) throw new AppError('NOT_FOUND');
    const me = await one(
      ex,
      sql`SELECT 1 FROM match_participants WHERE match_id = ${matchId} AND user_id = ${userId} AND status = 'checked_in'`,
    );
    if (!me) throw new AppError('FORBIDDEN');
    if (m.status !== 'completed' || !m.completed_at) throw new AppError('INVALID_STATE');

    const host = await one<{ user_id: string; display_name: string }>(
      ex,
      sql`SELECT u.id AS user_id, u.display_name FROM host_assignments ha JOIN users u ON u.id = ha.host_user_id
          WHERE ha.match_id = ${matchId} AND ha.status = 'completed' AND u.deleted_at IS NULL`,
    );
    const players = await rows<{ user_id: string; display_name: string; side_no: number | null }>(
      ex,
      sql`SELECT u.id AS user_id, u.display_name, mp.side_no FROM match_participants mp JOIN users u ON u.id = mp.user_id
          WHERE mp.match_id = ${matchId} AND mp.status = 'checked_in' AND mp.user_id <> ${userId} AND u.deleted_at IS NULL
          ORDER BY mp.side_no NULLS LAST, u.display_name`,
    );
    return { open_until: m.open_until!, open: m.open, host: host ?? null, players };
  }

  private async present(matchId: string, userId: string, ctx: Ctx) {
    const given = await rows<{ target: string; to_user_id: string | null; rating: number; tags: string[]; comment: string | null; created_at: string }>(
      this.db,
      sql`SELECT target, to_user_id, rating, tags, comment, created_at FROM match_feedback
          WHERE match_id = ${matchId} AND from_user_id = ${userId} ORDER BY created_at, target`,
    );
    return {
      match_id: matchId,
      open: ctx.open,
      open_until: iso(ctx.open_until),
      host: ctx.host,
      players: ctx.players,
      given: given.map((g) => ({ ...g, created_at: iso(g.created_at) })),
    };
  }
}
