import { sql } from 'drizzle-orm';
import { emit } from '../common/outbox';
import { type Executor, one, rows } from '../db/db';
import { createJob, tagHighlight } from './media-sql';

/**
 * AI-Cam Bosqich A — to'liq o'yin yozuvi (docs/AI_CAM.md §1, §10).
 *
 * Bu fayldagi funksiyalar faqat SQL (tranzaksiya ichida chaqiriladi): MediaService (yuklash yakunlandi /
 * bekor qilindi / muddati o'tdi), MediaJobsService (worker natijasi) va RecordingsService (host API) bir xil
 * holat o'tishlarini ishlatadi. Har mutatsiya sessiya qatorini `FOR UPDATE` bilan qulflaydi — kamera natijalari,
 * belgilar va klip yaratish bir-biri bilan poygaga kirmaydi.
 */

/** To'liq o'yin fayli (bitta telefon): 4K HEVC ~15 GB / 90 daq; zaxira bilan. */
export const RECORDING_LIMITS = {
  maxBytes: 40 * 1024 ** 3,
  maxDurationMs: 3 * 3600_000,
  contentTypes: ['video/mp4', 'video/quicktime'] as const,
};

export const CAMERA_POSITIONS = ['left', 'right', 'wide'] as const;
export type CameraPosition = (typeof CAMERA_POSITIONS)[number];
export const MARKER_SIDES = ['left', 'right'] as const;
export type MarkerSide = (typeof MARKER_SIDES)[number];
export const RIG_TYPES = ['single_phone', 'two_phone', 'three_phone'] as const;

/** Yozuv chegarasiga juda yaqin belgi — klip shundan qisqa bo'lsa kesilmaydi. */
const MIN_CLIP_MS = 3_000;

export interface ClipConfig {
  /** Klip natijalari (va kesilgan manba) shu bucket'da: `highlights/{match}/{clip}/`. */
  mediaBucket: string;
  storageRegion: string;
}

export interface CameraRow {
  id: string;
  session_id: string;
  client_camera_id: string;
  position: CameraPosition;
  recorded_by: string;
  device_model: string | null;
  status: 'recording' | 'recorded' | 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled';
  started_at: string;
  stopped_at: string | null;
  duration_ms: number | null;
  fps: string | null;
  width: number | null;
  height: number | null;
  media_asset_id: string | null;
  failure_code: string | null;
  created_at: string;
  /** started_at, ms (epoch) — offset hisoblari uchun */
  started_ms: number;
  /** Fayl oxiri, ms (epoch): tayyor bo'lsa — aniq davomiylik, aks holda to'xtatilgan vaqt; hali yozilyapti — null */
  end_ms: number | null;
}

export const CAMERA_COLUMNS = sql`
  rc.id, rc.session_id, rc.client_camera_id, rc.position, rc.recorded_by, rc.device_model, rc.status, rc.started_at,
  rc.stopped_at, rc.duration_ms, rc.fps, rc.width, rc.height, rc.media_asset_id, rc.failure_code, rc.created_at,
  (extract(epoch FROM rc.started_at) * 1000)::bigint AS started_ms,
  CASE WHEN rc.duration_ms IS NOT NULL THEN (extract(epoch FROM rc.started_at) * 1000)::bigint + rc.duration_ms
       WHEN rc.stopped_at IS NOT NULL THEN (extract(epoch FROM rc.stopped_at) * 1000)::bigint END AS end_ms`;

export interface MarkerRow {
  id: string;
  client_marker_id: string;
  kind: 'highlight' | 'kickoff';
  occurred_at: string;
  occurred_ms: number;
  side: MarkerSide | null;
  participant_id: string | null;
  pre_ms: number;
  post_ms: number;
  created_by: string;
  camera_id: string | null;
  highlight_id: string | null;
  created_at: string;
}

export const MARKER_COLUMNS = sql`
  rm.id, rm.client_marker_id, rm.kind, rm.occurred_at, (extract(epoch FROM rm.occurred_at) * 1000)::bigint AS occurred_ms,
  rm.side, rm.participant_id, rm.pre_ms, rm.post_ms, rm.created_by, rm.camera_id, rm.highlight_id, rm.created_at`;

