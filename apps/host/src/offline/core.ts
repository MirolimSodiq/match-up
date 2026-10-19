import type { components } from '@matchup/contracts';

/**
 * Offline check-in yadrosi — sof funksiyalar (RN/IO yo'q), unit testlar bilan qamralgan.
 * Saqlash va tarmoq: `store.ts`, `sync.ts`.
 */
export type Roster = components['schemas']['Roster'];
export type RosterEntry = components['schemas']['RosterEntry'];
export type CheckinEventWire = components['schemas']['CheckinEvent'];

export type CheckinAction = CheckinEventWire['action'];
export type CheckinMethod = CheckinEventWire['method'];
export type ParticipantStatus = 'confirmed' | 'checked_in' | 'no_show';
/** `pending` — telefonda, serverga hali yetmagan; qolganlari — server javobi. */
export type EventState = 'pending' | 'accepted' | 'duplicate' | 'rejected';

export interface QueuedEvent {
  client_event_id: string;
  match_id: string;
  /** Qaysi host yaratgan (boshqa akkaunt bilan kirilsa yuborilmaydi). */
  user_id: string;
  action: CheckinAction;
  method: CheckinMethod;
  /** QR'da ham lokal holat uchun saqlanadi (server QR'da token ichidagi `p` ni ishlatadi). */
  participant_id: string;
  qr_payload?: string;
  occurred_at: string;
  location?: { lat: number; lng: number };
  state: EventState;
  reason?: string | null;
  /** Yuborish urinishlari soni (backoff uchun). */
  attempts: number;
  /** Server javob bergan vaqt (ms). */
  synced_at?: number;
  /** Jurnalda ko'rsatish uchun. */
  display_name?: string;
}

export interface SyncResult {
  client_event_id?: string;
  status?: 'accepted' | 'duplicate' | 'rejected';
  reason?: string | null;
  participant_id?: string | null;
}

export const STATUS_AFTER: Record<CheckinAction, ParticipantStatus> = {
  check_in: 'checked_in',
  undo: 'confirmed',
  no_show: 'no_show',
};

/**
 * Server holatiga hali kirmagan event'larmi:
 * - `pending` — doim;
 * - `accepted`/`duplicate` — agar roster bu javobdan OLDIN olingan bo'lsa (`synced_at > fetchedAt`),
 *   aks holda server roster'i ularni allaqachon o'z ichiga oladi;
 * - `rejected` — hech qachon (server qabul qilmagan).
 */
export function isOverlay(e: QueuedEvent, rosterFetchedAt: number): boolean {
  if (e.state === 'pending') return true;
  if (e.state === 'rejected') return false;
  return (e.synced_at ?? 0) > rosterFetchedAt;
}

export interface ParticipantView extends RosterEntry {
  participant_id: string;
  display_name: string;
  status: ParticipantStatus;
  /** Serverga yetmagan amal bor. */
  pending: boolean;
  /** Oxirgi amal server tomonidan rad etilgan (va undan keyin boshqa amal yo'q). */
  rejectedReason?: string | null;
}

/** Roster + lokal event'lar = ekranda ko'rinadigan holat (event'lar navbat tartibida qo'llanadi). */
export function applyEvents(participants: readonly RosterEntry[], events: readonly QueuedEvent[], rosterFetchedAt: number): ParticipantView[] {
  const views = new Map<string, ParticipantView>();
  for (const p of participants) {
    if (!p.participant_id) continue;
    views.set(p.participant_id, {
      ...p,
      participant_id: p.participant_id,
      display_name: p.display_name ?? '—',
      status: (p.status ?? 'confirmed') as ParticipantStatus,
      pending: false,
    });
  }
  for (const e of events) {
    const v = views.get(e.participant_id);
    if (!v) continue;
    if (e.state === 'rejected') {
      v.rejectedReason = e.reason ?? null;
      continue;
    }
    if (!isOverlay(e, rosterFetchedAt)) continue;
    v.status = STATUS_AFTER[e.action];
    v.checked_in_at = e.action === 'check_in' ? (v.checked_in_at ?? e.occurred_at) : e.action === 'undo' ? null : v.checked_in_at;
    v.rejectedReason = undefined;
    if (e.state === 'pending') v.pending = true;
  }
  return [...views.values()];
}

export function rosterCounts(views: readonly ParticipantView[]) {
  let checked = 0;
  let waiting = 0;
  let noShow = 0;
  for (const v of views) {
    if (v.status === 'checked_in') checked++;
    else if (v.status === 'no_show') noShow++;
    else waiting++;
  }
  return { checked, waiting, noShow, total: views.length };
}

/** API'ga yuboriladigan shakl (lokal maydonlarsiz). */
export function toWire(e: QueuedEvent): CheckinEventWire {
  return {
    client_event_id: e.client_event_id,
    action: e.action,
    method: e.method,
    occurred_at: e.occurred_at,
    ...(e.method === 'qr' ? { qr_payload: e.qr_payload } : { participant_id: e.participant_id }),
    ...(e.location ? { location: e.location } : {}),
  };
}

/** Server natijalarini navbatga yozadi; javobda yo'q event'lar `pending` qoladi. */
export function resolveResults(events: readonly QueuedEvent[], results: readonly SyncResult[], now: number): QueuedEvent[] {
  const byId = new Map(results.filter((r) => r.client_event_id).map((r) => [r.client_event_id!, r]));
  return events.map((e) => {
    const r = byId.get(e.client_event_id);
    if (!r?.status) return e;
    return { ...e, state: r.status, reason: r.reason ?? null, synced_at: now };
  });
}

export function summarize(results: readonly SyncResult[]) {
  const out = { accepted: 0, duplicate: 0, rejected: 0 };
  for (const r of results) if (r.status) out[r.status]++;
  return out;
}

/** Bir so'rovda ko'pi bilan 100 event (API cheklovi). */
export const BATCH_SIZE = 100;

/** Qayta urinish oralig'i: 2 s, 5 s, 15 s, 30 s, keyin har 60 s. */
export function backoffMs(attempt: number): number {
  const steps = [2_000, 5_000, 15_000, 30_000, 60_000];
  return steps[Math.min(Math.max(attempt - 1, 0), steps.length - 1)]!;
}

/** Ikki nuqta orasidagi masofa (metr), haversine. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** `OUTSIDE_GEOFENCE` javobidagi masofa: server `detail` matnida ("... (1234 m)") keladi. */
export function distanceFromDetail(detail: string | undefined): number | undefined {
  const m = detail ? /\((\d+)\s*(?:m|м)\)/.exec(detail) : null;
  return m ? Number(m[1]) : undefined;
}

const LEVEL_WEIGHT: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3, pro: 4 };

/**
 * Jamoalarga teng bo'lish: darajasi bo'yicha kamayish tartibida "ilon" (1-2-2-1 ...) usulida.
 * Daraja noma'lum bo'lsa — o'rta (2). Natija: participant_id -> side_no.
 */
export function autoSplit(players: readonly { participant_id: string; level?: string | null }[], sideNos: readonly number[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!sideNos.length) return out;
  const sorted = [...players].sort(
    (a, b) => (LEVEL_WEIGHT[b.level ?? ''] ?? 2) - (LEVEL_WEIGHT[a.level ?? ''] ?? 2) || a.participant_id.localeCompare(b.participant_id),
  );
  sorted.forEach((p, i) => {
    const round = Math.floor(i / sideNos.length);
    const pos = i % sideNos.length;
    out.set(p.participant_id, sideNos[round % 2 === 0 ? pos : sideNos.length - 1 - pos]!);
  });
  return out;
}
