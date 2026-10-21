import { useQuery } from '@tanstack/react-query';
import type { components } from '@matchup/contracts';
import { api, call } from '@/api/client';
import { ApiError } from '@/api/errors';

export type MatchRecording = components['schemas']['MatchRecording'];
export type RecordingCameraView = MatchRecording['cameras'][number];
export type RecordingMoment = MatchRecording['moments'][number];

export const rk = { match: (matchId: string) => ['match-recording', matchId] as const };

/**
 * To'liq o'yin videosi (AI-Cam). Yozuv yo'q yoki ishtirokchi emas — `null` (404/403 xato emas, bo'lim ko'rinmaydi).
 * Ijro URL'lari imzolangan (6 soat) — ekran har ochilganda yangisi; kamera qayta ishlanayotgan bo'lsa tez-tez.
 */
export function useMatchRecording(matchId: string, enabled = true) {
  return useQuery({
    queryKey: rk.match(matchId),
    queryFn: async (): Promise<MatchRecording | null> => {
      try {
        return await call(api.GET('/v1/matches/{matchId}/recording', { params: { path: { matchId } } }));
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN')) return null;
        throw err;
      }
    },
    enabled,
    staleTime: 0,
    retry: false,
    refetchInterval: (q) => (q.state.data?.cameras.some((c) => c.status !== 'ready') ? 60_000 : false),
  });
}

/** Tayyor (ijro havolasi bor) kameralar: chap, o'ng, umumiy tartibida. */
export function playableCameras(r: MatchRecording | null | undefined): RecordingCameraView[] {
  return (r?.cameras ?? []).filter((c) => !!c.playback);
}

/** Lahza shu kamerada qayerda (ms, video boshidan); kamera uni qamramasa — undefined. */
export function momentOffset(m: RecordingMoment, cameraId: string): number | undefined {
  return m.positions.find((p) => p.camera_id === cameraId)?.offset_ms;
}

/**
 * Kamera almashtirilganda o'sha lahzada qolish: kameralar turli vaqtda yoqilgan, shuning uchun
 * pozitsiya devor soati orqali o'tkaziladi (yangi kamerada bo'lmasa — 0).
 */
export function translateTime(seconds: number, from: Pick<RecordingCameraView, 'started_at'>, to: Pick<RecordingCameraView, 'started_at' | 'duration_ms'>): number {
  const t = seconds + (Date.parse(from.started_at) - Date.parse(to.started_at)) / 1000;
  const max = to.duration_ms ? to.duration_ms / 1000 : Number.POSITIVE_INFINITY;
  return t < 0 || t > max ? 0 : t;
}
