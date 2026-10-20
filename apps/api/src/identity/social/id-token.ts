import { createHash, verify as cryptoVerify } from 'node:crypto';
import type { JwksCache, ResolvedKey } from './jwks';

/**
 * OpenID Connect ID token (Google / Apple) tekshiruvi — faqat node:crypto (jose v6 ESM-only, Jest'da yuklanmaydi).
 * Faqat RS256 va ES256 qabul qilinadi; alg kalit turiga mos bo'lishi shart (alg confusion / `none` imkonsiz).
 */
export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  azp?: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean | 'true' | 'false';
  name?: string;
  given_name?: string;
  family_name?: string;
  [claim: string]: unknown;
}

export interface IdTokenExpectations {
  jwksUrl: string;
  issuers: readonly string[];
  audiences: readonly string[];
  /** Client yuborgan xom nonce. Token'da `nonce` bo'lsa — majburiy va mos kelishi kerak. */
  nonce?: string;
  leewaySec?: number;
  now?: number;
}

/** Tekshiruv rad etildi — sababi faqat logga yoziladi, client'ga umumiy SOCIAL_TOKEN_INVALID. */
export class IdTokenRejected extends Error {}

const MAX_TOKEN_LENGTH = 8192;
const SUPPORTED = new Set(['RS256', 'ES256']);

const fail = (reason: string): never => {
  throw new IdTokenRejected(reason);
};

function decodeJson<T>(part: string, what: string): T {
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    return fail(`${what}: JSON emas`);
  }
}

function keyMatchesAlg(alg: string, k: ResolvedKey): boolean {
  if (k.jwk.alg && k.jwk.alg !== alg) return false;
  const details = k.key.asymmetricKeyDetails;
  if (alg === 'RS256') return k.key.asymmetricKeyType === 'rsa' && (details?.modulusLength ?? 0) >= 2048;
  return k.key.asymmetricKeyType === 'ec' && details?.namedCurve === 'prime256v1';
}

/** Apple/Firebase konvensiyasi: client provider'ga SHA-256(nonce) beradi, serverga xom nonce'ni yuboradi. */
export function nonceMatches(claim: string, raw: string): boolean {
  return claim === raw || claim === createHash('sha256').update(raw).digest('hex');
}

export async function verifyIdToken(token: string, jwks: JwksCache, expect: IdTokenExpectations): Promise<IdTokenClaims> {
  if (token.length > MAX_TOKEN_LENGTH) fail('juda uzun');
  const parts = token.split('.');
  if (parts.length !== 3) fail('format');
  const [h, p, s] = parts as [string, string, string];

  const header = decodeJson<{ alg?: unknown; kid?: unknown }>(h, 'header');
  if (typeof header.alg !== 'string' || !SUPPORTED.has(header.alg)) fail(`alg ${String(header.alg)}`);
  if (typeof header.kid !== 'string' || !header.kid) fail('kid yo\'q');
  const alg = header.alg as 'RS256' | 'ES256';

  const key = await jwks.getKey(expect.jwksUrl, header.kid as string);
  if (!key) fail(`kid topilmadi: ${String(header.kid)}`);
  if (!keyMatchesAlg(alg, key!)) fail('alg kalit turiga mos emas');

  const sig = Buffer.from(s, 'base64url');
  if (alg === 'ES256' && sig.length !== 64) fail('ES256 imzo uzunligi');
  const ok = cryptoVerify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    alg === 'ES256' ? { key: key!.key, dsaEncoding: 'ieee-p1363' } : key!.key,
    sig,
  );
  if (!ok) fail('imzo');

  const c = decodeJson<IdTokenClaims>(p, 'payload');
  const now = expect.now ?? Math.floor(Date.now() / 1000);
  const leeway = expect.leewaySec ?? 30;

  if (typeof c.iss !== 'string' || !expect.issuers.includes(c.iss)) fail(`iss ${String(c.iss)}`);
  const auds = typeof c.aud === 'string' ? [c.aud] : Array.isArray(c.aud) ? c.aud : [];
  if (!auds.some((a) => expect.audiences.includes(a))) fail('aud');
  // Bir nechta auditoriya bo'lsa, token kimga berilgani (azp) ham bizniki bo'lishi kerak (OIDC Core 3.1.3.7)
  if (auds.length > 1 && (typeof c.azp !== 'string' || !expect.audiences.includes(c.azp))) fail('azp');
  if (typeof c.exp !== 'number') fail('exp yo\'q');
  if (c.exp <= now - leeway) fail('muddati o\'tgan');
  if (typeof c.iat !== 'number' || c.iat > now + leeway) fail('iat');
  if (typeof c.nbf === 'number' && c.nbf > now + leeway) fail('nbf');
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 255) fail('sub');

  // Nonce: token biror client sessiyasiga bog'langan bo'lsa, o'g'irlangan token'ni xom nonce'siz ishlatib bo'lmaydi
  if (c.nonce !== undefined || expect.nonce !== undefined) {
    if (typeof c.nonce !== 'string' || expect.nonce === undefined || !nonceMatches(c.nonce, expect.nonce)) fail('nonce');
  }
  return c;
}
