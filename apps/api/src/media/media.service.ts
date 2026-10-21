import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { AppError } from '../common/errors';
import { DB, type Db, type Executor, iso, one, rows } from '../db/db';
import { JOB_ROUTES, MEDIA_JOB_QUEUES, type MediaJobQueue, type MediaJobType } from './queue';
import { ObjectStorage, s3ErrorName, type UploadedPart } from './storage';

/** Host highlight'i: ≤ 60 s, ≤ 150 MB, mp4/mov (ARCHITECTURE §4.10). */
export const HIGHLIGHT_LIMITS = {
  maxBytes: 150 * 1024 * 1024,
  maxDurationMs: 60_000,
  contentTypes: ['video/mp4', 'video/quicktime'] as const,
  maxTags: 30,
};

/** Highlight'ni ko'ra oladigan roster holatlari (no_show — o'yinda bo'lmagan, videoda yo'q). */
export const VIEWER_PARTICIPANT_STATUSES = sql`('confirmed', 'checked_in')`;
/** Host highlight yuklay oladigan tayinlov holatlari (o'yindan keyin ham — completed). */
const UPLOADER_ASSIGNMENT_STATUSES = sql`('accepted', 'arrived', 'completed')`;

export interface HighlightUploadInput {
  content_type: (typeof HIGHLIGHT_LIMITS.contentTypes)[number];
  size_bytes: number;
  duration_ms: number;
  recorded_at?: string;
  match_offset_ms?: number;
  title?: string;
  tagged_user_ids?: string[];
  tagged_participant_ids?: string[];
}

interface UploadContext {
  kind: 'highlight';
  match_id: string;
  title?: string | null;
  match_offset_ms?: number | null;
  tagged_user_ids?: string[];
  tagged_participant_ids?: string[];
}

export interface MediaRow {
  id: string;
  owner_user_id: string | null;
  kind: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'rejected' | 'deleted';
  bucket: string;
  object_key: string;
  content_type: string;
  size_bytes: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  checksum_sha256: Buffer | null;
  upload_id: string | null;
  upload_part_size: number | null;
  upload_expires_at: string | null;
  upload_expired: boolean;
  context: UploadContext | null;
  output_bucket: string | null;
  playback_path: string | null;
  thumbnail_key: string | null;
  vertical_key: string | null;
  renditions: Rendition[] | null;
  failure_code: string | null;
  recorded_at: string | null;
  created_at: string;
  uploaded_at: string | null;
  processed_at: string | null;
  highlight_id: string | null;
  job_status: string | null;
  job_stage: string | null;
}

export interface Rendition {
  name: string;
  width: number;
  height: number;
  bandwidth: number;
  codecs?: string;
  playlist_key: string;
}

const MEDIA_COLUMNS = sql`
  ma.id, ma.owner_user_id, ma.kind, ma.status, ma.bucket, ma.object_key, ma.content_type, ma.size_bytes,
  ma.duration_ms, ma.width, ma.height, ma.checksum_sha256, ma.upload_id, ma.upload_part_size, ma.upload_expires_at,
  coalesce(ma.upload_expires_at < now(), false) AS upload_expired, ma.context, ma.output_bucket, ma.playback_path,
  ma.thumbnail_key, ma.vertical_key, ma.renditions, ma.failure_code, ma.recorded_at, ma.created_at, ma.uploaded_at,
  ma.processed_at,
  (SELECT h.id FROM highlights h WHERE h.media_asset_id = ma.id) AS highlight_id,
  j.status AS job_status, j.stage AS job_stage`;

const MEDIA_FROM = sql`
  FROM media_assets ma
  LEFT JOIN LATERAL (SELECT status, stage FROM media_processing_jobs
                     WHERE media_asset_id = ma.id ORDER BY queued_at DESC LIMIT 1) j ON true`;

export function partCount(size: number, partSize: number): number {
  return Math.max(1, Math.ceil(size / partSize));
}