interface LockedSession {
  id: string;
  match_id: string;
  status: string;
  ready_at: string | null;
  kickoff_ms: number | null;
}

export async function lockSession(tx: Executor, sessionId: string): Promise<LockedSession> {
  return (await one<LockedSession>(
    tx,
    sql`SELECT id, match_id, status, ready_at, (extract(epoch FROM kickoff_at) * 1000)::bigint AS kickoff_ms
        FROM recording_sessions WHERE id = ${sessionId} FOR UPDATE`,
  ))!;
}

/**
 * Sessiya holati kameralardan hisoblanadi: hali yozayotgan -> `recording`, yuklanmagan fayl bor -> `uploading`,
 * worker ishlayapti -> `processing`, hammasi tugagan va kamida bittasi tayyor -> `ready`, aks holda `failed`.
 * Birinchi kamera tayyor bo'lganda (bir marta) `RecordingReady` — ishtirokchilar qolgan kameralarni kutmaydi.
 */
export async function refreshSession(tx: Executor, sessionId: string): Promise<void> {
  const s = await lockSession(tx, sessionId);
  const c = (await one<{ recording: number; uploading: number; processing: number; ready: number; active: number }>(
    tx,
    sql`SELECT count(*) FILTER (WHERE status = 'recording')::int AS recording,
               count(*) FILTER (WHERE status IN ('recorded', 'uploading'))::int AS uploading,
               count(*) FILTER (WHERE status = 'processing')::int AS processing,
               count(*) FILTER (WHERE status = 'ready')::int AS ready,
               count(*) FILTER (WHERE status <> 'cancelled')::int AS active
        FROM recording_cameras WHERE session_id = ${sessionId}`,
  ))!;
  const status =
    c.active === 0 || c.recording > 0 ? 'recording'
    : c.uploading > 0 ? 'uploading'
    : c.processing > 0 ? 'processing'
    : c.ready > 0 ? 'ready'
    : 'failed';
  const firstReady = c.ready > 0 && !s.ready_at;
  await tx.execute(
    sql`UPDATE recording_sessions
        SET status = ${status}, ready_at = CASE WHEN ${firstReady}::boolean THEN now() ELSE ready_at END, updated_at = now()
        WHERE id = ${sessionId}`,
  );
  if (firstReady) await emit(tx, 'recording', sessionId, 'RecordingReady', { session_id: sessionId, match_id: s.match_id });
}

/** Kick-off = eng birinchi (o'chirilmagan) `kickoff` belgisi; o'zgarsa klip'larning `match_offset_ms` i qayta hisoblanadi. */
export async function refreshKickoff(tx: Executor, sessionId: string): Promise<void> {
  await tx.execute(
    sql`UPDATE recording_sessions
        SET kickoff_at = (SELECT min(occurred_at) FROM recording_markers
                          WHERE session_id = ${sessionId} AND kind = 'kickoff' AND deleted_at IS NULL),
            updated_at = now()
        WHERE id = ${sessionId}`,
  );
  await tx.execute(
    sql`UPDATE highlights h
        SET match_offset_ms = CASE WHEN s.kickoff_at IS NOT NULL AND h.clip_started_at >= s.kickoff_at
                                   THEN (extract(epoch FROM h.clip_started_at - s.kickoff_at) * 1000)::int END,
            updated_at = now()
        FROM recording_sessions s
        WHERE s.id = ${sessionId} AND h.recording_session_id = s.id AND h.clip_started_at IS NOT NULL`,
  );
}

/**
 * Belgi uchun kamera: tomon berilgan bo'lsa — o'sha tomon kamerasi, bo'lmasa `wide`; tomonsiz — `wide`, keyin
 * `left`, `right`. Afzal pozitsiyada vaqtni qamragan kamera bor-u, hali tayyor emas — kutiladi (`undefined`),
 * xato bergan yoki bekor qilingan kamera hisobga olinmaydi (keyingi pozitsiyaga o'tiladi).
 */
