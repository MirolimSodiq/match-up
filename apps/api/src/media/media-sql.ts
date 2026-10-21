import { sql } from 'drizzle-orm';
import { type Executor, one } from '../db/db';
import { JOB_ROUTES, type MediaJobType } from './queue';

/**
 * Qayta ishlash profili (`media_processing_jobs.input.profile`) — worker qaysi pipeline'ni ishlatishini va
 * job qaysi navbatga ketishini belgilaydi:
 *  - `highlight_v1` — host yuklagan klip (≤ 60 s): HLS 720p/480p, thumbnail, 9:16;
 *  - `recording_v1` — to'liq o'yin yozuvi (AI-Cam A): HLS 1080p/720p/480p, thumbnail; alohida (uzun) navbat;
 *  - `clip_v1` — host belgisidan kesilgan klip: yozuvning HLS segmentlaridan kesib, keyin `highlight_v1` kabi.
 */
export type MediaProfile = 'highlight_v1' | 'recording_v1' | 'clip_v1';

/** Bitta asset + tur uchun bitta faol job (partial unique index): takroriy chaqiruv mavjudini qaytaradi. */
export async function createJob(
  tx: Executor,
  mediaId: string,
  type: MediaJobType,
  input: Record<string, unknown> & { profile: MediaProfile },
  recordingSessionId: string | null = null,
): Promise<string> {
  const job = await one<{ id: string }>(
    tx,
    sql`INSERT INTO media_processing_jobs (media_asset_id, type, status, transport, input, recording_session_id)
        VALUES (${mediaId}, ${type}, 'queued', ${JOB_ROUTES[type]}, ${JSON.stringify(input)}::jsonb, ${recordingSessionId})
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
 * Teglash: faqat shu match'ning roster'idagi va `media_appearance` consent'i (joriy holati) bor o'yinchilar.
 * Qolganlari jim tashlab yuboriladi (consent holati host'ga oshkor qilinmaydi).
 */
export async function tagHighlight(
  tx: Executor,
  highlightId: string,
  matchId: string,
  who: { userIds?: string[]; participantIds?: string[] },
  taggedBy: string,
): Promise<void> {
  const userIds = who.userIds ?? [];
  const participantIds = who.participantIds ?? [];
  if (!userIds.length && !participantIds.length) return;
  await tx.execute(
    sql`INSERT INTO highlight_tags (highlight_id, user_id, tagged_by)
        SELECT DISTINCT ${highlightId}::uuid, mp.user_id, ${taggedBy}::uuid
        FROM match_participants mp
        JOIN users u ON u.id = mp.user_id AND u.status <> 'deleted'
        JOIN user_current_consents c ON c.user_id = mp.user_id AND c.purpose = 'media_appearance' AND c.granted
        WHERE mp.match_id = ${matchId} AND mp.status IN ('confirmed', 'checked_in', 'no_show')
          AND (mp.user_id = ANY(${`{${userIds.join(',')}}`}::uuid[]) OR mp.id = ANY(${`{${participantIds.join(',')}}`}::uuid[]))
        ON CONFLICT DO NOTHING`,
  );
}
