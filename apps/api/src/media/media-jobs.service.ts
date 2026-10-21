import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { emit } from '../common/outbox';
import { DB, type Db, type Executor, one } from '../db/db';
import { HIGHLIGHT_LIMITS, type Rendition } from './media.service';
import { ObjectStorage } from './storage';

interface JobRow {
  id: string;
  media_asset_id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempts: number;
  input: Record<string, unknown>;
  heartbeat_fresh: boolean;
  media_status: string;
  bucket: string;
  object_key: string;
  content_type: string;
  size_bytes: number | null;
  duration_ms: number | null;
  checksum_sha256: Buffer | null;
  match_id: string | null;
}

export interface JobReadyResult {
  status: 'ready';
  worker_version: string;
  output: {
    hls_master_key: string;
    renditions: Rendition[];
    thumbnail_key: string;
    vertical_key?: string | null;
    duration_ms: number;
    width: number;
    height: number;
    has_audio?: boolean;
    probe?: Record<string, unknown>;
  };
}

export interface JobFailedResult {
  status: 'failed';
  worker_version: string;
  error_code: string;
  error_message?: string;
}

export type JobResult = JobReadyResult | JobFailedResult;

/** Worker yaroqli natija kaliti shu job'ning chiqish prefiksi ichida bo'lishi shart. */
function insidePrefix(prefix: string, key: string | null | undefined): boolean {
  return !key || (key.startsWith(prefix) && !key.includes('..'));
}

/**
 * Worker -> API ichki oqimi (servis token bilan). Worker DB'ga to'g'ridan-to'g'ri yozmaydi (AI_CAM §7):
 * holat `media_processing_jobs` da API tomonidan yuritiladi, natija `media_assets` / `highlights` ga
 * bitta tranzaksiyada yoziladi va `HighlightReady` outbox event'i chiqadi.
 */
