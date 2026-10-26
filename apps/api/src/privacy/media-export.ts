import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { type Executor, iso, rows } from '../db/db';
import { MediaUrlSigner, ObjectStorage } from '../media/storage';
import { MediaTokens } from '../media/tokens';

/** S3 presigned URL (SigV4) 7 kundan uzoq bo'lolmaydi. */
const PRESIGN_MAX_S = 7 * 86_400 - 300;

interface HighlightRow {
  highlight_id: string;
  match_code: string;
  title: string | null;
  source: string;
  duration_ms: number | null;
  created_at: string;
  published_at: string | null;
  moderation_status: string;
  tagged: boolean;
  uploaded: boolean;
  media_id: string;
  media_status: string;
  raw_bucket: string;
  raw_key: string;
  output_bucket: string | null;
  thumbnail_key: string | null;
  vertical_key: string | null;
  playable: boolean;
}

interface RecordingRow {
  camera_id: string;
  match_code: string;
  position: string;
  status: string;
  started_at: string;
  stopped_at: string | null;
  duration_ms: number | null;
  media_id: string | null;
  media_status: string | null;
  raw_bucket: string | null;
  raw_key: string | null;
  playable: boolean;
}

/**
 * GDPR eksportining `media` bo'limi (Art. 15/20): foydalanuvchiga bevosita tegishli videolar —
 * u teglangan highlight'lar, u yuklagan kliplar (host) va u yozgan to'liq o'yin kameralari.
 * Boshqa o'yinchilarning videolari (faqat qatnashgan o'yinlar) kirmaydi — ular ilovada ko'rinadi.
 *
 * Fayllar nusxalanmaydi: JSON'da eksport bilan birga tugaydigan imzolangan havolalar (S3/CloudFront,
 * HLS — `/v1/playback/{token}`). Asl yuklangan fayl (raw) saqlanish muddati ichida bo'lsa — u ham.
 */
