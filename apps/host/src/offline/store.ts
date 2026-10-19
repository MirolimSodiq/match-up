import { useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { components } from '@matchup/contracts';
import { type QueuedEvent, type Roster, resolveResults, type SyncResult } from './core';

/**
 * Diskdagi offline holat (ilova qayta ochilsa ham saqlanadi):
 * - check-in event'lar navbati va ularning server natijalari (`queue.json`);
 * - roster keshi: participant'lar, `qr_public_key`, `roster_version` (`rosters.json`);
 * - o'yinlar ro'yxati (`lists.json`) — internetsiz ilova ochilganda ham bugungi o'yin ko'rinsin.
 * Web'da (faqat dev preview) — xotirada.
 */
export type HostMatch = components['schemas']['HostMatch'];
export type MatchScope = 'today' | 'upcoming' | 'past';

export interface CachedRoster {
  roster: Roster;
  /** So'rov boshlangan vaqt (ms): shundan keyin javob olgan event'lar roster'da yo'q deb hisoblanadi. */
  fetchedAt: number;
}

export interface MatchSyncState {
  status: 'idle' | 'syncing' | 'offline' | 'error';
  attempt: number;
  nextRetryAt?: number;
  /** Oxirgi xato kodi (ApiError.code). */
  error?: string;
  lastResult?: { accepted: number; duplicate: number; rejected: number; at: number };
}

const IDLE: MatchSyncState = { status: 'idle', attempt: 0 };
/** Yakunlangan (javob olingan) event'lar jurnalda shuncha saqlanadi. */
const RESOLVED_TTL_MS = 3 * 24 * 3600_000;
const ROSTER_TTL_MS = 3 * 24 * 3600_000;

const persistent = Platform.OS !== 'web';
const dir = persistent ? new Directory(Paths.document, 'matchup-host') : null;
const fileFor = (name: string) => (dir ? new File(dir, name) : null);

function readJson<T>(name: string, fallback: T): T {
  try {
    const f = fileFor(name);
    if (!f?.exists) return fallback;
    return JSON.parse(f.textSync()) as T;
  } catch {
    return fallback;
  }
}

function writeJson(name: string, value: unknown) {
  const f = fileFor(name);
  if (!f || !dir) return;
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    // Sinxron: ketma-ket yozuvlar tartibi saqlansin va "navbatga qo'shildi" deganda diskda bo'lsin
    f.writeSync(JSON.stringify(value));
  } catch (err) {
    console.warn(`offline store: ${name} yozilmadi`, err);
  }
}

type Listener = () => void;

class OfflineStore {
  private events: QueuedEvent[] = [];
  private rosters: Record<string, CachedRoster> = {};
  private lists: Partial<Record<MatchScope, { items: HostMatch[]; fetchedAt: number }>> = {};
  private sync: Record<string, MatchSyncState> = {};
  private listeners = new Set<Listener>();
  private version = 0;

