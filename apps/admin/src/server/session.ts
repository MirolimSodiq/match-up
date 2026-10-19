/**
 * BFF sessiyasi (faqat server: route handler'lar va server komponentlar).
 *
 * Token'lar brauzerga hech qachon berilmaydi: access va refresh token httpOnly cookie'da, API'ga
 * faqat Next server Bearer bilan murojaat qiladi. Refresh token rotation:
 *   * access muddati tugashiga oz qolsa yoki API 401 UNAUTHORIZED qaytarsa — /v1/auth/refresh;
 *   * parallel so'rovlar bitta eski refresh token bilan kelsa, rotation BIR marta bajariladi
 *     (aks holda ikkinchisi API'da TOKEN_REUSED -> butun sessiya oilasi bekor bo'lardi);
 *   * API TOKEN_REUSED qaytarsa — cookie'lar o'chiriladi, foydalanuvchi qayta kiradi.
 */
import { cookies } from 'next/headers';

export const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const ACCESS_COOKIE = 'mu_admin_at';
export const REFRESH_COOKIE = 'mu_admin_rt';
export const LANG_COOKIE = 'mu_lang';
export const DEVICE = { device_id: 'matchup-admin-web', platform: 'web', app_version: '0.1.0' } as const;

const REFRESH_TTL_SEC = 30 * 24 * 3600;
/** Access token tugashidan shuncha oldin yangilanadi. */
const ACCESS_SKEW_SEC = 30;
/** Eski refresh token -> yangi juftlik: kechikib kelgan parallel so'rovlar uchun. */
const RECENT_TTL_MS = 60_000;

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export type SessionError = 'UNAUTHORIZED' | 'TOKEN_REUSED';
type RotateResult = TokenPair | { error: SessionError };

// Dev'da route'lar alohida modul nusxalarida bo'lishi mumkin — holat globalThis'da
const state = ((globalThis as { __muAdminRefresh?: { inflight: Map<string, Promise<RotateResult>>; recent: Map<string, { pair: TokenPair; at: number }> } })
  .__muAdminRefresh ??= { inflight: new Map(), recent: new Map() });

export async function acceptLanguage(): Promise<string> {
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  return lang === 'ru' ? 'ru' : 'uz-Latn';
}

function jwtExp(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

const expiringSoon = (token: string) => {
  const exp = jwtExp(token);
  return exp === undefined || exp - ACCESS_SKEW_SEC <= Date.now() / 1000;
};

async function doRotate(refresh: string): Promise<RotateResult> {
  const res = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
    cache: 'no-store',
  });
  if (res.ok) return (await res.json()) as TokenPair;
  const body = (await res.json().catch(() => null)) as { code?: string } | null;
  return { error: body?.code === 'TOKEN_REUSED' ? 'TOKEN_REUSED' : 'UNAUTHORIZED' };
}

async function rotate(refresh: string): Promise<RotateResult> {
  const now = Date.now();
  for (const [k, v] of state.recent) if (now - v.at > RECENT_TTL_MS) state.recent.delete(k);
  const recent = state.recent.get(refresh);
  if (recent) return recent.pair;

  let p = state.inflight.get(refresh);
  if (!p) {
    p = doRotate(refresh).finally(() => state.inflight.delete(refresh));
    state.inflight.set(refresh, p);
  }
  const r = await p;
  if (!('error' in r)) state.recent.set(refresh, { pair: r, at: Date.now() });
  return r;
}

const secure = process.env.NODE_ENV === 'production';

export async function setSession(pair: TokenPair) {
  const store = await cookies();
  store.set(ACCESS_COOKIE, pair.access_token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: pair.expires_in });
  store.set(REFRESH_COOKIE, pair.refresh_token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: REFRESH_TTL_SEC });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

/** Faqat route handler'larda (cookie yozish mumkin bo'lgan joyda) chaqiriladi. */
export async function ensureAccess(opts: { force?: boolean } = {}): Promise<{ access: string } | { error: SessionError }> {
  const store = await cookies();
  const access = store.get(ACCESS_COOKIE)?.value;
  const refresh = store.get(REFRESH_COOKIE)?.value;
  if (access && !opts.force && !expiringSoon(access)) return { access };
  if (!refresh) return { error: 'UNAUTHORIZED' };
  const r = await rotate(refresh);
  if ('error' in r) {
    await clearSession();
    return r;
  }
  await setSession(r);
  return { access: r.access_token };
}

/** Server komponentlar uchun: sessiya bormi (cookie yozmaydi, token yangilamaydi). */
export async function hasSession(): Promise<boolean> {
  return (await cookies()).has(REFRESH_COOKIE);
}

export function problem(status: number, code: string, detail?: string) {
  return Response.json(
    { type: `https://docs.matchup.example/errors/${code.toLowerCase().replace(/_/g, '-')}`, title: code, status, code, detail },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

/** CSRF: holat o'zgartiruvchi so'rovlar faqat shu origin'dan (SameSite=Lax ustiga qo'shimcha himoya). */
export function sameOrigin(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
