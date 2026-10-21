import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SIGNING_KEYS, type SigningKeys } from '../config/keys';

export type MediaTokenPurpose = 'playback' | 'share';

const MAC_BYTES = 16;

/**
 * Qisqa imzolangan URL token'lari (48 belgi): base64url(uuid[16] ‖ exp[4] ‖ HMAC-SHA256[16]).
 *  - `playback` — HLS playlist'larini ochish (AVPlayer/ExoPlayer Authorization header yubormaydi);
 *  - `share`    — ochiq ulashish havolasi (`/h/{token}`), `highlight_shares` qatoriga bog'liq.
 * Kalit JWT imzo kalitidan HKDF bilan olinadi — alohida secret shart emas, barcha API instance'lari bir xil
 * kalitga ega. JWT kaliti almashtirilsa, faol havolalar yaroqsiz bo'ladi (ular baribir muddatli).
 */
@Injectable()
export class MediaTokens {
  private readonly key: Buffer;

  constructor(@Inject(SIGNING_KEYS) keys: SigningKeys) {
    const ikm = keys.jwt.privateKey.export({ format: 'der', type: 'pkcs8' });
    this.key = Buffer.from(hkdfSync('sha256', ikm, 'matchup', 'media-url-tokens/v1', 32));
  }

  sign(purpose: MediaTokenPurpose, id: string, expiresAt: number): string {
    const body = Buffer.alloc(20);
    Buffer.from(id.replace(/-/g, ''), 'hex').copy(body, 0);
    body.writeUInt32BE(expiresAt, 16);
    return Buffer.concat([body, this.mac(purpose, body)]).toString('base64url');
  }

  /** Imzo va muddat to'g'ri bo'lsa — `{ id, expiresAt }`. */
  verify(purpose: MediaTokenPurpose, token: string): { id: string; expiresAt: number } | undefined {
    if (!/^[A-Za-z0-9_-]{48}$/.test(token)) return undefined;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length !== 20 + MAC_BYTES) return undefined;
    const body = raw.subarray(0, 20);
    if (!timingSafeEqual(raw.subarray(20), this.mac(purpose, body))) return undefined;
    const expiresAt = body.readUInt32BE(16);
    if (expiresAt <= Math.floor(Date.now() / 1000)) return undefined;
    const hex = body.subarray(0, 16).toString('hex');
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return { id, expiresAt };
  }

  private mac(purpose: MediaTokenPurpose, body: Buffer): Buffer {
    return createHmac('sha256', this.key).update(purpose).update(body).digest().subarray(0, MAC_BYTES);
  }
}
