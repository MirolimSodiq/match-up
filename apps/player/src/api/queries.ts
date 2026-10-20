import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { DataSubjectRequest, paths } from '@matchup/contracts';
import { api, call } from './client';

export type MatchSearch = NonNullable<paths['/v1/matches']['get']['parameters']['query']>;
export type BookingScope = 'upcoming' | 'past';

export const qk = {
  me: ['me'] as const,
  cities: ['cities'] as const,
  sports: ['sports'] as const,
  matches: (q: Omit<MatchSearch, 'cursor'>) => ['matches', q] as const,
  match: (idOrCode: string) => ['match', idOrCode] as const,
  waiver: (matchId: string) => ['waiver', matchId] as const,
  paymentMethods: (matchId: string) => ['payment-methods', matchId] as const,
  booking: (id: string) => ['booking', id] as const,
  myBookings: (scope: BookingScope) => ['my-bookings', scope] as const,
  ticket: (bookingId: string) => ['ticket', bookingId] as const,
  wallet: ['wallet'] as const,
  identities: ['identities'] as const,
  dataRequests: ['data-requests'] as const,
};

const HOUR = 60 * 60_000;

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => call(api.GET('/v1/me')) });
}

export function useCities() {
  return useQuery({ queryKey: qk.cities, queryFn: () => call(api.GET('/v1/cities')), staleTime: HOUR });
}

export function useSports() {
  return useQuery({ queryKey: qk.sports, queryFn: () => call(api.GET('/v1/sports')), staleTime: HOUR });
}

export function useMatchSearch(q: Omit<MatchSearch, 'cursor'> | undefined) {
  return useInfiniteQuery({
    queryKey: qk.matches(q ?? { lat: 0, lng: 0 }),
    enabled: !!q,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => call(api.GET('/v1/matches', { params: { query: { ...q!, cursor: pageParam } } })),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

/** `idOrCode` — UUID yoki public code (MU-RACE): server ikkalasini ham qabul qiladi. */
export function useMatch(idOrCode: string) {
  return useQuery({
    queryKey: qk.match(idOrCode),
    queryFn: () => call(api.GET('/v1/matches/{matchId}', { params: { path: { matchId: idOrCode } } })),
  });
}

export function useRequiredWaiver(matchId: string | undefined) {
  return useQuery({
    queryKey: qk.waiver(matchId ?? ''),
    enabled: !!matchId,
    queryFn: () => call(api.GET('/v1/waivers/required', { params: { query: { match_id: matchId! } } })),
  });
}

export function usePaymentMethods(matchId: string | undefined) {
  return useQuery({
    queryKey: qk.paymentMethods(matchId ?? ''),
    enabled: !!matchId,
    queryFn: () => call(api.GET('/v1/payment-methods', { params: { query: { match_id: matchId! } } })),
  });
}

/** To'lov kutilayotgan paytda holatni har 2 soniyada so'raydi (provider'dan qaytgandan keyin polling). */
export function useBooking(id: string) {
  return useQuery({
    queryKey: qk.booking(id),
    queryFn: () => call(api.GET('/v1/bookings/{bookingId}', { params: { path: { bookingId: id } } })),
    refetchInterval: (query) => (query.state.data?.status === 'pending_payment' ? 2000 : false),
  });
}

export function useMyBookings(scope: BookingScope) {
  return useInfiniteQuery({
    queryKey: qk.myBookings(scope),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      call(api.GET('/v1/me/bookings', { params: { query: { scope, cursor: pageParam, limit: 20 } } })),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useTicket(bookingId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.ticket(bookingId),
    enabled,
    queryFn: () => call(api.GET('/v1/bookings/{bookingId}/ticket', { params: { path: { bookingId } } })),
  });
}

/** Hamyon balansi (asosiy valyutada, `formatted` — Accept-Language bo'yicha). */
export function useWallet() {
  return useQuery({ queryKey: qk.wallet, queryFn: () => call(api.GET('/v1/me/wallet')) });
}

/** Kirish usullari: telefon va bog'langan Google / Apple / Telegram. */
export function useIdentities() {
  return useQuery({ queryKey: qk.identities, queryFn: () => call(api.GET('/v1/me/identities')) });
}

const OPEN_DSR = new Set(['received', 'in_progress']);

/** So'rov hali bajarilmoqda (job kutmoqda yoki ishlamoqda). */
export const isOpenRequest = (r: DataSubjectRequest) => OPEN_DSR.has(r.status);

/** GDPR so'rovlari (yangisi birinchi). Eksport tayyorlanayotganda har 3 soniyada yangilanadi. */
export function useDataRequests() {
  return useQuery({
    queryKey: qk.dataRequests,
    queryFn: () => call(api.GET('/v1/me/data-requests')),
    refetchInterval: (query) => {
      const lastExport = query.state.data?.items.find((r) => r.type === 'export');
      return lastExport && isOpenRequest(lastExport) ? 3000 : false;
    },
  });
}

/** Grace davridagi (hali bajarilmagan va bekor qilinmagan) akkaunt o'chirish so'rovi. */
export function openErasure(items: DataSubjectRequest[] | undefined): DataSubjectRequest | undefined {
  return items?.find((r) => r.type === 'erasure' && isOpenRequest(r));
}
