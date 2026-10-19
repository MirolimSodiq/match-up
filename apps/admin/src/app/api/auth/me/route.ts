import { acceptLanguage, API_URL, ensureAccess, problem } from '@/server/session';

/** Joriy admin profili (kerak bo'lsa token'ni yangilaydi va cookie'larni yozadi). */
export async function GET() {
  const s = await ensureAccess();
  if ('error' in s) return problem(401, s.error);
  const res = await fetch(`${API_URL}/v1/me`, {
    headers: { authorization: `Bearer ${s.access}`, 'accept-language': await acceptLanguage() },
    cache: 'no-store',
  });
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
}