  /** Ilova ishga tushganda (sinxron o'qish — bir necha KB). */
  hydrate() {
    const now = Date.now();
    this.events = readJson<QueuedEvent[]>('queue.json', []).filter((e) => e.state === 'pending' || now - (e.synced_at ?? now) < RESOLVED_TTL_MS);
    this.rosters = Object.fromEntries(
      Object.entries(readJson<Record<string, CachedRoster>>('rosters.json', {})).filter(([, r]) => now - r.fetchedAt < ROSTER_TTL_MS),
    );
    this.lists = readJson('lists.json', {});
    this.emit();
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  // ---------------------------------------------------------------- navbat
  enqueue(e: QueuedEvent) {
    this.events = [...this.events, e];
    writeJson('queue.json', this.events);
    this.emit();
  }

  eventsFor(matchId: string): QueuedEvent[] {
    return this.events.filter((e) => e.match_id === matchId);
  }

  pending(matchId: string, userId: string): QueuedEvent[] {
    return this.events.filter((e) => e.match_id === matchId && e.user_id === userId && e.state === 'pending');
  }

  pendingCount(userId: string | undefined, matchId?: string): number {
    return this.events.filter((e) => e.state === 'pending' && e.user_id === userId && (!matchId || e.match_id === matchId)).length;
  }

  matchesWithPending(userId: string): string[] {
    return [...new Set(this.events.filter((e) => e.state === 'pending' && e.user_id === userId).map((e) => e.match_id))];
  }

  applyResults(results: readonly SyncResult[], now = Date.now()) {
    this.events = resolveResults(this.events, results, now);
    writeJson('queue.json', this.events);
    this.emit();
  }

  /** Dev: javob olingan event'larni qayta navbatga qo'yadi (server `duplicate` qaytarishini tekshirish uchun). */
  requeueResolved(matchId: string) {
    this.events = this.events.map((e) =>
      e.match_id === matchId && (e.state === 'accepted' || e.state === 'duplicate') ? { ...e, state: 'pending', synced_at: undefined } : e,
    );
    writeJson('queue.json', this.events);
    this.emit();
  }

  // ---------------------------------------------------------------- roster keshi
  getRoster(matchId: string): CachedRoster | undefined {
    return this.rosters[matchId];
  }

  saveRoster(matchId: string, roster: Roster, fetchedAt: number) {
    const prev = this.rosters[matchId];
    // Parallel so'rovlarda eskisi yangisini bosib ketmasin
    if (prev && prev.fetchedAt > fetchedAt) return;
    this.rosters = { ...this.rosters, [matchId]: { roster, fetchedAt } };
    writeJson('rosters.json', this.rosters);
    this.emit();
  }

  /** Jamoaga o'tkazishdan keyin (PATCH javobi) keshni yangilaydi. */
  patchParticipant(matchId: string, participantId: string, patch: Partial<NonNullable<Roster['participants']>[number]>) {
    const cached = this.rosters[matchId];
    if (!cached) return;
    const participants = cached.roster.participants?.map((p) => (p.participant_id === participantId ? { ...p, ...patch } : p));
    this.rosters = { ...this.rosters, [matchId]: { ...cached, roster: { ...cached.roster, participants } } };
    writeJson('rosters.json', this.rosters);
    this.emit();
  }

  // ---------------------------------------------------------------- o'yinlar ro'yxati
  getList(scope: MatchScope) {
    return this.lists[scope];
  }

  saveList(scope: MatchScope, items: HostMatch[], fetchedAt = Date.now()) {
    this.lists = { ...this.lists, [scope]: { items, fetchedAt } };
    writeJson('lists.json', this.lists);
    this.emit();
  }

  findHostMatch(matchId: string): HostMatch | undefined {
    for (const scope of ['today', 'upcoming', 'past'] as const) {
      const found = this.lists[scope]?.items.find((m) => m.match?.id === matchId);
      if (found) return found;
    }
    return undefined;
  }

  // ---------------------------------------------------------------- sinxron holati (xotirada)
  getSync(matchId: string): MatchSyncState {
    return this.sync[matchId] ?? IDLE;
  }

  setSync(matchId: string, patch: Partial<MatchSyncState>) {
    this.sync = { ...this.sync, [matchId]: { ...this.getSync(matchId), ...patch } };
    this.emit();
  }

  /** Chiqishda: kesh tozalanadi, serverga yetmagan event'lar saqlanib qoladi (shu host qayta kirsa yuboriladi). */
  clearForLogout() {
    this.events = this.events.filter((e) => e.state === 'pending');
    this.rosters = {};
    this.lists = {};
    this.sync = {};
    writeJson('queue.json', this.events);
    writeJson('rosters.json', this.rosters);
    writeJson('lists.json', this.lists);
    this.emit();
  }
}

export const offlineStore = new OfflineStore();

/** Store o'zgarganda qayta render. `deps` — selektor bog'liq bo'lgan props (masalan, matchId). */
export function useOfflineStore<T>(select: (s: OfflineStore) => T, deps: readonly unknown[] = []): T {
  const version = useSyncExternalStore(offlineStore.subscribe, offlineStore.getVersion);
  // `select` inline funksiya — natija faqat version va deps o'zgarganda qayta hisoblanadi
  return useMemo(() => select(offlineStore), [version, ...deps]);
}
