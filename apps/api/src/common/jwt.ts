import { type KeyObject, sign as edSign, verify as edVerify } from 'node:crypto';

/**
 * Minimal EdDSA (Ed25519) JWT — faqat node:crypto. Faqat `alg: EdDSA` qabul qilinadi
 * (alg confusion hujumlari imkonsiz), exp/nbf/iss/aud majburiy tekshiriladi.
 */
export interface JwtPayload {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  [claim: string]: unknown;
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');

export function signJwt(claims: Omit<JwtPayload, 'iat' | 'exp'>, ttlSec: number, key: KeyObject): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ ...claims, iat: now, exp: now + ttlSec }));
  const sig = edSign(null, Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64(sig)}`;
}

export function verifyJwt(token: string, key: KeyObject, expect: { iss: string; aud: string }): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('jwt: format');
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string };
  if (header.alg !== 'EdDSA') throw new Error('jwt: alg');
  if (!edVerify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) throw new Error('jwt: signature');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as JwtPayload;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('jwt: expired');
  if (typeof payload.nbf === 'number' && payload.nbf > now + 30) throw new Error('jwt: nbf');
  if (payload.iss !== expect.iss || payload.aud !== expect.aud) throw new Error('jwt: iss/aud');
  return payload;
}

/** Ixcham imzolangan token (QR chipta): `<prefix>.<base64url(json)>.<base64url(sig)>`. */
export function signCompact(prefix: string, data: object, key: KeyObject): string {
  const body = b64(JSON.stringify(data));
  const sig = edSign(null, Buffer.from(`${prefix}.${body}`), key);
  return `${prefix}.${body}.${b64(sig)}`;
}

export function verifyCompact<T>(prefix: string, token: string, key: KeyObject): T | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== prefix) return undefined;
  const [, body, sig] = parts as [string, string, string];
  try {
    if (!edVerify(null, Buffer.from(`${prefix}.${body}`), key, Buffer.from(sig, 'base64url'))) return undefined;
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return undefined;
  }
}