/** `part_number` uchun aniq bayt hajmi (oxirgi qism qolgan qism). */
export function partLength(size: number, partSize: number, partNumber: number): number {
  const n = partCount(size, partSize);
  return partNumber < n ? partSize : size - partSize * (n - 1);
}

/** `media_assets` qatori -> API `MediaAsset`. */
export function toMediaAsset(m: MediaRow) {
  return {
    id: m.id,
    kind: m.kind,
    status: m.status,
    content_type: m.content_type,
    size_bytes: m.size_bytes,
    duration_ms: m.duration_ms,
    width: m.width,
    height: m.height,
    match_id: m.context?.match_id ?? null,
    highlight_id: m.highlight_id,
    processing: m.job_status ? { status: m.job_status, stage: m.job_stage } : null,
    failure_code: m.failure_code,
    created_at: iso(m.created_at),
    uploaded_at: iso(m.uploaded_at),
    processed_at: iso(m.processed_at),
  };
}

function parseChecksum(v: string | undefined): Buffer | null {
  if (!v) return null;
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, 'hex');
  const b = Buffer.from(v, 'base64');
  if (b.length === 32 && /^[A-Za-z0-9+/]{43}=$/.test(v)) return b;
  throw new AppError('VALIDATION_FAILED', {}, [
    { field: 'checksum_sha256', code: 'invalid', message: 'SHA-256: 64 ta hex yoki base64 (44 belgi)' },
  ]);
}

/**
 * Media yuklash: S3 multipart (presigned, davom ettiriladigan) -> yakunlash -> qayta ishlash navbati.
 * Highlight qatori faqat yuklash yakunlanganda yaratiladi; feed'ga worker natijasidan keyin chiqadi.
 */
