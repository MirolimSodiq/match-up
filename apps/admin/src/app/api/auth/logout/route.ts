import { API_URL, clearSession, ensureAccess, problem, sameOrigin } from '@/server/session';

/** Sessiya oilasini API'da bekor qiladi va cookie'larni o'chiradi. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return problem(403, 'FORBIDDEN');
  const s = await ensureAccess();
  if (!('error' in s)) {
    await fetch(`${API_URL}/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${s.access}` }, cache: 'no-store' }).catch(() => undefined);
  }
  await clearSession();
  return new Response(null, { status: 204 });
}
