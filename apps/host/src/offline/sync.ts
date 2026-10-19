import { AppState } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { ApiError } from '@/api/errors';
import { uuid } from '@/lib/device';
import { BATCH_SIZE, backoffMs, type CheckinAction, type CheckinMethod, type QueuedEvent, summarize, toWire } from './core';
import { network } from './network';
import { offlineStore } from './store';

/**
 * Offline sinxron: navbatdagi event'lar `POST /v1/host/matches/{id}/checkins` ga 100 tadan batch qilib yuboriladi.
 * - Idempotent: har event `client_event_id` bilan — javob yo'qolib qayta yuborilsa server `duplicate` qaytaradi.
 * - Tarmoq/5xx/429 xatosida backoff bilan qayta urinadi (2 s -> 60 s); internet qaytsa yoki ilova ochilsa — darhol.
 * - 4xx (masalan, 403: o'yin endi sizga biriktirilmagan) — avtomatik qayta urinmaydi, xato ko'rsatiladi.
 */
let userId: string | undefined;
let queryClient: QueryClient | undefined;
const inFlight = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let started = false;

function clearTimer(matchId: string) {
  const t = timers.get(matchId);
  if (t) clearTimeout(t);
  timers.delete(matchId);
}

function schedule(matchId: string, delay: number) {
  clearTimer(matchId);
  timers.set(
    matchId,
    setTimeout(() => {
      timers.delete(matchId);
      void syncMatch(matchId);
    }, delay),
  );
}

export function syncMatch(matchId: string): Promise<void> {
  const running = inFlight.get(matchId);
  if (running) return running;
  const run = (async () => {
    clearTimer(matchId);
    while (userId) {
      const batch = offlineStore.pending(matchId, userId).slice(0, BATCH_SIZE);
      if (!batch.length) {
        offlineStore.setSync(matchId, { status: 'idle', attempt: 0, error: undefined, nextRetryAt: undefined });
        return;
      }
      offlineStore.setSync(matchId, { status: 'syncing' });
      try {
        const res = await call(
          api.POST('/v1/host/matches/{matchId}/checkins', { params: { path: { matchId } }, body: { events: batch.map(toWire) } }),
        );
        const results = res.results ?? [];
        offlineStore.applyResults(results);
        offlineStore.setSync(matchId, {
          status: 'idle',
          attempt: 0,
          error: undefined,
          nextRetryAt: undefined,
          lastResult: { ...summarize(results), at: Date.now() },
        });
        void queryClient?.invalidateQueries({ queryKey: ['roster', matchId] });
        void queryClient?.invalidateQueries({ queryKey: ['host-matches'] });
      } catch (err) {
        const e = err instanceof ApiError ? err : ApiError.network(err);
        const attempt = offlineStore.getSync(matchId).attempt + 1;
        const transient = e.code === 'NETWORK' || e.status >= 500 || e.status === 429;
        if (!transient) {
          offlineStore.setSync(matchId, { status: 'error', attempt, error: e.code, nextRetryAt: undefined });
          return;
        }
        const delay = e.retryAfter ? e.retryAfter * 1000 : backoffMs(attempt);
        offlineStore.setSync(matchId, {
          status: e.code === 'NETWORK' ? 'offline' : 'error',
          attempt,
          error: e.code,
          nextRetryAt: Date.now() + delay,
        });
        schedule(matchId, delay);
        return;
      }
    }
  })().finally(() => inFlight.delete(matchId));
  inFlight.set(matchId, run);
  return run;
}

/** Navbati bor barcha o'yinlarni darhol sinxronlaydi (backoff kutilmaydi). */
export function syncAll() {
  if (!userId) return;
  for (const matchId of offlineStore.matchesWithPending(userId)) void syncMatch(matchId);
}

/** Check-in / undo / no-show — avval telefonga yoziladi, keyin (imkon bo'lsa) darhol yuboriladi. */
export function enqueueCheckin(input: {
  matchId: string;
  action: CheckinAction;
  method: CheckinMethod;
  participantId: string;
  qrPayload?: string;
  displayName?: string;
}): QueuedEvent | undefined {
  if (!userId) return undefined;
  const event: QueuedEvent = {
    client_event_id: uuid(),
    match_id: input.matchId,
    user_id: userId,
    action: input.action,
    method: input.method,
    participant_id: input.participantId,
    qr_payload: input.qrPayload,
    occurred_at: new Date().toISOString(),
    state: 'pending',
    attempts: 0,
    display_name: input.displayName,
  };
  offlineStore.enqueue(event);
  void syncMatch(input.matchId);
  return event;
}

export const syncEngine = {
  /** Sessiya boshlanganda / tugaganda. */
  setUser(id: string | undefined) {
    userId = id;
    if (id) syncAll();
    else timers.forEach((_, k) => clearTimer(k));
  },

  start(client: QueryClient) {
    queryClient = client;
    if (started) return;
    started = true;
    network.subscribe(() => {
      if (network.online) syncAll();
    });
    AppState.addEventListener('change', (s) => {
      if (s === 'active') syncAll();
    });
    // Zaxira: tizim tarmoq hodisasini bermasa ham navbat osilib qolmasin
    setInterval(() => {
      if (!userId) return;
      for (const matchId of offlineStore.matchesWithPending(userId)) {
        const state = offlineStore.getSync(matchId);
        // 4xx xatoda (masalan, 403) avtomatik takrorlamaymiz — foydalanuvchi "Sinxronlash"ni bosadi
        const permanent = state.status === 'error' && state.nextRetryAt === undefined;
        if (!permanent && !timers.has(matchId) && !inFlight.has(matchId)) void syncMatch(matchId);
      }
    }, 30_000);
  },
};