@Injectable()
export class MediaExport {
  private readonly log = new Logger('MediaExport');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly storage: ObjectStorage,
    private readonly signer: MediaUrlSigner,
    private readonly tokens: MediaTokens,
  ) {}

  async section(ex: Executor, userId: string, expiresAt: Date) {
    // Havolalar eksport fayli bilan birga tugaydi (presigned — 7 kundan oshmaydi)
    const exp = Math.min(Math.floor(expiresAt.getTime() / 1000), Math.floor(Date.now() / 1000) + PRESIGN_MAX_S);

    const highlights = await rows<HighlightRow>(
      ex,
      sql`SELECT h.id AS highlight_id, m.public_code AS match_code, h.title, h.source, h.duration_ms, h.created_at,
                 h.published_at, h.moderation_status,
                 EXISTS (SELECT 1 FROM highlight_tags t WHERE t.highlight_id = h.id AND t.user_id = ${userId}) AS tagged,
                 h.created_by = ${userId} AS uploaded,
                 ma.id AS media_id, ma.status AS media_status, ma.bucket AS raw_bucket, ma.object_key AS raw_key,
                 ma.output_bucket, ma.thumbnail_key, ma.vertical_key,
                 (h.published_at IS NOT NULL AND h.moderation_status <> 'rejected' AND ma.status = 'ready') AS playable
          FROM highlights h
          JOIN media_assets ma ON ma.id = h.media_asset_id
          JOIN matches m ON m.id = h.match_id
          WHERE h.deleted_at IS NULL AND ma.status <> 'deleted'
            AND (h.created_by = ${userId}
                 OR EXISTS (SELECT 1 FROM highlight_tags t WHERE t.highlight_id = h.id AND t.user_id = ${userId}))
          ORDER BY h.created_at, h.id`,
    );
    const recordings = await rows<RecordingRow>(
      ex,
      sql`SELECT rc.id AS camera_id, m.public_code AS match_code, rc.position, rc.status, rc.started_at, rc.stopped_at,
                 rc.duration_ms, ma.id AS media_id, ma.status AS media_status, ma.bucket AS raw_bucket, ma.object_key AS raw_key,
                 (rc.status = 'ready' AND ma.status = 'ready'
                  AND coalesce(ma.processed_at > now() - make_interval(days => ${this.env.MEDIA_RECORDING_EXPIRATION_DAYS}), true)) AS playable
          FROM recording_cameras rc
          JOIN recording_sessions rs ON rs.id = rc.session_id
          JOIN matches m ON m.id = rs.match_id
          LEFT JOIN media_assets ma ON ma.id = rc.media_asset_id AND ma.status <> 'deleted'
          WHERE rc.recorded_by = ${userId}
          ORDER BY rc.started_at, rc.id`,
    );

    return {
      links_expire_at: new Date(exp * 1000).toISOString(),
      notes: [
        "Havolalar shu muddatgacha ishlaydi; muddat o'tgach yangi eksport so'rang.",
        "hls — oqim (master playlist): VLC'da ochiladi yoki `ffmpeg -i <hls> -c copy video.mp4` bilan bitta faylga yig'iladi.",
        "original — siz yoki host yuklagan asl fayl; saqlanish muddati o'tgan bo'lsa null. hls — to'liq o'yin yozuvi ko'rish muddati o'tgan bo'lsa null.",
      ],
      highlights: await Promise.all(
        highlights.map(async (h) => {
          const ready = h.media_status === 'ready' && !!h.output_bucket;
          return {
            highlight_id: h.highlight_id,
            match_code: h.match_code,
            relation: [...(h.tagged ? ['tagged'] : []), ...(h.uploaded ? ['uploaded'] : [])],
            title: h.title,
            source: h.source,
            duration_ms: h.duration_ms,
            created_at: iso(h.created_at),
            published_at: iso(h.published_at),
            moderation_status: h.moderation_status,
            status: h.media_status,
            files: {
              video_mp4: ready && h.vertical_key ? await this.signer.sign(h.output_bucket!, h.vertical_key, exp) : null,
              thumbnail: ready && h.thumbnail_key ? await this.signer.sign(h.output_bucket!, h.thumbnail_key, exp) : null,
              hls: h.playable ? this.hls(h.media_id, exp) : null,
              original: await this.original(h.raw_bucket, h.raw_key, `matchup-${h.match_code}-${h.highlight_id}`, exp),
            },
          };
        }),
      ),
      recordings: await Promise.all(
        recordings.map(async (r) => ({
          camera_id: r.camera_id,
          match_code: r.match_code,
          position: r.position,
          status: r.status,
          started_at: iso(r.started_at),
          stopped_at: iso(r.stopped_at),
          duration_ms: r.duration_ms,
          files: {
            hls: r.playable && r.media_id ? this.hls(r.media_id, exp) : null,
            original:
              r.raw_bucket && r.raw_key
                ? await this.original(r.raw_bucket, r.raw_key, `matchup-${r.match_code}-${r.position}-${r.camera_id}`, exp)
                : null,
          },
        })),
      ),
    };
  }

  private hls(mediaId: string, exp: number) {
    return `${this.env.PUBLIC_BASE_URL}/v1/playback/${this.tokens.sign('playback', mediaId, exp)}/master.m3u8`;
  }

  /** Asl fayl hali bormi (raw bucket lifecycle) — bo'lsa yuklab olish (attachment) havolasi. */
  private async original(bucket: string, key: string, name: string, exp: number): Promise<string | null> {
    try {
      if (!(await this.storage.head(bucket, key))) return null;
    } catch (err) {
      // ListBucket'siz yo'q obyekt 403 qaytaradi — ham shu, ham vaqtinchalik xato: havolasiz
      this.log.debug(`original ${key}: ${(err as Error).message}`);
      return null;
    }
    const ext = /\.[a-z0-9]{2,5}$/i.exec(key)?.[0] ?? '';
    const ttl = Math.max(60, exp - Math.floor(Date.now() / 1000));
    return this.storage.presignGet(bucket, key, ttl, `attachment; filename="${name}${ext}"`);
  }
}
