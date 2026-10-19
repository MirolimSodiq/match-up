import type { NextRequest } from 'next/server';
import { acceptLanguage, API_URL, ensureAccess, problem, sameOrigin } from '@/server/session';

/** Brauzerdan API'ga uzatiladigan header'lar (cookie'lar API'ga hech qachon bormaydi). */
const FORWARD = ['content-type', 'idempotency-key', 'accept'];

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] !== 'v1' || path.some((p) => p === '..' || p === '')) return problem(404, 'NOT_FOUND');
  if (!sameOrigin(req)) return problem(403, 'FORBIDDEN');

  const target = `${API_URL}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const headers = new Headers({ 'accept-language': await acceptLanguage() });
  for (const h of FORWARD) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  const send = (access: string) => {
    headers.set('authorization', `Bearer ${access}`);
    return fetch(target, { method: req.method, headers, body, cache: 'no-store' });
  };

  let s = await ensureAccess();
  if ('error' in s) return problem(401, s.error);
  let res = await send(s.access);
  if (res.status === 401) {
    // Access token API tomonida rad etildi (masalan, kalit almashdi) — bir marta majburiy refresh
    s = await ensureAccess({ force: true });
    if ('error' in s) return problem(401, s.error);
    res = await send(s.access);
  }
  const out = new Headers();
  for (const h of ['content-type', 'retry-after', 'x-request-id']) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: out });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