@Injectable()
export class MediaService {
  private readonly log = new Logger('Media');
  private readonly queues: Map<string, MediaJobQueue>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly storage: ObjectStorage,
    @Inject(MEDIA_JOB_QUEUES) queues: MediaJobQueue[],
  ) {
    this.queues = new Map(queues.map((q) => [q.transport, q]));
  }

  private async load(ex: Executor, mediaId: string, lock = false): Promise<MediaRow | undefined> {
    return one<MediaRow>(
      ex,
      lock
        ? sql`SELECT ${MEDIA_COLUMNS} ${MEDIA_FROM} WHERE ma.id = ${mediaId} FOR UPDATE OF ma`
        : sql`SELECT ${MEDIA_COLUMNS} ${MEDIA_FROM} WHERE ma.id = ${mediaId}`,
    );
  }

  /** Faqat egasi (yuklagan host) ko'radi; boshqalarga — 404 (mavjudligi oshkor qilinmaydi). */
  private async owned(userId: string, mediaId: string): Promise<MediaRow> {
    const m = await this.load(this.db, mediaId);
    if (!m || m.owner_user_id !== userId || m.status === 'deleted') throw new AppError('NOT_FOUND');
    return m;
  }

  /** Host o'yinga tayinlangan (o'yindan oldin, davomida yoki keyin) va match bekor qilinmagan. */
  async requireUploader(userId: string, matchId: string): Promise<void> {
    const ok = await one(
      this.db,
      sql`SELECT 1 FROM host_assignments ha JOIN matches m ON m.id = ha.match_id
          WHERE ha.match_id = ${matchId} AND ha.host_user_id = ${userId}
            AND ha.status IN ${UPLOADER_ASSIGNMENT_STATUSES} AND m.status <> 'cancelled'`,
    );
    if (!ok) throw new AppError('FORBIDDEN');
  }

  private presignParts(m: Pick<MediaRow, 'bucket' | 'object_key' | 'upload_id' | 'size_bytes' | 'upload_part_size'>, numbers: number[]) {
    const ttl = this.env.MEDIA_UPLOAD_URL_TTL_SEC;
    const size = m.size_bytes!;
    const partSize = m.upload_part_size!;
    return Promise.all(
      numbers.map(async (n) => ({
        part_number: n,
        size_bytes: partLength(size, partSize, n),
        url: await this.storage.presignPart(m.bucket, m.object_key, m.upload_id!, n, partLength(size, partSize, n), ttl),
      })),
    );
  }

  private uploadDescriptor(m: MediaRow, parts: Awaited<ReturnType<MediaService['presignParts']>>, uploaded: UploadedPart[] = []) {
    return {
      type: 's3_multipart' as const,
      upload_id: m.upload_id,
      part_size_bytes: m.upload_part_size,
      part_count: partCount(m.size_bytes!, m.upload_part_size!),
      expires_at: new Date(Date.now() + this.env.MEDIA_UPLOAD_URL_TTL_SEC * 1000).toISOString(),
      session_expires_at: iso(m.upload_expires_at),
      uploaded_parts: uploaded,
      parts,
    };
  }

  /** `POST /v1/host/matches/{id}/highlights/uploads` */
  async initHighlightUpload(hostId: string, matchId: string, input: HighlightUploadInput) {
    await this.requireUploader(hostId, matchId);
    const ext = input.content_type === 'video/quicktime' ? 'mov' : 'mp4';
    const { id } = (await one<{ id: string }>(this.db, sql`SELECT uuidv7() AS id`))!;
    const key = `highlights/${matchId}/${id}/source.${ext}`;
    const bucket = this.storage.rawBucket;
    const uploadId = await this.storage.createMultipart(bucket, key, input.content_type);
    const context: UploadContext = {
      kind: 'highlight',
      match_id: matchId,
      title: input.title ?? null,
      match_offset_ms: input.match_offset_ms ?? null,
      tagged_user_ids: [...new Set(input.tagged_user_ids ?? [])],
      tagged_participant_ids: [...new Set(input.tagged_participant_ids ?? [])],
    };
    try {
      await this.db.execute(
        sql`INSERT INTO media_assets (id, owner_user_id, kind, status, storage_region, bucket, object_key, content_type,
                                      size_bytes, duration_ms, upload_id, upload_part_size, upload_expires_at, recorded_at, context)
            VALUES (${id}, ${hostId}, 'video', 'uploading', ${this.env.MEDIA_STORAGE_REGION}, ${bucket}, ${key},
                    ${input.content_type}, ${input.size_bytes}, ${input.duration_ms}, ${uploadId}, ${this.env.MEDIA_UPLOAD_PART_SIZE},
                    now() + make_interval(hours => ${this.env.MEDIA_UPLOAD_SESSION_HOURS}), ${input.recorded_at ?? null},
                    ${JSON.stringify(context)}::jsonb)`,
      );
    } catch (err) {
      await this.storage.abortMultipart(bucket, key, uploadId).catch(() => undefined);
      throw err;
    }
    const m = (await this.load(this.db, id))!;
    const parts = await this.presignParts(m, Array.from({ length: partCount(input.size_bytes, m.upload_part_size!) }, (_, i) => i + 1));
    return { media_id: id, media: toMediaAsset(m), upload: this.uploadDescriptor(m, parts) };
  }

  /** `GET /v1/media/{id}/upload` — uzilgan yuklashni davom ettirish: yuklangan qismlar + qolganlariga yangi URL'lar. */
  async resumeUpload(userId: string, mediaId: string) {
    const m = await this.owned(userId, mediaId);
    if (m.status !== 'uploading') throw new AppError('INVALID_STATE');
    if (m.upload_expired) throw new AppError('UPLOAD_EXPIRED');
    let uploaded: UploadedPart[];
    try {
      uploaded = await this.storage.listParts(m.bucket, m.object_key, m.upload_id!);
    } catch (err) {
      if (s3ErrorName(err) === 'NoSuchUpload') throw new AppError('UPLOAD_EXPIRED');
      throw err;
    }
    const total = partCount(m.size_bytes!, m.upload_part_size!);
    // Hajmi to'liq bo'lmagan qism (uzilgan PUT) qayta yuklanadi
    const done = uploaded.filter((p) => p.part_number <= total && p.size_bytes === partLength(m.size_bytes!, m.upload_part_size!, p.part_number));
    const doneSet = new Set(done.map((p) => p.part_number));
    const missing = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !doneSet.has(n));
    return { media_id: m.id, media: toMediaAsset(m), upload: this.uploadDescriptor(m, await this.presignParts(m, missing), done) };
  }

  /** `DELETE /v1/media/{id}/upload` — host yuklashni bekor qildi. */
  async abortUpload(userId: string, mediaId: string): Promise<void> {
    const m = await this.owned(userId, mediaId);
    if (m.status !== 'uploading') throw new AppError('INVALID_STATE');
    await this.storage.abortMultipart(m.bucket, m.object_key, m.upload_id!);
    await this.db.execute(
      sql`UPDATE media_assets SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = ${m.id} AND status = 'uploading'`,
    );
  }

  async get(userId: string, mediaId: string) {
    return toMediaAsset(await this.owned(userId, mediaId));
  }

  /**
   * `POST /v1/media/{id}/complete` — CompleteMultipartUpload -> `processing` -> highlight (+ teglar) -> job navbatga.
   * Idempotent: takroriy chaqiruv (javob yo'qolgan) o'sha natijani qaytaradi.
   */
  async complete(userId: string, mediaId: string, body: { parts: { part_number: number; etag: string }[]; checksum_sha256?: string }) {
    const m = await this.owned(userId, mediaId);
    if (m.status === 'processing' || m.status === 'ready') return this.completed(mediaId);
    if (m.status !== 'uploading' || !m.context || m.context.kind !== 'highlight') throw new AppError('INVALID_STATE');
    if (m.upload_expired) throw new AppError('UPLOAD_EXPIRED');
    const checksum = parseChecksum(body.checksum_sha256);

    const total = partCount(m.size_bytes!, m.upload_part_size!);
    const parts = [...body.parts].sort((a, b) => a.part_number - b.part_number);
    if (parts.length !== total || parts.some((p, i) => p.part_number !== i + 1)) {
      throw new AppError('UPLOAD_INCOMPLETE', {}, [
        { field: 'parts', code: 'incomplete', message: `1..${total} qismlarning barchasi ETag bilan kerak` },
      ]);
    }

    try {
      await this.storage.completeMultipart(m.bucket, m.object_key, m.upload_id!, parts);
    } catch (err) {
      const name = s3ErrorName(err);
      // NoSuchUpload: oldingi `complete` S3'da muvaffaqiyatli bo'lgan, lekin javob client'ga yetmagan
      if (name === 'NoSuchUpload') {
        if (!(await this.storage.head(m.bucket, m.object_key))) throw new AppError('UPLOAD_EXPIRED');
      } else if (name === 'InvalidPart' || name === 'InvalidPartOrder' || name === 'EntityTooSmall') {
        throw new AppError('UPLOAD_INCOMPLETE');
      } else {
        throw err;
      }
    }

    const head = await this.storage.head(m.bucket, m.object_key);
    if (!head) throw new AppError('UPLOAD_INCOMPLETE');
    if (head.size > HIGHLIGHT_LIMITS.maxBytes) {
      await this.storage.delete(m.bucket, m.object_key).catch(() => undefined);
      await this.db.execute(sql`UPDATE media_assets SET status = 'rejected', failure_code = 'FILE_TOO_LARGE', updated_at = now() WHERE id = ${m.id}`);
      throw new AppError('VALIDATION_FAILED', {}, [{ field: 'size_bytes', code: 'too_big', message: 'Fayl 150 MB dan katta' }]);
    }

    const ctx = m.context;
    const jobId = await this.db.transaction(async (tx) => {
      const updated = await one<{ id: string }>(
        tx,
        sql`UPDATE media_assets SET status = 'processing', size_bytes = ${head.size}, checksum_sha256 = ${checksum},
                                    uploaded_at = now(), updated_at = now()
            WHERE id = ${m.id} AND status = 'uploading' RETURNING id`,
      );
      if (!updated) return undefined; // parallel complete yutdi
      const h = (await one<{ id: string }>(
        tx,
        sql`INSERT INTO highlights (match_id, media_asset_id, created_by, source, title, clip_started_at, match_offset_ms,
                                    duration_ms, visibility)
            VALUES (${ctx.match_id}, ${m.id}, ${userId}, 'host_manual', ${ctx.title ?? null}, ${m.recorded_at},
                    ${ctx.match_offset_ms ?? null}, ${m.duration_ms && m.duration_ms > 0 ? m.duration_ms : null}, 'participants')
            RETURNING id`,
      ))!;
      await this.tag(tx, h.id, ctx, userId);
      return this.createJob(tx, m.id, 'transcode', { profile: 'highlight_v1', highlight_id: h.id, match_id: ctx.match_id });
    });
    if (jobId) await this.dispatch(jobId);
    return this.completed(mediaId);
  }

  private async completed(mediaId: string) {
    const m = (await this.load(this.db, mediaId))!;
    return { media_id: m.id, status: m.status, highlight_id: m.highlight_id, media: toMediaAsset(m) };
  }

  /**
   * Teglash: faqat shu match'ning roster'idagi va `media_appearance` consent'i (joriy holati) bor o'yinchilar.
   * Qolganlari jim tashlab yuboriladi (consent holati host'ga oshkor qilinmaydi).
   */
  private async tag(tx: Executor, highlightId: string, ctx: UploadContext, taggedBy: string): Promise<void> {
    const userIds = ctx.tagged_user_ids ?? [];
    const participantIds = ctx.tagged_participant_ids ?? [];
    if (!userIds.length && !participantIds.length) return;
    await tx.execute(
      sql`INSERT INTO highlight_tags (highlight_id, user_id, tagged_by)
          SELECT DISTINCT ${highlightId}::uuid, mp.user_id, ${taggedBy}::uuid
          FROM match_participants mp
          JOIN users u ON u.id = mp.user_id AND u.status <> 'deleted'
          JOIN user_current_consents c ON c.user_id = mp.user_id AND c.purpose = 'media_appearance' AND c.granted
          WHERE mp.match_id = ${ctx.match_id} AND mp.status IN ('confirmed', 'checked_in', 'no_show')
            AND (mp.user_id = ANY(${`{${userIds.join(',')}}`}::uuid[]) OR mp.id = ANY(${`{${participantIds.join(',')}}`}::uuid[]))
          ON CONFLICT DO NOTHING`,
    );
  }

  private async createJob(tx: Executor, mediaId: string, type: MediaJobType, input: Record<string, unknown>): Promise<string> {
    const job = await one<{ id: string }>(
      tx,
      sql`INSERT INTO media_processing_jobs (media_asset_id, type, status, transport, input)
          VALUES (${mediaId}, ${type}, 'queued', ${JOB_ROUTES[type]}, ${JSON.stringify(input)}::jsonb)
          ON CONFLICT (media_asset_id, type) WHERE status IN ('queued', 'running') DO NOTHING
          RETURNING id`,
    );
    if (job) return job.id;
    return (await one<{ id: string }>(
      tx,
      sql`SELECT id FROM media_processing_jobs WHERE media_asset_id = ${mediaId} AND type = ${type} AND status IN ('queued', 'running')`,
    ))!.id;
  }

  /**
   * Job'ni navbatga yozadi. Xato bo'lsa (Redis yo'q) job `queued` + `dispatched_at IS NULL` holida qoladi va
   * housekeeping uni qayta yuboradi — yuklash yakunlanishi navbat sababli yiqilmaydi.
   */
  async dispatch(jobId: string): Promise<boolean> {
    const job = await one<{ id: string; type: MediaJobType; media_asset_id: string; transport: string }>(
      this.db,
      sql`SELECT id, type, media_asset_id, transport FROM media_processing_jobs WHERE id = ${jobId} AND status = 'queued'`,
    );
    if (!job) return false;
    const queue = this.queues.get(job.transport);
    if (!queue) {
      this.log.warn(`job ${job.id}: ${job.transport} transporti sozlanmagan — navbatda kutadi`);
      return false;
    }
    try {
      const messageId = await queue.publish({
        v: 1,
        job_id: job.id,
        type: job.type,
        media_id: job.media_asset_id,
        enqueued_at: new Date().toISOString(),
      });
      await this.db.execute(
        sql`UPDATE media_processing_jobs SET dispatched_at = now(), message_id = ${messageId} WHERE id = ${job.id}`,
      );
      return true;
    } catch (err) {
      this.log.warn(`job ${job.id} navbatga yozilmadi: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Har 30 s: (1) navbatga yozilmay qolgan job'lar; (2) heartbeat'i to'xtagan `running` job'lar
   * (worker o'lgan) — 5 urinishdan keyin `failed`; (3) muddati o'tgan multipart yuklashlar — abort.
   */
  async housekeeping(): Promise<{ dispatched: number; requeued: number; timed_out: number; expired_uploads: number }> {
    const timedOut = await rows<{ id: string; media_asset_id: string }>(
      this.db,
      sql`UPDATE media_processing_jobs SET status = 'failed', error = 'WORKER_TIMEOUT', finished_at = now()
          WHERE status = 'running' AND heartbeat_at < now() - interval '10 minutes' AND attempts >= 5
          RETURNING id, media_asset_id`,
    );
    for (const j of timedOut) {
      await this.db.execute(
        sql`UPDATE media_assets SET status = 'failed', failure_code = 'WORKER_TIMEOUT', updated_at = now()
            WHERE id = ${j.media_asset_id} AND status = 'processing'`,
      );
    }
    const requeued = await this.db.execute(
      sql`UPDATE media_processing_jobs SET status = 'queued', dispatched_at = NULL
          WHERE (status = 'running' AND heartbeat_at < now() - interval '10 minutes')
             OR (status = 'queued' AND dispatched_at < now() - interval '15 minutes')`,
    );
    const pending = await rows<{ id: string }>(
      this.db,
      sql`SELECT id FROM media_processing_jobs
          WHERE status = 'queued' AND dispatched_at IS NULL AND queued_at < now() - interval '5 seconds'
          ORDER BY queued_at LIMIT 100`,
    );
    let dispatched = 0;
    for (const j of pending) if (await this.dispatch(j.id)) dispatched++;

    const expired = await rows<{ id: string; bucket: string; object_key: string; upload_id: string }>(
      this.db,
      sql`SELECT id, bucket, object_key, upload_id FROM media_assets
          WHERE status = 'uploading' AND upload_expires_at < now() ORDER BY upload_expires_at LIMIT 50`,
    );
    for (const u of expired) {
      try {
        await this.storage.abortMultipart(u.bucket, u.object_key, u.upload_id);
        await this.db.execute(
          sql`UPDATE media_assets SET status = 'deleted', failure_code = 'UPLOAD_EXPIRED', deleted_at = now(), updated_at = now()
              WHERE id = ${u.id} AND status = 'uploading'`,
        );
      } catch (err) {
        this.log.warn(`upload ${u.id} abort qilinmadi: ${(err as Error).message}`);
      }
    }
    return { dispatched, requeued: requeued.rowCount ?? 0, timed_out: timedOut.length, expired_uploads: expired.length };
  }
}
