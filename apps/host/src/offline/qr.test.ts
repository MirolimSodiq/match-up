import * as ed from '@noble/ed25519';
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/ticket.json';
import { base64UrlDecode, base64UrlEncode } from './base64url';
import { decodePublicKey, parseTicket, verifyTicket } from './qr';

/** Fixture'dagi chipta hali amal qiladigan payt (muddatdan 1 soat oldin). */
const BEFORE_EXP = fixture.exp * 1000 - 3_600_000;
const opts = { publicKey: fixture.public_key, matchId: fixture.match_id, now: BEFORE_EXP };

const enc = (s: string) => base64UrlEncode(new TextEncoder().encode(s));
const [prefix, body, sig] = fixture.qr_payload.split('.') as [string, string, string];

/** `signCompact` (backend) bilan bir xil: `<prefix>.<b64url(json)>.<b64url(sig("prefix.body"))>`. */
function signCompact(data: object, secretKey: Uint8Array, p = 'mu1') {
  const b = enc(JSON.stringify(data));
  const s = ed.sign(new TextEncoder().encode(`${p}.${b}`), secretKey);
  return `${p}.${b}.${base64UrlEncode(s)}`;
}

describe('backend chiptasi (GET /v1/bookings/{id}/ticket)', () => {
  it("to'g'ri imzo, match va muddat — qabul qilinadi", () => {
    const r = verifyTicket(fixture.qr_payload, opts);
    expect(r).toEqual({
      ok: true,
      token: fixture.qr_payload,
      claims: { p: fixture.participant_id, m: fixture.match_id, e: fixture.exp },
    });
  });

  it("skanerdan kelgan bo'sh joy/yangi qator e'tiborsiz", () => {
    expect(verifyTicket(`  ${fixture.qr_payload}\n`, opts).ok).toBe(true);
  });

  it('public key — raw 32 bayt (base64url)', () => {
    expect(decodePublicKey(fixture.public_key)).toHaveLength(32);
    expect(decodePublicKey(fixture.public_key.slice(0, -4))).toBeNull();
  });

  it('muddat chegarasi server bilan bir xil: `e * 1000 < now` — eskirgan', () => {
    expect(verifyTicket(fixture.qr_payload, { ...opts, now: fixture.exp * 1000 }).ok).toBe(true);
    expect(verifyTicket(fixture.qr_payload, { ...opts, now: fixture.exp * 1000 + 1 })).toMatchObject({ ok: false, reason: 'EXPIRED' });
  });

  it("boshqa o'yin chiptasi — WRONG_MATCH (claims bilan)", () => {
    const r = verifyTicket(fixture.qr_payload, { ...opts, matchId: '01a15444-0000-7000-8000-000000000000' });
    expect(r).toMatchObject({ ok: false, reason: 'WRONG_MATCH', claims: { p: fixture.participant_id } });
  });
});

describe('soxta va buzilgan chiptalar', () => {
  it("payload o'zgartirilsa (boshqa participant) — INVALID_SIGNATURE", () => {
    const forged = enc(JSON.stringify({ p: '01a15444-ffff-7fff-bfff-ffffffffffff', m: fixture.match_id, e: fixture.exp }));
    expect(verifyTicket(`${prefix}.${forged}.${sig}`, opts)).toMatchObject({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it("muddat uzaytirilsa — INVALID_SIGNATURE (EXPIRED emas: imzo birinchi tekshiriladi)", () => {
    const forged = enc(JSON.stringify({ p: fixture.participant_id, m: fixture.match_id, e: fixture.exp + 86_400 }));
    const r = verifyTicket(`${prefix}.${forged}.${sig}`, { ...opts, now: fixture.exp * 1000 + 1 });
    expect(r).toMatchObject({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it("imzoning bitta bayti o'zgarsa — INVALID_SIGNATURE", () => {
    const bytes = base64UrlDecode(sig)!;
    bytes[10] = bytes[10]! ^ 0x01;
    expect(verifyTicket(`${prefix}.${body}.${base64UrlEncode(bytes)}`, opts)).toMatchObject({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it('boshqa kalit bilan imzolangan (to‘g‘ri formatda) — INVALID_SIGNATURE', () => {
    const { secretKey } = ed.keygen();
    const token = signCompact({ p: fixture.participant_id, m: fixture.match_id, e: fixture.exp }, secretKey);
    expect(verifyTicket(token, opts)).toMatchObject({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it("o'z kalitimiz bilan imzolangan chipta shu kalit bilan qabul qilinadi (xabar formati mos)", () => {
    const { secretKey, publicKey } = ed.keygen();
    const token = signCompact({ p: 'p-1', m: 'm-1', e: 2_000_000_000 }, secretKey);
    expect(verifyTicket(token, { publicKey: base64UrlEncode(publicKey), matchId: 'm-1', now: 0 })).toMatchObject({ ok: true, claims: { p: 'p-1' } });
  });

  it('noto‘g‘ri public key — INVALID_SIGNATURE', () => {
    expect(verifyTicket(fixture.qr_payload, { ...opts, publicKey: 'abc' })).toMatchObject({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it.each([
    ['bo‘sh', ''],
    ['oddiy matn', 'hello world'],
    ['URL', 'https://matchup.uz/t/123'],
    ['boshqa prefiks', `mu2.${body}.${sig}`],
    ["ikki bo'lak", `${prefix}.${body}`],
    ["to'rt bo'lak", `${fixture.qr_payload}.x`],
    ['base64url emas', `${prefix}.!!!.${sig}`],
    ['JSON emas', `${prefix}.${enc('not json')}.${sig}`],
    ["maydonlar yo'q", `${prefix}.${enc('{"p":"x"}')}.${sig}`],
    ['e — son emas', `${prefix}.${enc('{"p":"x","m":"y","e":"1"}')}.${sig}`],
  ])('format buzilgan (%s) — MALFORMED', (_, token) => {
    expect(verifyTicket(token, opts)).toEqual({ ok: false, reason: 'MALFORMED' });
  });
});

describe('base64url', () => {
  it('backend (Node `base64url`) bilan mos: decode -> encode', () => {
    expect(base64UrlEncode(base64UrlDecode(body)!)).toBe(body);
    expect(base64UrlEncode(base64UrlDecode(sig)!)).toBe(sig);
    expect(base64UrlDecode(sig)).toHaveLength(64);
  });

  it("noto'g'ri belgi yoki uzunlik — null", () => {
    expect(base64UrlDecode('ab+c')).toBeNull();
    expect(base64UrlDecode('abcde')).toBeNull();
  });

  it('parseTicket JSON claims qaytaradi', () => {
    expect(parseTicket(fixture.qr_payload)?.claims).toEqual({ p: fixture.participant_id, m: fixture.match_id, e: fixture.exp });
  });
});
