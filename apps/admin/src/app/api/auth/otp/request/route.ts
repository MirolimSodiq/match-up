import { acceptLanguage, API_URL, problem, sameOrigin } from '@/server/session';

/** OTP so'rovi — API'ga uzatiladi (public endpoint). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return problem(403, 'FORBIDDEN');
  const res = await fetch(`${API_URL}/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': await acceptLanguage() },
    body: await req.text(),
    cache: 'no-store',
  });
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
}
