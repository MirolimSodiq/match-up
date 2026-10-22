import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { AppError } from '../common/errors';
import { DB, type Db, type Executor, iso, one, rows } from '../db/db';
import { MediaUrlSigner } from '../media/storage';
import { MediaTokens } from '../media/tokens';
import { type Actor, audit } from './audit';
import { joinList } from './schemas';

export const REJECT_REASONS = ['inappropriate', 'violence', 'privacy', 'not_match', 'low_quality', 'other'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
export type ModerationStatus = 'pending' | 'approved' | 'rejected';

interface Row {
  id: string;
  title: string | null;
  source: string;
  duration_ms: number | null;
  match_offset_ms: number | null;
  visibility: string;
  moderation_status: ModerationStatus;
  moderation_reason: string | null;
  moderation_note: string | null;
  moderated_at: string | null;
  moderator_id: string | null;
  moderator_name: string | null;
  likes_count: number;
  shares_count: number;
  views_count: number;
  created_at: string;
  published_at: string;
  creator_id: string;
  creator_name: string;
  creator_phone: string | null;
  match_id: string;
  public_code: string;
  sport: string;
  starts_at: string;
  timezone: string;
  venue_name: string;
  media_id: string;
  output_bucket: string | null;
  thumbnail_key: string | null;
  vertical_key: string | null;
  width: number | null;
  height: number | null;
  tags: { user_id: string; display_name: string }[];
  total?: number;
}

/** Navbatdagi klip: worker tayyorlagan, nashr qilingan, o'chirilmagan (media holati `ready`). */
const IN_QUEUE = sql`h.published_at IS NOT NULL AND h.deleted_at IS NULL AND ma.status = 'ready'`;

const SELECT = sql`
  SELECT h.id, h.title, h.source, h.duration_ms, h.match_offset_ms, h.visibility, h.moderation_status,
         h.moderation_reason, h.moderation_note, h.moderated_at, mu.id AS moderator_id, mu.display_name AS moderator_name,
         h.likes_count, h.shares_count, h.views_count, h.created_at, h.published_at,
         cu.id AS creator_id, cu.display_name AS creator_name, cu.phone_e164 AS creator_phone,
         m.id AS match_id, m.public_code, s.code AS sport, m.starts_at, v.timezone, v.name AS venue_name,
         ma.id AS media_id, ma.output_bucket, ma.thumbnail_key, ma.vertical_key, ma.width, ma.height,
         -- Moderator hamma teglarni ko'radi (consent qaytarib olingan bo'lsa ham — maxfiylik shikoyatini tekshirish uchun)
         coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', u.id, 'display_name', u.display_name) ORDER BY u.display_name)
                   FROM highlight_tags t JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL
                   WHERE t.highlight_id = h.id), '[]'::jsonb) AS tags
  FROM highlights h
  JOIN media_assets ma ON ma.id = h.media_asset_id
  JOIN users cu ON cu.id = h.created_by
  LEFT JOIN users mu ON mu.id = h.moderated_by
  JOIN matches m ON m.id = h.match_id
  JOIN sports s ON s.id = m.sport_id
  JOIN pitches p ON p.id = m.pitch_id
  JOIN venues v ON v.id = p.venue_id`;

/**
 * Highlight moderatsiyasi (post-moderatsiya): klip tayyor bo'lishi bilan ishtirokchilarga ko'rinadi, admin navbatda
 * ko'rib chiqadi. `rejected` — feed, ulashish havolasi va push'lardan yashiriladi; qaror o'zgartirilishi mumkin.
 * Har qaror `audit_logs` (`highlight.moderate`) ga yoziladi.
 */
@Injectable()
export class AdminHighlightsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly signer: MediaUrlSigner,
    private readonly tokens: MediaTokens,
  ) {}

  async list(f: { status: ModerationStatus[]; match_id?: string; q?: string; limit: number; offset: number }) {
    const conds: SQL[] = [IN_QUEUE, sql`h.moderation_status = ANY(string_to_array(${joinList(f.status)}, ',')::moderation_status[])`];
    if (f.match_id) conds.push(sql`h.match_id = ${f.match_id}`);
    if (f.q) {
      const like = '%' + f.q + '%';
      conds.push(
        sql`(m.public_code ILIKE ${like} OR h.title ILIKE ${like} OR cu.display_name ILIKE ${like}
             OR cu.phone_e164 LIKE ${'%' + f.q.replace(/\s+/g, '') + '%'})`,
      );
    }
    // Navbat — eng eskisi birinchi (FIFO); ko'rib chiqilganlar — oxirgi qaror birinchi
    const order =
      f.status.length === 1 && f.status[0] === 'pending'
        ? sql`x.published_at, x.id`
        : sql`coalesce(x.moderated_at, x.published_at) DESC, x.id DESC`;
    const where = sql.join(conds, sql` AND `);
    const list = await rows<Row>(
      this.db,
      sql`SELECT x.*, count(*) OVER ()::int AS total FROM (${SELECT} WHERE ${where}) x
          ORDER BY ${order} LIMIT ${f.limit} OFFSET ${f.offset}`,
    );
    let total = list[0]?.total;
    if (total === undefined) {
      total = f.offset ? (await one<{ n: number }>(this.db, sql`SELECT count(*)::int AS n FROM (${SELECT} WHERE ${where}) x`))!.n : 0;
    }
    // Tab'lar va menyu badge'i uchun — filtrsiz
    const counts = await rows<{ moderation_status: ModerationStatus; n: number }>(
      this.db,
      sql`SELECT h.moderation_status, count(*)::int AS n
          FROM highlights h JOIN media_assets ma ON ma.id = h.media_asset_id
          WHERE ${IN_QUEUE} GROUP BY 1`,
    );
    const expiresAt = this.expiry();
    return {
      items: await Promise.all(list.map((r) => this.present(r, expiresAt))),
      total,
      counts: Object.fromEntries(
        (['pending', 'approved', 'rejected'] as const).map((st) => [st, counts.find((c) => c.moderation_status === st)?.n ?? 0]),
      ) as Record<ModerationStatus, number>,
    };
  }

  async get(id: string, ex: Executor = this.db) {
    const r = await one<Row>(ex, sql`${SELECT} WHERE h.id = ${id} AND ${IN_QUEUE}`);
    if (!r) throw new AppError('NOT_FOUND');
    return this.present(r, this.expiry());
  }

  async moderate(actor: Actor, id: string, body: { status: 'approved' | 'rejected'; reason?: RejectReason; note?: string }) {
    await this.db.transaction(async (tx) => {
      const h = await one<{ moderation_status: ModerationStatus; moderation_reason: string | null }>(
        tx,
        sql`SELECT h.moderation_status, h.moderation_reason FROM highlights h JOIN media_assets ma ON ma.id = h.media_asset_id
            WHERE h.id = ${id} AND ${IN_QUEUE} FOR UPDATE OF h`,
      );
      if (!h) throw new AppError('NOT_FOUND');
      const reason = body.status === 'rejected' ? body.reason! : null;
      await tx.execute(
        sql`UPDATE highlights
               SET moderation_status = ${body.status}, moderation_reason = ${reason}, moderation_note = ${body.note ?? null},
                   moderated_by = ${actor.id}, moderated_at = now(), updated_at = now()
             WHERE id = ${id}`,
      );
      await audit(tx, actor, 'highlight.moderate', 'highlight', id, {
        from: h.moderation_status,
        to: body.status,
        ...(reason ? { reason } : {}),
        ...(body.note ? { note: body.note } : {}),
      });
    });
    return this.get(id);
  }

  private expiry() {
    return Math.floor(Date.now() / 1000) + this.env.MEDIA_PLAYBACK_TTL_SEC;
  }

  private async present(r: Row, expiresAt: number) {
    const signed = (key: string | null) => (key && r.output_bucket ? this.signer.sign(r.output_bucket, key, expiresAt) : Promise.resolve(null));
    return {
      id: r.id,
      title: r.title,
      source: r.source,
      duration_ms: r.duration_ms,
      match_offset_ms: r.match_offset_ms,
      visibility: r.visibility,
      created_at: iso(r.created_at),
      published_at: iso(r.published_at),
      moderation: {
        status: r.moderation_status,
        reason: r.moderation_reason,
        note: r.moderation_note,
        moderated_at: iso(r.moderated_at),
        moderated_by: r.moderator_id ? { id: r.moderator_id, display_name: r.moderator_name } : null,
      },
      creator: { id: r.creator_id, display_name: r.creator_name, phone: r.creator_phone },
      match: { id: r.match_id, public_code: r.public_code, sport: r.sport, starts_at: iso(r.starts_at), timezone: r.timezone, venue_name: r.venue_name },
      tags: r.tags,
      likes_count: r.likes_count,
      shares_count: r.shares_count,
      views_count: Number(r.views_count),
      media: {
        id: r.media_id,
        width: r.width,
        height: r.height,
        thumbnail_url: await signed(r.thumbnail_key),
        // 9:16 MP4 — brauzerda <video> bilan to'g'ridan-to'g'ri (HLS uchun CORS kerak bo'lardi); markazdan qirqilgan
        mp4_url: await signed(r.vertical_key),
        hls_url: `${this.env.PUBLIC_BASE_URL}/v1/playback/${this.tokens.sign('playback', r.media_id, expiresAt)}/master.m3u8`,
        expires_at: new Date(expiresAt * 1000).toISOString(),
      },
    };
  }
}