@Injectable()
export class MediaJobsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: ObjectStorage,
  ) {}

  private outputPrefix(j: Pick<JobRow, 'object_key'>): string {
    // highlights/{match}/{media}/source.mp4 -> highlights/{match}/{media}/
    return j.object_key.slice(0, j.object_key.lastIndexOf('/') + 1);
  }

  private async job(jobId: string, ex: Executor = this.db, lock = false): Promise<JobRow> {
    const j = await one<JobRow>(
      ex,
      sql`SELECT j.id, j.media_asset_id, j.type, j.status, j.attempts, j.input,
                 coalesce(j.heartbeat_at > now() - interval '2 minutes', false) AS heartbeat_fresh,
                 ma.status AS media_status, ma.bucket, ma.object_key, ma.content_type, ma.size_bytes, ma.duration_ms,
                 ma.checksum_sha256, ma.context->>'match_id' AS match_id
          FROM media_processing_jobs j JOIN media_assets ma ON ma.id = j.media_asset_id
          WHERE j.id = ${jobId} ${lock ? sql`FOR UPDATE OF j` : sql``}`,
    );
    if (!j) throw new AppError('NOT_FOUND');
    return j;
  }

  /**
   * Worker job'ni oldi. Takroriy yetkazish (at-least-once): tugagan job — 409 (worker ACK qiladi va tashlaydi),
   * boshqa worker hozir ishlayotgan job (heartbeat < 2 daq) — 409; heartbeat'i to'xtagan job qayta olinadi.
   */
  async start(jobId: string, workerVersion: string) {
    const j = await this.job(jobId);
    if (j.media_status === 'deleted' && ['queued', 'running'].includes(j.status)) {
      await this.db.execute(sql`UPDATE media_processing_jobs SET status = 'cancelled', finished_at = now() WHERE id = ${j.id}`);
      throw new AppError('INVALID_STATE', { status: 'cancelled' });
    }
    const started = await one<{ attempts: number }>(
      this.db,
      sql`UPDATE media_processing_jobs
          SET status = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now()),
              heartbeat_at = now(), stage = 'probe', worker_version = ${workerVersion}
          WHERE id = ${j.id}
            AND (status = 'queued' OR (status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < now() - interval '2 minutes')))
          RETURNING attempts`,
    );
    if (!started) throw new AppError('INVALID_STATE', { status: j.status });
    const prefix = this.outputPrefix(j);
    return {
      job_id: j.id,
      type: j.type,
      attempt: started.attempts,
      profile: (j.input.profile as string | undefined) ?? 'highlight_v1',
      media: {
        id: j.media_asset_id,
        content_type: j.content_type,
        size_bytes: j.size_bytes,
        declared_duration_ms: j.duration_ms,
        checksum_sha256: j.checksum_sha256 ? Buffer.from(j.checksum_sha256).toString('hex') : null,
      },
      source: { bucket: j.bucket, key: j.object_key },
      output: { bucket: this.storage.mediaBucket, prefix },
      limits: { max_duration_ms: HIGHLIGHT_LIMITS.maxDurationMs, max_bytes: HIGHLIGHT_LIMITS.maxBytes },
    };
  }

  /** Bosqich + heartbeat (probe -> validate -> hls -> thumbnail -> vertical -> upload). */
  async progress(jobId: string, stage: string) {
    const r = await this.db.execute(
      sql`UPDATE media_processing_jobs SET stage = ${stage}, heartbeat_at = now() WHERE id = ${jobId} AND status = 'running'`,
    );
    if (!r.rowCount) {
      const j = await this.job(jobId);
      throw new AppError('INVALID_STATE', { status: j.status });
    }
    return { ok: true };
  }

  /** Yakuniy natija (idempotent: takroriy `ready` — o'zgarishsiz 200). */
  async result(jobId: string, body: JobResult) {
    return this.db.transaction(async (tx) => {
      const j = await this.job(jobId, tx, true);
      if (j.status === 'succeeded') return { job_id: j.id, status: 'succeeded' as const };
      if (j.status === 'cancelled') throw new AppError('INVALID_STATE', { status: j.status });
      // Kech kelgan muvaffaqiyat (dead-letter'dan keyin boshqa yetkazish) qabul qilinadi; kech kelgan xato — yo'q
      if (j.status === 'failed' && body.status === 'failed') return { job_id: j.id, status: 'failed' as const };

      if (body.status === 'failed') {
        await tx.execute(
          sql`UPDATE media_processing_jobs
              SET status = 'failed', error = ${`${body.error_code}: ${body.error_message ?? ''}`.slice(0, 2000)},
                  worker_version = ${body.worker_version}, finished_at = now(), heartbeat_at = now()
              WHERE id = ${j.id}`,
        );
        await tx.execute(
          sql`UPDATE media_assets SET status = 'failed', failure_code = ${body.error_code.slice(0, 64)}, updated_at = now()
              WHERE id = ${j.media_asset_id} AND status = 'processing'`,
        );
        return { job_id: j.id, status: 'failed' as const };
      }

      const o = body.output;
      const prefix = this.outputPrefix(j);
      const keys = [o.hls_master_key, o.thumbnail_key, o.vertical_key, ...o.renditions.map((r) => r.playlist_key)];
      if (!keys.every((k) => insidePrefix(prefix, k)) || !o.renditions.length) {
        throw new AppError('VALIDATION_FAILED', {}, [{ field: 'output', code: 'invalid', message: `kalitlar ${prefix} ichida bo'lishi kerak` }]);
      }
      const duration = Math.round(o.duration_ms);
      await tx.execute(
        sql`UPDATE media_processing_jobs
            SET status = 'succeeded', stage = 'done', output = ${JSON.stringify(o)}::jsonb, error = NULL,
                worker_version = ${body.worker_version}, finished_at = now(), heartbeat_at = now()
            WHERE id = ${j.id}`,
      );
      const media = await one<{ id: string }>(
        tx,
        sql`UPDATE media_assets
            SET status = 'ready', output_bucket = ${this.storage.mediaBucket}, playback_path = ${o.hls_master_key},
                thumbnail_key = ${o.thumbnail_key}, vertical_key = ${o.vertical_key ?? null},
                renditions = ${JSON.stringify(o.renditions)}::jsonb, duration_ms = ${duration},
                width = ${Math.round(o.width)}, height = ${Math.round(o.height)}, failure_code = NULL,
                processed_at = now(), updated_at = now()
            WHERE id = ${j.media_asset_id} AND status IN ('processing', 'failed') RETURNING id`,
      );
      if (!media) return { job_id: j.id, status: 'succeeded' as const }; // media o'chirilgan/rad etilgan

      const h = await one<{ id: string; match_id: string; created_by: string }>(
        tx,
        sql`UPDATE highlights SET duration_ms = ${duration > 0 ? duration : null}, published_at = coalesce(published_at, now()),
                                  updated_at = now()
            WHERE media_asset_id = ${j.media_asset_id} AND deleted_at IS NULL
            RETURNING id, match_id, created_by`,
      );
      if (h) {
        const tagged = await tx.execute(sql`SELECT user_id FROM highlight_tags WHERE highlight_id = ${h.id}`);
        await emit(tx, 'highlight', h.id, 'HighlightReady', {
          highlight_id: h.id,
          match_id: h.match_id,
          media_id: j.media_asset_id,
          created_by: h.created_by,
          tagged_user_ids: (tagged.rows as { user_id: string }[]).map((r) => r.user_id),
          duration_ms: duration,
        });
      }
      return { job_id: j.id, status: 'succeeded' as const, highlight_id: h?.id ?? null };
    });
  }
}
