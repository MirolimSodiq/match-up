'use client';

import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';

/** Shaharlar, sportlar, qulayliklar, sirt turlari — kam o'zgaradi. */
export function useReference() {
  return useQuery({
    queryKey: ['reference'],
    queryFn: () => unwrap(api.GET('/v1/admin/reference')),
    staleTime: 10 * 60_000,
  });
}

/** Barcha faol venue'lar (pitch'lari bilan) — formalardagi tanlovlar uchun. */
export function useAllVenues(activeOnly = true) {
  return useQuery({
    queryKey: ['venues', 'all', activeOnly],
    queryFn: () => unwrap(api.GET('/v1/admin/venues', { params: { query: { limit: 200, ...(activeOnly ? { is_active: 'true' as const } : {}) } } })),
    staleTime: 60_000,
  });
}
