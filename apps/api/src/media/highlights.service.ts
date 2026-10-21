import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { AppError } from '../common/errors';
import { type AuthUser, decodeCursor, encodeCursor } from '../common/http';
import { type Locale } from '../common/i18n';
import { emit } from '../common/outbox';
import { DB, type Db, iso, one, rows } from '../db/db';
import { type Rendition, VIEWER_PARTICIPANT_STATUSES } from './media.service';
import { MediaUrlSigner, ObjectStorage } from './storage';
import { MediaTokens } from './tokens';

interface HighlightRow {
  id: string;
  match_id: string;
  source: string;
  title: string | null;
  duration_ms: number | null;
  match_offset_ms: number | null;
  visibility: string;
  moderation_status: string;
  likes_count: number;
  shares_count: number;
  published_at: string | null;
  created_at: string;
  created_by: string;
  creator_name: string;
  media_id: string;
  media_status: string;
  failure_code: string | null;
  output_bucket: string | null;
  thumbnail_key: string | null;
  vertical_key: string | null;
  width: number | null;
  height: number | null;
  public_code: string;
  sport: string;
  starts_at: string;
  venue_name: string;
  timezone: string;
  liked_by_me: boolean;
  tags: { user_id: string; display_name: string }[];
}

interface PlaybackMedia {
  id: string;
  output_bucket: string;
  object_key: string;
  renditions: Rendition[];
}

