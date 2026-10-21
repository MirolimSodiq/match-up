/**
 * AI-Cam Bosqich A — to'liq o'yin yozuvi (sof TS — RN/Expo'siz, vitest bilan tekshiriladi).
 *
 * - Kamera telefoni: pozitsiya (`left` / `right` / `wide`), 4K yozuv, fayl serverga Wi-Fi'da yuklanadi.
 * - Host telefoni ("pult"): "Highlight!" (qaysi darvoza tomoni) va "Kick-off" belgilari — internetsiz ham
 *   navbatga yoziladi va keyin `POST .../recording/markers` bilan (idempotent `client_marker_id`) yuboriladi.
 */
import type { components } from '@matchup/contracts';

export type CameraPosition = components['schemas']['CameraPosition'];
export type HostRecording = components['schemas']['HostRecording'];
export type MarkerKind = 'highlight' | 'kickoff';
export type MarkerSide = 'left' | 'right';

export const CAMERA_POSITIONS: readonly CameraPosition[] = ['left', 'right', 'wide'];

/** Server bilan bir xil (apps/api `RECORDING_LIMITS`). */
export const RECORDING_LIMITS = { maxBytes: 40 * 1024 ** 3, maxDurationMs: 3 * 3600_000 } as const;

/** Yozuvdan keyin telefonda qoladigan zaxira (tizim, boshqa ilovalar). */
export const RESERVE_BYTES = 2 * 1024 ** 3;

/** 4K30 taxminiy hajm (iPhone: HEVC ~170 MB/daq, H.264 ~350 MB/daq) — zaxira bilan. */
export const BYTES_PER_MINUTE = { hevc: 180 * 1024 ** 2, avc: 360 * 1024 ** 2 } as const;

/** 90 daqiqalik o'yin + isinish: shundan kam joy bo'lsa — ogohlantirish. */
export const RECOMMENDED_MINUTES = 100;

export function minutesAvailable(freeBytes: number, codec: keyof typeof BYTES_PER_MINUTE): number {
  return Math.max(0, Math.floor((freeBytes - RESERVE_BYTES) / BYTES_PER_MINUTE[codec]));
}

/** `recordAsync({ maxFileSize })`: telefon to'lib qolmasin va server chegarasidan oshmasin. */
export function maxFileSize(freeBytes: number): number {
  return Math.max(0, Math.min(freeBytes - RESERVE_BYTES, RECORDING_LIMITS.maxBytes));
}

/** Boshqa telefon hozir yozayotgan pozitsiyalar (bu telefonning kameralaridan tashqari). */
export function busyPositions(recording: Pick<HostRecording, 'cameras'> | null | undefined, mine: ReadonlySet<string>): Set<CameraPosition> {
  return new Set(
    (recording?.cameras ?? []).filter((c) => c.status === 'recording' && !mine.has(c.client_camera_id)).map((c) => c.position),
  );
}

// ---------------------------------------------------------------------------
// Belgilar navbati (pult)
// ---------------------------------------------------------------------------

export type MarkerState =
  /** Diskda, hali server javobi yo'q. */
  | 'pending'
  | 'synced'
  | 'rejected'
  /** Host bekor qildi — `DELETE` navbatda. */
  | 'deleting';

export interface QueuedMarker {
  client_marker_id: string;
  matchId: string;
  /** Belgini qo'ygan host (boshqa akkaunt bilan kirilsa yuborilmaydi). */
  userId: string;
  kind: MarkerKind;
  occurred_at: string;
  side: MarkerSide | null;
  state: MarkerState;
  /** `rejected`: OUT_OF_WINDOW | UNKNOWN_PARTICIPANT | CONFLICT */
  reason?: string;
  highlight_id?: string | null;
  created_at: number;
  synced_at?: number;
}

export interface MarkerResult {
  client_marker_id: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  reason?: string;
  marker?: { highlight_id?: string | null };
}

export const MARKER_BATCH = 100;

export function markerWire(m: QueuedMarker) {
  return { client_marker_id: m.client_marker_id, kind: m.kind, occurred_at: m.occurred_at, side: m.side };
}

/** Server natijasi: qabul / takror -> `synced` (klip id bilan), rad -> `rejected`. Bekor qilinganlarga tegmaydi. */
export function applyMarkerResults(markers: readonly QueuedMarker[], results: readonly MarkerResult[], now: number): QueuedMarker[] {
  const byId = new Map(results.map((r) => [r.client_marker_id, r]));
  return markers.map((m) => {
    const r = byId.get(m.client_marker_id);
    if (!r || m.state === 'deleting') return m;
    return r.status === 'rejected'
      ? { ...m, state: 'rejected', reason: r.reason ?? 'REJECTED', synced_at: now }
      : { ...m, state: 'synced', reason: undefined, highlight_id: r.marker?.highlight_id ?? m.highlight_id ?? null, synced_at: now };
  });
}

/**
 * "Bekor qilish": hali yuborilmagan / rad etilgan belgi — faqat lokal o'chiriladi (`drop`);
 * serverdagi — `DELETE` navbatga qo'yiladi (`delete`).
 */
export function undoAction(m: Pick<QueuedMarker, 'state'>): 'drop' | 'delete' | 'none' {
  if (m.state === 'pending' || m.state === 'rejected') return 'drop';
  if (m.state === 'synced') return 'delete';
  return 'none';
}

/** Ekrandagi belgilar: eng yangisi birinchi, bekor qilinayotganlarsiz. */
export function visibleMarkers(markers: readonly QueuedMarker[], matchId: string): QueuedMarker[] {
  return markers
    .filter((m) => m.matchId === matchId && m.state !== 'deleting')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

/** Kick-off — eng birinchi (bekor qilinmagan) belgi; server ham shunday hisoblaydi. */
export function kickoffAt(markers: readonly QueuedMarker[], matchId: string): string | undefined {
  return markers
    .filter((m) => m.matchId === matchId && m.kind === 'kickoff' && m.state !== 'deleting' && m.state !== 'rejected')
    .map((m) => m.occurred_at)
    .sort()[0];
}

/** O'yin soati "34:12" (kick-off'dan beri). */
export function matchClock(nowMs: number, kickoffIso: string | undefined): string | undefined {
  if (!kickoffIso) return undefined;
  const s = Math.max(0, Math.floor((nowMs - Date.parse(kickoffIso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Yuborilgan/rad etilgan belgilar jurnalda shuncha saqlanadi. */
export const MARKER_TTL_MS = 3 * 24 * 3600_000;

export function pruneMarkers(markers: readonly QueuedMarker[], now: number): QueuedMarker[] {
  return markers.filter((m) => m.state === 'pending' || m.state === 'deleting' || now - (m.synced_at ?? now) < MARKER_TTL_MS);
}
