import { acceptLanguage, API_URL, DEVICE, problem, sameOrigin, setSession, type TokenPair } from '@/server/session';

interface VerifyResponse extends TokenPair {
  user: { id: string; display_name: string; roles: string[] };
}

const ADMIN_ROLES = ['admin', 'super_admin'];

/**
 * OTP tasdiqlash: token'lar httpOnly cookie'ga yoziladi, brauzerga faqat profil qaytadi.
 * Admin roli bo'lmasa — yangi sessiya darhol bekor qilinadi va 403 NOT_ADMIN.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return problem(403, 'FORBIDDEN');
  const body = (await req.json().catch(() => ({}))) as { challenge_id?: string; code?: string };
  const lang = await acceptLanguage();
  const res = await fetch(`${API_URL}/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': lang },
    body: JSON.stringify({ challenge_id: body.challenge_id, code: body.code, device: { ...DEVICE, locale: lang } }),
    cache: 'no-store',
  });
  if (!res.ok) {
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/problem+json' } });
  }
  const data = (await res.json()) as VerifyResponse;
  if (!data.user.roles.some((r) => ADMIN_ROLES.includes(r))) {
    await fetch(`${API_URL}/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${data.access_token}` }, cache: 'no-store' });
    return problem(403, 'NOT_ADMIN');
  }
  await setSession(data);
  return Response.json({ user: data.user });
}