const SHARE_CHANNELS = ['telegram', 'instagram', 'link', 'other'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/** Feed'da ko'rinadigan highlight: worker tayyorlagan, nashr qilingan, o'chirilmagan, rad etilmagan. */
const VISIBLE = sql`h.deleted_at IS NULL AND h.published_at IS NOT NULL AND h.moderation_status <> 'rejected' AND ma.status = 'ready'`;

const FROM = sql`
  FROM highlights h
  JOIN media_assets ma ON ma.id = h.media_asset_id
  JOIN users cu ON cu.id = h.created_by
  JOIN matches m ON m.id = h.match_id
  JOIN sports s ON s.id = m.sport_id
  JOIN pitches p ON p.id = m.pitch_id
  JOIN venues v ON v.id = p.venue_id`;

function columns(viewerId: string | null): SQL {
  return sql`
    h.id, h.match_id, h.source, h.title, h.duration_ms, h.match_offset_ms, h.visibility, h.moderation_status,
    h.likes_count, h.shares_count, h.published_at, h.created_at, h.created_by, cu.display_name AS creator_name,
    ma.id AS media_id, ma.status AS media_status, ma.failure_code, ma.output_bucket, ma.thumbnail_key, ma.vertical_key,
    ma.width, ma.height, m.public_code, s.code AS sport, m.starts_at, v.name AS venue_name, v.timezone,
    ${viewerId ? sql`EXISTS (SELECT 1 FROM highlight_reactions r WHERE r.highlight_id = h.id AND r.user_id = ${viewerId} AND r.type = 'like')` : sql`false`} AS liked_by_me,
    -- Teg faqat joriy media_appearance consent'i bilan ko'rsatiladi (consent qaytarib olinsa — teg yashiriladi)
    coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', u.id, 'display_name', u.display_name) ORDER BY u.display_name)
              FROM highlight_tags t
              JOIN users u ON u.id = t.user_id AND u.status <> 'deleted'
              JOIN user_current_consents c ON c.user_id = t.user_id AND c.purpose = 'media_appearance' AND c.granted
              WHERE t.highlight_id = h.id), '[]'::jsonb) AS tags`;
}

/** Ko'ruvchi: match ishtirokchisi (confirmed/checked_in), teglangan o'yinchi yoki tayinlangan host. */
function viewerCan(userId: string): SQL {
  return sql`(
    EXISTS (SELECT 1 FROM match_participants mp
            WHERE mp.match_id = h.match_id AND mp.user_id = ${userId} AND mp.status IN ${VIEWER_PARTICIPANT_STATUSES})
    OR EXISTS (SELECT 1 FROM highlight_tags t WHERE t.highlight_id = h.id AND t.user_id = ${userId})
    OR EXISTS (SELECT 1 FROM host_assignments ha
               WHERE ha.match_id = h.match_id AND ha.host_user_id = ${userId} AND ha.status IN ('accepted', 'arrived', 'completed')))`;
}

const isAdmin = (u: AuthUser) => u.roles.includes('admin') || u.roles.includes('super_admin');

/** Variant playlist'lar o'zgarmaydi (media_id bo'yicha) — kichik LRU. */
class PlaylistCache {
  private readonly map = new Map<string, string>();
  constructor(private readonly max = 500) {}
  get(k: string) {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: string) {
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

/**
 * Player tomoni: match va profil feed'lari, like, ulashish, ijro.
 *
 * Ijro: HLS segmentlari to'g'ridan-to'g'ri storage/CDN'dan, imzolangan URL bilan. Playlist'larning o'zi
 * (bir necha KB) API orqali: `/v1/playback/{token}/master.m3u8` -> variant playlist'dagi har segment
 * imzolangan absolyut URL bilan almashtiriladi. Sabab: AVPlayer/ExoPlayer nisbiy segment URL'lariga
 * query-string imzoni o'tkazmaydi, presigned S3 imzosi esa har obyekt uchun alohida.
 */
@Injectable()
export class HighlightsService {
  private readonly playlists = new PlaylistCache();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly storage: ObjectStorage,
    private readonly signer: MediaUrlSigner,
    private readonly tokens: MediaTokens,
  ) {}

  private playbackExpiry(): number {
    return Math.floor(Date.now() / 1000) + this.env.MEDIA_PLAYBACK_TTL_SEC;
  }

  private async toHighlight(r: HighlightRow, expiresAt = this.playbackExpiry()) {
    const ready = r.media_status === 'ready' && !!r.output_bucket;
    const status = ready ? 'ready' : r.media_status === 'failed' || r.media_status === 'rejected' ? 'failed' : 'processing';
    return {
      id: r.id,
      match_id: r.match_id,
      source: r.source,
      title: r.title,
      status,
      failure_code: status === 'failed' ? r.failure_code : null,
      duration_ms: r.duration_ms,
      match_offset_ms: r.match_offset_ms,
      visibility: r.visibility,
      created_at: iso(r.created_at),
      published_at: iso(r.published_at),
      creator: { id: r.created_by, display_name: r.creator_name },
      tags: r.tags,
      likes_count: r.likes_count,
      shares_count: r.shares_count,
      liked_by_me: r.liked_by_me,
      match: { id: r.match_id, public_code: r.public_code, sport: r.sport, starts_at: iso(r.starts_at), timezone: r.timezone, venue_name: r.venue_name },
      media: {
        id: r.media_id,
        width: r.width,
        height: r.height,
        thumbnail_url: ready && r.thumbnail_key ? await this.signer.sign(r.output_bucket!, r.thumbnail_key, expiresAt) : null,
        playback: ready ? await this.playback(r, expiresAt) : null,
      },
    };
  }

  private async playback(r: Pick<HighlightRow, 'media_id' | 'output_bucket' | 'vertical_key'>, expiresAt: number) {
    const token = this.tokens.sign('playback', r.media_id, expiresAt);
    return {
      hls_url: `${this.env.PUBLIC_BASE_URL}/v1/playback/${token}/master.m3u8`,
      mp4_url: r.vertical_key ? await this.signer.sign(r.output_bucket!, r.vertical_key, expiresAt) : null,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    };
  }

  private async page(where: SQL, viewerId: string, cursor: string | undefined, limit: number) {
    const c = decodeCursor<{ p: string; id: string }>(cursor);
    const list = await rows<HighlightRow>(
      this.db,
      sql`SELECT ${columns(viewerId)} ${FROM}
          WHERE ${VISIBLE} AND ${where}
            ${c ? sql`AND (h.published_at, h.id) < (${c.p}::timestamptz, ${c.id}::uuid)` : sql``}
          ORDER BY h.published_at DESC, h.id DESC
          LIMIT ${limit + 1}`,
    );
    const items = list.slice(0, limit);
    const expiresAt = this.playbackExpiry();
    return {
      items: await Promise.all(items.map((r) => this.toHighlight(r, expiresAt))),
      // Xom timestamptz (mikrosekund) — ISO ga o'girilsa ms gacha qisqarib, bir xil ms dagi klip o'tkazib yuborilardi
      next_cursor: list.length > limit ? encodeCursor({ p: String(items.at(-1)!.published_at), id: items.at(-1)!.id }) : null,
    };
  }

  /** `GET /v1/matches/{id}/highlights` — faqat shu match ishtirokchilari (va host, admin). */
  async matchFeed(user: AuthUser, matchId: string, cursor: string | undefined, limit: number) {
    const m = await one(this.db, sql`SELECT 1 FROM matches WHERE id = ${matchId}`);
    if (!m) throw new AppError('NOT_FOUND');
    if (!isAdmin(user)) {
      const ok = await one(
        this.db,
        sql`SELECT 1 WHERE
              EXISTS (SELECT 1 FROM match_participants mp
                      WHERE mp.match_id = ${matchId} AND mp.user_id = ${user.id} AND mp.status IN ${VIEWER_PARTICIPANT_STATUSES})
              OR EXISTS (SELECT 1 FROM host_assignments ha
                         WHERE ha.match_id = ${matchId} AND ha.host_user_id = ${user.id} AND ha.status IN ('accepted', 'arrived', 'completed'))`,
      );
      if (!ok) throw new AppError('FORBIDDEN');
    }
    return this.page(sql`h.match_id = ${matchId}`, user.id, cursor, limit);
  }

  /** `GET /v1/me/highlights` — ishtirok etgan match'lar yoki men teglangan kliplar (`scope=tagged`). */
  async myFeed(userId: string, scope: 'all' | 'tagged', cursor: string | undefined, limit: number) {
    const tagged = sql`EXISTS (SELECT 1 FROM highlight_tags t
                               JOIN user_current_consents c ON c.user_id = t.user_id AND c.purpose = 'media_appearance' AND c.granted
                               WHERE t.highlight_id = h.id AND t.user_id = ${userId})`;
    const where =
      scope === 'tagged'
        ? tagged
        : sql`(${tagged} OR EXISTS (SELECT 1 FROM match_participants mp
                                     WHERE mp.match_id = h.match_id AND mp.user_id = ${userId}
                                       AND mp.status IN ${VIEWER_PARTICIPANT_STATUSES}))`;
    return this.page(where, userId, cursor, limit);
  }

  /** Host ilovasi: shu match'ning barcha kliplari, qayta ishlanayotgan va xato berganlari ham. */
  async hostMatchHighlights(hostId: string, matchId: string) {
    const list = await rows<HighlightRow>(
      this.db,
      sql`SELECT ${columns(hostId)} ${FROM}
          WHERE h.match_id = ${matchId} AND h.deleted_at IS NULL
          ORDER BY h.created_at DESC, h.id DESC LIMIT 100`,
    );
    const expiresAt = this.playbackExpiry();
    return { items: await Promise.all(list.map((r) => this.toHighlight(r, expiresAt))) };
  }

  /** Ko'rish huquqi bilan bitta highlight (yo'q / huquq yo'q — 404, mavjudligi oshkor qilinmaydi). */
  private async visible(user: AuthUser, highlightId: string): Promise<HighlightRow> {
    const r = await one<HighlightRow>(
      this.db,
      sql`SELECT ${columns(user.id)} ${FROM}
          WHERE h.id = ${highlightId} AND ${VISIBLE} ${isAdmin(user) ? sql`` : sql`AND ${viewerCan(user.id)}`}`,
    );
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  async get(user: AuthUser, highlightId: string) {
    return this.toHighlight(await this.visible(user, highlightId));
  }

  /** Like (idempotent): `likes_count` reaksiya bilan bir tranzaksiyada. */
  async setLike(user: AuthUser, highlightId: string, liked: boolean) {
    await this.visible(user, highlightId);
    return this.db.transaction(async (tx) => {
      const changed = liked
        ? await tx.execute(
            sql`INSERT INTO highlight_reactions (highlight_id, user_id, type) VALUES (${highlightId}, ${user.id}, 'like')
                ON CONFLICT DO NOTHING`,
          )
        : await tx.execute(
            sql`DELETE FROM highlight_reactions WHERE highlight_id = ${highlightId} AND user_id = ${user.id} AND type = 'like'`,
          );
      const r = (await one<{ likes_count: number }>(
        tx,
        changed.rowCount
          ? sql`UPDATE highlights SET likes_count = greatest(likes_count + ${liked ? 1 : -1}, 0) WHERE id = ${highlightId} RETURNING likes_count`
          : sql`SELECT likes_count FROM highlights WHERE id = ${highlightId}`,
      ))!;
      return { highlight_id: highlightId, liked, likes_count: r.likes_count };
    });
  }

  /** `POST /v1/highlights/{id}/share` — `highlight_shares` + muddatli imzolangan ochiq havola. */
  async share(user: AuthUser, highlightId: string, channel: ShareChannel, locale: Locale) {
    const h = await this.visible(user, highlightId);
    const share = await this.db.transaction(async (tx) => {
      const s = (await one<{ id: string; expires_at: string; exp: number }>(
        tx,
        sql`INSERT INTO highlight_shares (highlight_id, user_id, channel, expires_at)
            VALUES (${highlightId}, ${user.id}, ${channel}, now() + make_interval(days => ${this.env.SHARE_LINK_TTL_DAYS}))
            RETURNING id, expires_at, extract(epoch FROM expires_at)::bigint AS exp`,
      ))!;
      await tx.execute(sql`UPDATE highlights SET shares_count = shares_count + 1 WHERE id = ${highlightId}`);
      await emit(tx, 'highlight', highlightId, 'HighlightShared', { highlight_id: highlightId, share_id: s.id, channel, user_id: user.id });
      return s;
    });
    const url = `${this.env.PUBLIC_BASE_URL}/h/${this.tokens.sign('share', share.id, Number(share.exp))}`;
    const text = {
      'uz-Latn': `Match Up: ${h.public_code} o'yinidan highlight`,
      'uz-Cyrl': `Match Up: ${h.public_code} o'yinidan highlight`,
      ru: `Match Up: хайлайт игры ${h.public_code}`,
      en: `Match Up: highlight from ${h.public_code}`,
    }[locale];
    return { share_id: share.id, channel, url, text, expires_at: iso(share.expires_at) };
  }

  /** Ochiq havola: imzo + `highlight_shares` muddati; ism va teglar ko'rsatilmaydi. */
  async shared(token: string) {
    const t = this.tokens.verify('share', token);
    if (!t) throw new AppError('NOT_FOUND');
    const r = await one<HighlightRow & { share_expires_at: string; share_exp: number }>(
      this.db,
      sql`SELECT ${columns(null)}, hs.expires_at AS share_expires_at, extract(epoch FROM hs.expires_at)::bigint AS share_exp
          FROM highlight_shares hs
          JOIN highlights h ON h.id = hs.highlight_id
          JOIN media_assets ma ON ma.id = h.media_asset_id
          JOIN users cu ON cu.id = h.created_by
          JOIN matches m ON m.id = h.match_id
          JOIN sports s ON s.id = m.sport_id
          JOIN pitches p ON p.id = m.pitch_id
          JOIN venues v ON v.id = p.venue_id
          WHERE hs.id = ${t.id} AND hs.expires_at > now() AND ${VISIBLE}`,
    );
    if (!r) throw new AppError('NOT_FOUND');
    const expiresAt = Math.min(Number(r.share_exp), this.playbackExpiry());
    return {
      id: r.id,
      title: r.title,
      duration_ms: r.duration_ms,
      width: r.width,
      height: r.height,
      match: { public_code: r.public_code, sport: r.sport, starts_at: iso(r.starts_at), timezone: r.timezone, venue_name: r.venue_name },
      thumbnail_url: r.thumbnail_key ? await this.signer.sign(r.output_bucket!, r.thumbnail_key, expiresAt) : null,
      playback: await this.playback(r, expiresAt),
      expires_at: iso(r.share_expires_at),
    };
  }

  // -------------------------------------------------------------------------
  // HLS playlist'lar (token bilan, Authorization header'siz)
  // -------------------------------------------------------------------------
  private async playbackMedia(token: string): Promise<{ media: PlaybackMedia; expiresAt: number }> {
    const t = this.tokens.verify('playback', token);
    if (!t) throw new AppError('NOT_FOUND');
    // Token faqat ko'rish huquqi borlarga beriladi; bu yerda — media hozir ham ko'rinadimi (klip yoki yozuv kamerasi)
    const media = await one<PlaybackMedia>(
      this.db,
      sql`SELECT ma.id, ma.output_bucket, ma.object_key, ma.renditions
          FROM media_assets ma
          WHERE ma.id = ${t.id} AND ma.status = 'ready'
            AND (EXISTS (SELECT 1 FROM highlights h WHERE h.media_asset_id = ma.id AND ${VISIBLE})
                 OR EXISTS (SELECT 1 FROM recording_cameras rc WHERE rc.media_asset_id = ma.id AND rc.status = 'ready'))`,
    );
    if (!media?.renditions?.length) throw new AppError('NOT_FOUND');
    return { media, expiresAt: t.expiresAt };
  }

  async masterPlaylist(token: string): Promise<string> {
    const { media } = await this.playbackMedia(token);
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];
    for (const r of [...media.renditions].sort((a, b) => b.bandwidth - a.bandwidth)) {
      const codecs = r.codecs ? `,CODECS="${r.codecs}"` : '';
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.width}x${r.height}${codecs}`, `${r.name}.m3u8`);
    }
    return lines.join('\n') + '\n';
  }

  async variantPlaylist(token: string, name: string): Promise<string> {
    const { media, expiresAt } = await this.playbackMedia(token);
    const r = media.renditions.find((x) => x.name === name);
    if (!r) throw new AppError('NOT_FOUND');
    let text = this.playlists.get(r.playlist_key);
    if (text === undefined) {
      text = await this.storage.getText(media.output_bucket, r.playlist_key);
      this.playlists.set(r.playlist_key, text);
    }
    const dir = r.playlist_key.slice(0, r.playlist_key.lastIndexOf('/') + 1);
    const prefix = media.object_key.slice(0, media.object_key.lastIndexOf('/') + 1);
    const sign = (uri: string) => {
      const key = dir + uri;
      if (!key.startsWith(prefix) || uri.includes('..') || /^[a-z]+:/i.test(uri)) throw new AppError('NOT_FOUND');
      return this.signer.sign(media.output_bucket, key, expiresAt);
    };
    const out: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        // #EXT-X-MAP:URI="init.mp4" (fMP4) — atributdagi URI ham imzolanadi
        const m = /URI="([^"]+)"/.exec(line);
        out.push(m ? line.replace(m[0], `URI="${await sign(m[1]!)}"`) : line);
      } else {
        out.push(await sign(line));
      }
    }
    return out.join('\n') + '\n';
  }
}

export { SHARE_CHANNELS };
