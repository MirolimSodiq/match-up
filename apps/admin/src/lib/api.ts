'use client';

import type { paths, Problem } from '@matchup/contracts';
import createClient, { type Middleware } from 'openapi-fetch';

/** RFC 9457 Problem Details — API'dan kelgan xato. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string | undefined,
    readonly errors: { field?: string; code?: string; message?: string }[] = [],
  ) {
    super(detail ?? code);
  }

  fieldError(field: string): string | undefined {
    return this.errors.find((e) => e.field === field || e.field?.startsWith(field + '.'))?.message;
  }
}

/** Sessiya tugagan yoki xavfsizlik sababli bekor qilingan — login sahifasiga. */
const sessionGuard: Middleware = {
  async onResponse({ response }) {
    if (response.status !== 401 || typeof window === 'undefined') return undefined;
    const body = (await response.clone().json().catch(() => null)) as Problem | null;
    const reason = body?.code === 'TOKEN_REUSED' ? 'reused' : 'expired';
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign(`/login?reason=${reason}&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    return undefined;
  },
};

/** Barcha so'rovlar BFF orqali: /api/proxy/v1/... -> API (Bearer token httpOnly cookie'dan). */
export const api = createClient<paths>({ baseUrl: '/api/proxy' });
api.use(sessionGuard);

/** openapi-fetch natijasini ochadi: xato bo'lsa ApiError tashlaydi. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (error !== undefined || !response.ok) {
    const e = (error ?? {}) as Partial<Problem>;
    throw new ApiError(response.status, e.code ?? `HTTP_${response.status}`, e.detail, (e.errors ?? []) as ApiError['errors']);
  }
  return data as T;
}

export const idempotencyKey = () => crypto.randomUUID();

/** Auth route'lari (BFF) uchun oddiy fetch. */
export async function authFetch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data ?? {}) as Partial<Problem>;
    throw new ApiError(res.status, e.code ?? `HTTP_${res.status}`, e.detail, (e.errors ?? []) as ApiError['errors']);
  }
  return data as T;
}
