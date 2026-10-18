import { Platform } from 'react-native';
import Constants from 'expo-constants';
import createClient from 'openapi-fetch';
import type { paths, Tokens } from '@matchup/contracts';
import { tokens } from '@/auth/tokens';
import { currentLocale } from '@/i18n';
import { APP_VERSION, currentDeviceId } from '@/lib/device';
import { ApiError } from './errors';

function defaultBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  // Expo Go / dev build: Metro qaysi hostda bo'lsa, API ham o'sha kompyuterda (port 3000)
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host && Platform.OS !== 'web') return `http://${host}:3000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

export const API_URL = defaultBaseUrl();

function withCommonHeaders(headers: Headers, token?: string): Headers {
  headers.set('Accept-Language', currentLocale());
  headers.set('X-App-Version', APP_VERSION);
  const deviceId = currentDeviceId();
  if (deviceId) headers.set('X-Device-Id', deviceId);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');
  return headers;
}

// ---------------------------------------------------------------------------
// Refresh token rotation: bir vaqtda bir nechta 401 kelsa ham faqat BITTA /auth/refresh.
// Ikkinchi parallel refresh eski token bilan ketib, server uni o'g'irlik deb hisoblardi (TOKEN_REUSED).
// ---------------------------------------------------------------------------
let refreshing: Promise<string | null> | null = null;

function refreshOnce(): Promise<string | null> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return null;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: withCommonHeaders(new Headers({ 'Content-Type': 'application/json' })),
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (err) {
    throw ApiError.network(err);
  }
  if (res.ok) {
    const pair = (await res.json()) as Tokens;
    await tokens.save(pair);
    return pair.access_token;
  }
  const error = ApiError.fromResponse(res, await res.json().catch(() => undefined));
  if (error.code === 'TOKEN_REUSED') {
    await tokens.end('token_reused');
    return null;
  }
  if (res.status === 401) {
    await tokens.end('expired');
    return null;
  }
  throw error;
}

async function authFetch(request: Request): Promise<Response> {
  // Body bir marta o'qiladi — qayta yuborish uchun nusxa oldindan olinadi
  const retry = request.clone();
  const used = tokens.access;
  const res = await fetch(new Request(request, { headers: withCommonHeaders(new Headers(request.headers), used) }));
  if (res.status !== 401 || !used) return res;

  // Boshqa so'rov token'ni allaqachon yangilagan bo'lsa — refresh'siz qayta urinamiz
  const latest = tokens.access;
  const fresh = latest && latest !== used ? latest : await refreshOnce();
  if (!fresh) return res;
  return fetch(new Request(retry, { headers: withCommonHeaders(new Headers(retry.headers), fresh) }));
}

/** `api/openapi.yaml` bo'yicha tiplangan client. */
export const api = createClient<paths>({ baseUrl: API_URL, fetch: authFetch });

/**
 * openapi-fetch natijasini ochadi: muvaffaqiyatda `data`, aks holda `ApiError` (RFC 9457) tashlaydi.
 * TanStack Query xatolarni shu orqali ko'radi.
 */
export async function call<D>(promise: Promise<{ data?: D; error?: unknown; response: Response }>): Promise<D> {
  let result: { data?: D; error?: unknown; response: Response };
  try {
    result = await promise;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.network(err);
  }
  if (!result.response.ok) throw ApiError.fromResponse(result.response, result.error);
  return result.data as D;
}
