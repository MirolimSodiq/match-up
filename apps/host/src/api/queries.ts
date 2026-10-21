import { useQuery } from '@tanstack/react-query';
import { type CachedRoster, type HostMatch, type MatchScope, offlineStore } from '@/offline/store';
import { api, call } from './client';
import { ApiError } from './errors';

export const qk = {
  me: ['me'] as const,
  offers: ['host-offers'] as const,
  matches: (scope: MatchScope) => ['host-matches', scope] as const,
  roster: (matchId: string) => ['roster', matchId] as const,
};

const isNetwork = (e: unknown) => e instanceof ApiError && e.code === 'NETWORK';

export function useOffers() {
  return useQuery({
    queryKey: qk.offers,
    queryFn: () => call(api.GET('/v1/host/offers')),
    // Offer 10 daqiqa yashaydi va boshqa host oldin olishi mumkin — tez-tez yangilaymiz
    refetchInterval: 20_000,
    staleTime: 5_000,
  });
}

export interface MatchList {
  items: HostMatch[];
  /** Internetsiz — diskdagi oxirgi ro'yxat. */
  fromCache: boolean;
  fetchedAt: number;
}

async function fetchMatches(scope: MatchScope): Promise<MatchList> {
  try {
    const items = await call(api.GET('/v1/host/matches', { params: { query: { scope } } }));
    const fetchedAt = Date.now();
    offlineStore.saveList(scope, items, fetchedAt);
    return { items, fromCache: false, fetchedAt };
  } catch (err) {
    const cached = offlineStore.getList(scope);
    if (isNetwork(err) && cached) return { ...cached, fromCache: true };
    throw err;
  }
}

export function useHostMatches(scope: MatchScope) {
  const cached = offlineStore.getList(scope);
  return useQuery({
    queryKey: qk.matches(scope),
    queryFn: () => fetchMatches(scope),
    // Internetsiz ham queryFn ishlaydi va diskdagi nusxani qaytaradi
    networkMode: 'always',
    retry: false,
    initialData: cached ? { ...cached, fromCache: true } : undefined,
    initialDataUpdatedAt: cached?.fetchedAt,
    staleTime: 15_000,
  });
}

export interface RosterData extends CachedRoster {
  fromCache: boolean;
}

export async function fetchRoster(matchId: string): Promise<RosterData> {
  // So'rov BOSHLANGAN vaqt: shundan keyin server qabul qilgan event'lar bu javobda bo'lmasligi mumkin
  const startedAt = Date.now();
  try {
    const roster = await call(api.GET('/v1/host/matches/{matchId}/roster', { params: { path: { matchId } } }));
    offlineStore.saveRoster(matchId, roster, startedAt);
    return { roster, fetchedAt: startedAt, fromCache: false };
  } catch (err) {
    const cached = offlineStore.getRoster(matchId);
    if (isNetwork(err) && cached) return { ...cached, fromCache: true };
    throw err;
  }
}

/** Roster: tarmoqdan, bo'lmasa diskdagi keshdan (QR public key bilan) — maydonda internetsiz ishlash uchun. */
export function useRoster(matchId: string) {
  const cached = offlineStore.getRoster(matchId);
  return useQuery({
    queryKey: qk.roster(matchId),
    queryFn: () => fetchRoster(matchId),
    networkMode: 'always',
    retry: false,
    initialData: cached ? { ...cached, fromCache: true } : undefined,
    initialDataUpdatedAt: cached?.fetchedAt,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

/** Tayinlangan o'yin (ro'yxatlardan; alohida GET endpoint yo'q). Diskdagi nusxa ham hisobga olinadi. */
export function useHostMatch(matchId: string) {
  const today = useHostMatches('today');
  const upcoming = useHostMatches('upcoming');
  const past = useHostMatches('past');
  const all = [today.data, upcoming.data, past.data].flatMap((l) => l?.items ?? []);
  const match = all.find((m) => m.match?.id === matchId) ?? offlineStore.findHostMatch(matchId);
  return {
    match,
    isLoading: !match && (today.isLoading || upcoming.isLoading || past.isLoading),
    error: today.error ?? upcoming.error ?? past.error,
    refetch: () => Promise.all([today.refetch(), upcoming.refetch(), past.refetch()]),
  };
}

/** Host ilovasi: shu match'ning kliplari (qayta ishlanayotganlari bilan). */
export function useHostHighlights(matchId: string, enabled = true) {
  return useQuery({
    queryKey: ['host-highlights', matchId] as const,
    queryFn: () => call(api.GET('/v1/host/matches/{matchId}/highlights', { params: { path: { matchId } } })),
    enabled,
    staleTime: 10_000,
    // Worker ishlayotgan klip bo'lsa — tez-tez yangilaymiz
    refetchInterval: (q) => (q.state.data?.items.some((h) => h.status === 'processing') ? 5_000 : false),
  });
}
