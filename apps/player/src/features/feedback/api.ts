import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MatchFeedback, MatchFeedbackSubmit } from '@matchup/contracts';
import { api, call } from '@/api/client';

export type FeedbackTarget = MatchFeedback['given'][number]['target'];
export type FeedbackItem = MatchFeedbackSubmit['items'][number];

export const fk = { match: (matchId: string) => ['match-feedback', matchId] as const };

/**
 * O'yin haqida baholash holati. Faqat o'yinga kelgan (`checked_in`) o'yinchi uchun: boshqalarga 403,
 * yakunlanmagan o'yinda 409 — ekran va match kartasi shu xatolarga qarab ko'rinadi, so'rov qayta urinilmaydi.
 */
export function useMatchFeedback(matchId: string, enabled = true) {
  return useQuery({
    queryKey: fk.match(matchId),
    queryFn: () => call(api.GET('/v1/matches/{matchId}/feedback', { params: { path: { matchId } } })),
    enabled,
    retry: false,
  });
}

/** Bir nechta baho bitta so'rovda; qayta yuborilsa shu nishon uchun baho yangilanadi. */
export function useSubmitFeedback(matchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: FeedbackItem[]) => call(api.POST('/v1/matches/{matchId}/feedback', { params: { path: { matchId } }, body: { items } })),
    onSuccess: (data) => queryClient.setQueryData(fk.match(matchId), data),
  });
}

/** Baho kaliti: nishon + kimga (host / o'yinchi) — `given` va forma holatini bog'lash uchun. */
export const feedbackKey = (target: FeedbackTarget, userId?: string | null) => `${target}:${userId ?? ''}`;
