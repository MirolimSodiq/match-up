import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DB, type Db, one, rows } from '../db/db';
import { StreamConsumer } from '../notifications/events/stream-consumer';
import { pgUuidArray } from '../notifications/notifications.service';
import { REDIS } from '../redis/redis.module';
import { composite, type Glicko, glicko2, outcome } from './glicko2';

interface RatedPlayer extends Glicko {
  user_id: string;
  side_no: number;
}

/**
 * Glicko-2 reytingi (`player_sport_profiles`): har yakunlangan match — har o'yinchi uchun bitta reyting davri,
 * har boshqa jamoa (hisobi kiritilgan) — bitta "o'yin", raqib — o'sha jamoaning kompoziti.
 * Faqat kelgan (`checked_in`), jamoaga taqsimlangan, ro'yxatdan o'tgan o'yinchilar; mehmonlar reytingsiz.
 */
@Injectable()
export class RatingsService {
  private readonly log = new Logger('Ratings');

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Idempotent: match uchun reyting bir marta qo'llanadi (`player_rating_changes`). Qo'llangan o'yinchilar soni. */
  async applyMatch(matchId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const m = await one<{ sport_id: number; status: string }>(
        tx,
        sql`SELECT sport_id, status FROM matches WHERE id = ${matchId} FOR UPDATE`,
      );
      if (!m || m.status !== 'completed') return 0;
      if (await one(tx, sql`SELECT 1 FROM player_rating_changes WHERE match_id = ${matchId} LIMIT 1`)) return 0;

      const scores = new Map(
        (
          await rows<{ side_no: number; score: number }>(
            tx,
            sql`SELECT side_no, score FROM match_sides WHERE match_id = ${matchId} AND score IS NOT NULL`,
          )
        ).map((s) => [s.side_no, s.score]),
      );
      const roster = await rows<{ user_id: string; side_no: number }>(
        tx,
        sql`SELECT mp.user_id, mp.side_no FROM match_participants mp
            JOIN users u ON u.id = mp.user_id AND u.deleted_at IS NULL
            WHERE mp.match_id = ${matchId} AND mp.status = 'checked_in' AND mp.side_no IS NOT NULL`,
      );
      const eligible = roster.filter((p) => scores.has(p.side_no));
      if (new Set(eligible.map((p) => p.side_no)).size < 2) {
        this.log.log(`match ${matchId}: reyting yo'q — hisobi bor kamida 2 ta jamoa kerak`);
        return 0;
      }

      // Profillar match yakunlanganda yaratilgan (games_played); parallel match'lar bilan lost update bo'lmasin —
      // qatorlar tartib bilan lock qilinadi
      const ids = eligible.map((p) => p.user_id);
      await tx.execute(
        sql`INSERT INTO player_sport_profiles (user_id, sport_id)
            SELECT unnest(${pgUuidArray(ids)}), ${m.sport_id}
            ON CONFLICT (user_id, sport_id) DO NOTHING`,
      );
      const current = await rows<{ user_id: string; rating: string; rating_deviation: string; rating_volatility: string }>(
        tx,
        sql`SELECT user_id, rating, rating_deviation, rating_volatility FROM player_sport_profiles
            WHERE sport_id = ${m.sport_id} AND user_id = ANY(${pgUuidArray(ids)})
            ORDER BY user_id FOR UPDATE`,
      );
      const byUser = new Map(current.map((c) => [c.user_id, c]));
      const players: RatedPlayer[] = eligible.map((p) => {
        const c = byUser.get(p.user_id)!;
        return { ...p, rating: Number(c.rating), rd: Number(c.rating_deviation), vol: Number(c.rating_volatility) };
      });

      // Hamma yangi reytinglar match oldidagi holatdan hisoblanadi (tartibga bog'liq emas)
      const sides = [...new Set(players.map((p) => p.side_no))];
      const teams = new Map(sides.map((s) => [s, composite(players.filter((p) => p.side_no === s))]));
      for (const p of players) {
        const games = sides
          .filter((s) => s !== p.side_no)
          .map((s) => ({ opponent: teams.get(s)!, score: outcome(scores.get(p.side_no)!, scores.get(s)!) }));
        const next = glicko2(p, games);
        const score = games.reduce((sum, g) => sum + g.score, 0) / games.length;
        await tx.execute(
          sql`INSERT INTO player_rating_changes (match_id, user_id, sport_id, side_no, score,
                                                 rating_before, rd_before, vol_before, rating_after, rd_after, vol_after)
              VALUES (${matchId}, ${p.user_id}, ${m.sport_id}, ${p.side_no}, ${score},
                      ${p.rating}, ${p.rd}, ${p.vol}, ${next.rating}, ${next.rd}, ${next.vol})`,
        );
        await tx.execute(
          sql`UPDATE player_sport_profiles
                 SET rating = ${next.rating}, rating_deviation = ${next.rd}, rating_volatility = ${next.vol}, updated_at = now()
               WHERE user_id = ${p.user_id} AND sport_id = ${m.sport_id}`,
        );
      }
      this.log.log(`match ${matchId}: ${players.length} ta o'yinchi reytingi yangilandi`);
      return players.length;
    });
  }
}

/**
 * `post-match` consumer group: `MatchCompleted` -> reyting. Alohida guruh — sekin push yoki WS
 * reytingni ushlab turmaydi (va aksincha); xato bo'lsa event qayta olinadi (StreamConsumer).
 */
@Injectable()
export class PostMatchConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  readonly consumer: StreamConsumer;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) redis: Redis,
    ratings: RatingsService,
  ) {
    this.consumer = new StreamConsumer(redis, 'post-match', async (e) => {
      if (e.type === 'MatchCompleted') await ratings.applyMatch(e.aggregateId);
    });
  }

  onApplicationBootstrap() {
    if (this.env.RUN_WORKERS) this.consumer.start();
  }

  async onModuleDestroy() {
    await this.consumer.stop();
  }

  ensureGroup() {
    return this.consumer.ensureGroup();
  }

  /** Yangi event'larni darhol qayta ishlash (testlar / qo'lda). */
  drain() {
    return this.consumer.drain();
  }
}
