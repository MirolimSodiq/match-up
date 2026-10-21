import { Share } from 'react-native';
import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Highlight, HighlightPage } from '@matchup/contracts';
import { api, call } from '@/api/client';

export const hk = {
  match: (matchId: string) => ['highlights', 'match', matchId] as const,
  mine: (scope: 'all' | 'tagged') => ['highlights', 'me', scope] as const,
  one: (id: string) => ['highlights', 'one', id] as const,
};

/**
 * Ijro URL'lari imzolangan va muddatli (`playback.expires_at`, standart 6 soat) — ro'yxatlar 10 daqiqada
 * eskiradi, player ekrani esa har ochilganda yangi URL oladi.
 */
const STALE = 10 * 60_000;

/** Match highlight'lari — faqat ishtirokchilarga (aks holda 403, so'rov qayta urinilmaydi). */
export function useMatchHighlights(matchId: string, enabled: boolean) {
  return useQuery({
    queryKey: hk.match(matchId),
    queryFn: () => call(api.GET('/v1/matches/{matchId}/highlights', { params: { path: { matchId }, query: { limit: 20 } } })),
    enabled,
    staleTime: STALE,
    retry: false,
  });
}

export function useMyHighlights(scope: 'all' | 'tagged' = 'all') {
  return useInfiniteQuery({
    queryKey: hk.mine(scope),
    queryFn: ({ pageParam }) =>
      call(api.GET('/v1/me/highlights', { params: { query: { scope, limit: 20, cursor: pageParam } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: STALE,
  });
}

export function useHighlight(id: string) {
  return useQuery({
    queryKey: hk.one(id),
    queryFn: () => call(api.GET('/v1/highlights/{highlightId}', { params: { path: { highlightId: id } } })),
    // Har ochilishda yangi imzolangan URL
    staleTime: 0,
    gcTime: 60_000,
  });
}

/** Barcha keshlangan ro'yxatlarda bitta highlight'ni yangilaydi (like holati). */
function patchEverywhere(qc: QueryClient, id: string, patch: (h: Highlight) => Highlight) {
  qc.setQueriesData<HighlightPage>({ queryKey: ['highlights', 'match'] }, (d) => (d ? { ...d, items: d.items.map((h) => (h.id === id ? patch(h) : h)) } : d));
  qc.setQueriesData<InfiniteData<HighlightPage>>({ queryKey: ['highlights', 'me'] }, (d) =>
    d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((h) => (h.id === id ? patch(h) : h)) })) } : d,
  );
  qc.setQueryData<Highlight>(hk.one(id), (h) => (h ? patch(h) : h));
}

/** Like / unlike — optimistik, server javobi bilan aniqlashtiriladi. */
export function useLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) =>
      call(
        liked
          ? api.PUT('/v1/highlights/{highlightId}/like', { params: { path: { highlightId: id } } })
          : api.DELETE('/v1/highlights/{highlightId}/like', { params: { path: { highlightId: id } } }),
      ),
    onMutate: ({ id, liked }) => {
      patchEverywhere(qc, id, (h) =>
        h.liked_by_me === liked ? h : { ...h, liked_by_me: liked, likes_count: Math.max(0, h.likes_count + (liked ? 1 : -1)) },
      );
    },
    onSuccess: (r) => patchEverywhere(qc, r.highlight_id, (h) => ({ ...h, liked_by_me: r.liked, likes_count: r.likes_count })),
    onError: (_e, { id, liked }) =>
      patchEverywhere(qc, id, (h) => ({ ...h, liked_by_me: !liked, likes_count: Math.max(0, h.likes_count + (liked ? -1 : 1)) })),
  });
}

/** Imzolangan ochiq havola (7 kun) -> tizim share sheet'i (Telegram, Instagram, ...). */
export async function shareHighlight(id: string): Promise<boolean> {
  const s = await call(api.POST('/v1/highlights/{highlightId}/share', { params: { path: { highlightId: id } }, body: { channel: 'link' } }));
  const res = await Share.share({ message: `${s.text}\n${s.url}`, url: s.url });
  return res.action === Share.sharedAction;
}