export function pickCamera(m: Pick<MarkerRow, 'occurred_ms' | 'side'>, cameras: readonly CameraRow[]): CameraRow | undefined {
  const covers = (c: CameraRow) => m.occurred_ms >= c.started_ms && (c.end_ms === null || m.occurred_ms <= c.end_ms);
  const order: CameraPosition[] = m.side ? [m.side, 'wide'] : ['wide', 'left', 'right'];
  for (const position of order) {
    const candidates = cameras.filter((c) => c.position === position && c.status !== 'failed' && c.status !== 'cancelled' && covers(c));
    if (candidates.length) return candidates.find((c) => c.status === 'ready' && c.duration_ms && c.media_asset_id);
  }
  return undefined;
}

/**
 * Klipi hali kesilmagan belgilar uchun klip yaratadi (media + highlight + teg + `clip_v1` job). Kamera tayyor
 * bo'lganda, belgi qo'shilganda va kamera xato berganda (boshqa kameraga o'tish) chaqiriladi.
 * Navbatga yuborilishi kerak bo'lgan job id'lari qaytadi (tranzaksiyadan keyin `MediaService.dispatch`).
 */
export async function scheduleClips(tx: Executor, sessionId: string, cfg: ClipConfig): Promise<string[]> {
  const s = await lockSession(tx, sessionId);
  const markers = await rows<MarkerRow>(
    tx,
    sql`SELECT ${MARKER_COLUMNS} FROM recording_markers rm
        WHERE rm.session_id = ${sessionId} AND rm.kind = 'highlight' AND rm.highlight_id IS NULL AND rm.deleted_at IS NULL
        ORDER BY rm.occurred_at`,
  );
  if (!markers.length) return [];
  const cameras = await rows<CameraRow>(
    tx,
    sql`SELECT ${CAMERA_COLUMNS} FROM recording_cameras rc WHERE rc.session_id = ${sessionId} AND rc.status <> 'cancelled'`,
  );
  const jobs: string[] = [];
  for (const mk of markers) {
    const cam = pickCamera(mk, cameras);
    if (!cam) continue;
    const offset = mk.occurred_ms - cam.started_ms;
    const start = Math.max(0, offset - mk.pre_ms);
    const end = Math.min(cam.duration_ms!, offset + mk.post_ms);
    if (end - start < MIN_CLIP_MS) continue;
    const startedAbs = cam.started_ms + start;
    const matchOffset = s.kickoff_ms !== null && startedAbs >= s.kickoff_ms ? startedAbs - s.kickoff_ms : null;

    const { id } = (await one<{ id: string }>(tx, sql`SELECT uuidv7() AS id`))!;
    const context = { kind: 'clip', match_id: s.match_id, session_id: sessionId, marker_id: mk.id, camera_id: cam.id };
    await tx.execute(
      sql`INSERT INTO media_assets (id, owner_user_id, kind, status, storage_region, bucket, object_key, content_type,
                                    duration_ms, recorded_at, uploaded_at, context)
          VALUES (${id}, ${mk.created_by}, 'video', 'processing', ${cfg.storageRegion}, ${cfg.mediaBucket},
                  ${`highlights/${s.match_id}/${id}/source.mp4`}, 'video/mp4', ${end - start},
                  to_timestamp(${startedAbs}::float8 / 1000), now(), ${JSON.stringify(context)}::jsonb)`,
    );
    const h = (await one<{ id: string }>(
      tx,
      sql`INSERT INTO highlights (match_id, media_asset_id, created_by, source, clip_started_at, match_offset_ms, duration_ms,
                                  visibility, recording_session_id)
          VALUES (${s.match_id}, ${id}, ${mk.created_by}, 'host_manual', to_timestamp(${startedAbs}::float8 / 1000),
                  ${matchOffset}, ${end - start}, 'participants', ${sessionId})
          RETURNING id`,
    ))!;
    await tagHighlight(tx, h.id, s.match_id, { participantIds: mk.participant_id ? [mk.participant_id] : [] }, mk.created_by);
    jobs.push(
      await createJob(
        tx,
        id,
        'transcode',
        {
          profile: 'clip_v1',
          highlight_id: h.id,
          match_id: s.match_id,
          recording_media_id: cam.media_asset_id,
          camera_id: cam.id,
          start_ms: start,
          duration_ms: end - start,
        },
        sessionId,
      ),
    );
    await tx.execute(sql`UPDATE recording_markers SET camera_id = ${cam.id}, highlight_id = ${h.id} WHERE id = ${mk.id}`);
  }
  return jobs;
}

