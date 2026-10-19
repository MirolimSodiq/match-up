import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { asciiBytes, base64UrlDecode, utf8Decode } from './base64url';

// Sinxron tekshiruv uchun SHA-512 (Hermes'da WebCrypto yo'q)
ed.hashes.sha512 = sha512;

/**
 * QR chipta: `mu1.<base64url(JSON {p, m, e})>.<base64url(Ed25519 imzo)>`.
 * Imzolangan xabar — `"mu1.<body>"` ning UTF-8 baytlari; public key — raw 32 bayt (base64url).
 * Backend: `apps/api/src/common/jwt.ts` (`signCompact` / `verifyCompact`).
 */
export const TICKET_PREFIX = 'mu1';

export interface TicketClaims {
  /** match_participants.id */
  p: string;
  /** match_id */
  m: string;
  /** Amal qilish muddati (unix, soniya) */
  e: number;
}

export type TicketRejectReason =
  /** Format buzilgan: QR boshqa narsa yoki kesilgan. */
  | 'MALFORMED'
  /** Imzo noto'g'ri — soxta yoki boshqa kalit bilan imzolangan. */
  | 'INVALID_SIGNATURE'
  /** Boshqa o'yin chiptasi (server `NOT_ON_ROSTER` qaytaradi). */
  | 'WRONG_MATCH'
  /** Muddati o'tgan (server `TICKET_EXPIRED`). */
  | 'EXPIRED';

export type TicketCheck =
  | { ok: true; claims: TicketClaims; token: string }
  | { ok: false; reason: TicketRejectReason; claims?: TicketClaims };

interface ParsedTicket {
  token: string;
  message: Uint8Array;
  signature: Uint8Array;
  claims: TicketClaims;
}

function isClaims(v: unknown): v is TicketClaims {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.p === 'string' && c.p.length > 0 && typeof c.m === 'string' && c.m.length > 0 && typeof c.e === 'number' && Number.isFinite(c.e);
}

/** Tokenni bo'laklarga ajratadi (imzoni tekshirmaydi). */
export function parseTicket(raw: string): ParsedTicket | null {
  const token = raw.trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, body, sig] = parts as [string, string, string];
  if (prefix !== TICKET_PREFIX || !body || !sig) return null;
  const message = asciiBytes(`${prefix}.${body}`);
  const signature = base64UrlDecode(sig);
  const json = base64UrlDecode(body);
  if (!message || !signature || !json) return null;
  const text = utf8Decode(json);
  if (text === null) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  return { token, message, signature, claims };
}

export function decodePublicKey(publicKeyB64Url: string): Uint8Array | null {
  const key = base64UrlDecode(publicKeyB64Url.trim());
  return key && key.length === 32 ? key : null;
}

/**
 * Internetsiz tekshiruv — server bilan bir xil tartibda: imzo -> match -> muddat.
 * `now` — millisekund (testlar uchun beriladi).
 */
export function verifyTicket(raw: string, opts: { publicKey: string | Uint8Array; matchId: string; now?: number }): TicketCheck {
  const parsed = parseTicket(raw);
  if (!parsed) return { ok: false, reason: 'MALFORMED' };
  const key = typeof opts.publicKey === 'string' ? decodePublicKey(opts.publicKey) : opts.publicKey;
  if (!key || key.length !== 32 || parsed.signature.length !== 64) return { ok: false, reason: 'INVALID_SIGNATURE', claims: parsed.claims };

  let valid = false;
  try {
    // zip215: false — RFC 8032 qat'iy tekshiruvi, Node/OpenSSL (server) bilan bir xil
    valid = ed.verify(parsed.signature, parsed.message, key, { zip215: false });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'INVALID_SIGNATURE', claims: parsed.claims };
  if (parsed.claims.m !== opts.matchId) return { ok: false, reason: 'WRONG_MATCH', claims: parsed.claims };
  if (parsed.claims.e * 1000 < (opts.now ?? Date.now())) return { ok: false, reason: 'EXPIRED', claims: parsed.claims };
  return { ok: true, claims: parsed.claims, token: parsed.token };
}
