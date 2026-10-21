import { useMemo, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';
import { Directory, File, Paths } from 'expo-file-system';
import { api, call } from '@/api/client';
import { ApiError } from '@/api/errors';
import { uuid } from '@/lib/device';
import { backoffMs } from '@/offline/core';
import { network } from '@/offline/network';
import {
  applyMarkerResults,
  MARKER_BATCH,
  type MarkerKind,
  type MarkerSide,
  markerWire,
  pruneMarkers,
  type QueuedMarker,
  undoAction,
  visibleMarkers,
} from './core';

/**
 * Pult belgilari navbati (diskda: `matchup-host/markers.json`). Belgi bosilgan zahoti telefon soati bilan
 * yoziladi — internet bo'lmasa ham; keyin `POST .../recording/markers` ga 100 tadan yuboriladi (idempotent).
 * Bekor qilish: yuborilmagani — lokal, serverdagisi — `DELETE` (u ham navbatda).
 */

export interface MarkerSyncState {
  status: 'idle' | 'syncing' | 'offline' | 'error';
  attempt: number;
  error?: string;
}

const IDLE: MarkerSyncState = { status: 'idle', attempt: 0 };
const persistent = Platform.OS !== 'web';
const dir = persistent ? new Directory(Paths.document, 'matchup-host') : null;
const file = dir ? new File(dir, 'markers.json') : null;

type Listener = () => void;

class MarkerEngine {
  private markers: QueuedMarker[] = [];
  private sync: Record<string, MarkerSyncState> = {};
  private listeners = new Set<Listener>();
  private version = 0;
  private hydrated = false;
  private started = false;
  private userId?: string;
  private queryClient?: QueryClient;
  private inFlight = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      if (file?.exists) this.markers = pruneMarkers(JSON.parse(file.textSync()) as QueuedMarker[], Date.now());
    } catch {
      this.markers = [];
    }
  }

  private save() {
    if (!file || !dir) return;
    try {
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      // Sinxron: "belgilandi" deganda diskda bo'lsin
      file.writeSync(JSON.stringify(this.markers));
    } catch (err) {
      console.warn('markers: diskka yozilmadi', err);
    }
  }

  private emit(save = true) {
    if (save) this.save();
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  list(matchId: string) {
    this.hydrate();
    return this.markers.filter((m) => m.matchId === matchId);
  }

  getSync(matchId: string): MarkerSyncState {
    return this.sync[matchId] ?? IDLE;
  }

  private setSync(matchId: string, s: MarkerSyncState) {
    this.sync = { ...this.sync, [matchId]: s };
    this.emit(false);
  }

  // --- hayot sikli ------------------------------------------------------------
  start(client: QueryClient) {
    this.queryClient = client;
    this.hydrate();
    if (this.started) return;
    this.started = true;
    network.subscribe(() => {
      if (network.online) this.syncAll();
    });
    AppState.addEventListener('change', (s) => {
      if (s === 'active') this.syncAll();
    });
  }

  setUser(id: string | undefined) {
    this.userId = id;
    this.hydrate();
    if (id) this.syncAll();
    else this.timers.forEach((t) => clearTimeout(t));
  }

  private syncAll() {
    if (!this.userId) return;
    const ids = new Set(this.markers.filter((m) => m.userId === this.userId && (m.state === 'pending' || m.state === 'deleting')).map((m) => m.matchId));
    for (const matchId of ids) void this.syncMatch(matchId);
  }

  // --- amallar ------------------------------------------------------------------
  /** Belgi telefon soati bilan darhol yoziladi; internet bo'lsa — darhol yuboriladi. */
  add(matchId: string, kind: MarkerKind, side: MarkerSide | null): QueuedMarker | undefined {
    this.hydrate();
    if (!this.userId) return undefined;
    const m: QueuedMarker = {
      client_marker_id: uuid(),
      matchId,
      userId: this.userId,
      kind,
      side,
      occurred_at: new Date().toISOString(),
      state: 'pending',
      created_at: Date.now(),
    };
    this.markers = [...this.markers, m];
    this.emit();
    void this.syncMatch(matchId);
    return m;
  }

  undo(clientMarkerId: string) {
    const m = this.markers.find((x) => x.client_marker_id === clientMarkerId);
    if (!m) return;
    const action = undoAction(m);
    if (action === 'drop') this.markers = this.markers.filter((x) => x.client_marker_id !== clientMarkerId);
    else if (action === 'delete') this.markers = this.markers.map((x) => (x.client_marker_id === clientMarkerId ? { ...x, state: 'deleting' } : x));
    else return;
    this.emit();
    if (action === 'delete') void this.syncMatch(m.matchId);
  }

  syncMatch(matchId: string): Promise<void> {
    const running = this.inFlight.get(matchId);
    if (running) return running;
    const run = this.runSync(matchId).finally(() => this.inFlight.delete(matchId));
    this.inFlight.set(matchId, run);
    return run;
  }

  private async runSync(matchId: string) {
    clearTimeout(this.timers.get(matchId));
    this.timers.delete(matchId);
    while (this.userId) {
      const mine = this.markers.filter((m) => m.matchId === matchId && m.userId === this.userId);
      const deleting = mine.find((m) => m.state === 'deleting');
      const batch = mine.filter((m) => m.state === 'pending').slice(0, MARKER_BATCH);
      if (!deleting && !batch.length) {
        this.setSync(matchId, IDLE);
        return;
      }
      this.setSync(matchId, { status: 'syncing', attempt: this.getSync(matchId).attempt });
      try {
        if (batch.length) {
          const res = await call(
            api.POST('/v1/host/matches/{matchId}/recording/markers', {
              params: { path: { matchId } },
              body: { markers: batch.map(markerWire) },
            }),
          );
          this.markers = applyMarkerResults(this.markers, res.results, Date.now());
        } else if (deleting) {
          try {
            await call(
              api.DELETE('/v1/host/matches/{matchId}/recording/markers/{clientMarkerId}', {
                params: { path: { matchId, clientMarkerId: deleting.client_marker_id } },
              }),
            );
          } catch (err) {
            // Serverda yo'q (masalan, rad etilgan edi) — lokal o'chirish yetarli
            if (!(err instanceof ApiError && err.code === 'NOT_FOUND')) throw err;
          }
          this.markers = this.markers.filter((x) => x.client_marker_id !== deleting.client_marker_id);
        }
        this.emit();
        void this.queryClient?.invalidateQueries({ queryKey: ['host-recording', matchId] });
      } catch (err) {
        const e = err instanceof ApiError ? err : ApiError.network(err);
        const attempt = this.getSync(matchId).attempt + 1;
        const transient = e.code === 'NETWORK' || e.status >= 500 || e.status === 429;
        this.setSync(matchId, { status: e.code === 'NETWORK' ? 'offline' : 'error', attempt, error: e.code });
        // 4xx (masalan, o'yin endi sizga biriktirilmagan) — avtomatik takrorlanmaydi
        if (transient) {
          const delay = e.retryAfter ? e.retryAfter * 1000 : backoffMs(attempt);
          this.timers.set(matchId, setTimeout(() => void this.syncMatch(matchId), delay));
        }
        return;
      }
    }
  }
}

export const markerEngine = new MarkerEngine();

export function useMarkers(matchId: string) {
  const version = useSyncExternalStore(markerEngine.subscribe, markerEngine.getVersion);
  return useMemo(() => {
    const all = markerEngine.list(matchId);
    return {
      all,
      visible: visibleMarkers(all, matchId),
      pending: all.filter((m) => m.state === 'pending' || m.state === 'deleting').length,
      sync: markerEngine.getSync(matchId),
    };
  }, [version, matchId]);
}