/** Media qatoriga bog'langan kamera (yo'q bo'lsa — bu yozuv fayli emas). */
async function cameraOfMedia(tx: Executor, mediaId: string): Promise<{ id: string; session_id: string } | undefined> {
  return one<{ id: string; session_id: string }>(
    tx,
    sql`SELECT id, session_id FROM recording_cameras WHERE media_asset_id = ${mediaId}`,
  );
}

/** `POST /v1/media/{id}/complete` (yozuv fayli): kamera `processing`, `recording_v1` job. Job id qaytadi. */
export async function recordingUploaded(tx: Executor, mediaId: string, matchId: string): Promise<string | undefined> {
  const cam = await cameraOfMedia(tx, mediaId);
  if (!cam) return undefined;
  await tx.execute(
    sql`UPDATE recording_cameras SET status = 'processing', failure_code = NULL, updated_at = now()
        WHERE id = ${cam.id} AND status IN ('recording', 'recorded', 'uploading')`,
  );
  const jobId = await createJob(tx, mediaId, 'transcode', { profile: 'recording_v1', match_id: matchId, camera_id: cam.id }, cam.session_id);
  await refreshSession(tx, cam.session_id);
  return jobId;
}

/** Worker natijasi `ready`: aniq davomiylik va o'lchamlar, sessiya holati, kutayotgan belgilar uchun kliplar. */
export async function recordingProcessed(
  tx: Executor,
  mediaId: string,
  probe: { duration_ms: number; width: number; height: number; fps?: number | null },
  cfg: ClipConfig,
): Promise<string[]> {
  const cam = await cameraOfMedia(tx, mediaId);
  if (!cam) return [];
  await tx.execute(
    sql`UPDATE recording_cameras
        SET status = 'ready', duration_ms = ${probe.duration_ms}, width = ${probe.width}, height = ${probe.height},
            fps = coalesce(${probe.fps && probe.fps > 0 ? probe.fps : null}::numeric, fps), failure_code = NULL, updated_at = now()
        WHERE id = ${cam.id} AND status <> 'cancelled'`,
  );
  await refreshSession(tx, cam.session_id);
  return scheduleClips(tx, cam.session_id, cfg);
}

/** Worker xatosi / timeout: kamera `failed`; uning belgilari boshqa (wide) kameraga o'tishi mumkin. */
export async function recordingFailed(tx: Executor, mediaId: string, code: string, cfg: ClipConfig): Promise<string[]> {
  const cam = await cameraOfMedia(tx, mediaId);
  if (!cam) return [];
  await tx.execute(
    sql`UPDATE recording_cameras SET status = 'failed', failure_code = ${code.slice(0, 64)}, updated_at = now()
        WHERE id = ${cam.id} AND status = 'processing'`,
  );
  await refreshSession(tx, cam.session_id);
  return scheduleClips(tx, cam.session_id, cfg);
}

/** Host yuklashni bekor qildi (`DELETE /v1/media/{id}/upload`): bu fayl endi kutilmaydi. */
export async function recordingCancelled(tx: Executor, mediaId: string, cfg: ClipConfig): Promise<string[]> {
  const cam = await cameraOfMedia(tx, mediaId);
  if (!cam) return [];
  await tx.execute(
    sql`UPDATE recording_cameras SET status = 'cancelled', updated_at = now() WHERE id = ${cam.id} AND status IN ('recording', 'recorded', 'uploading')`,
  );
  await refreshSession(tx, cam.session_id);
  return scheduleClips(tx, cam.session_id, cfg);
}

/** Multipart sessiya muddati o'tdi: fayl hali telefonda — host qayta yuklashi mumkin (`recorded`). */
export async function recordingUploadExpired(tx: Executor, mediaId: string): Promise<void> {
  const cam = await cameraOfMedia(tx, mediaId);
  if (!cam) return;
  await tx.execute(
    sql`UPDATE recording_cameras SET status = 'recorded', updated_at = now() WHERE id = ${cam.id} AND status = 'uploading'`,
  );
  await refreshSession(tx, cam.session_id);
}
