import { createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { AppError } from '../../common/errors';

export interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

export interface ResolvedKey {
  key: KeyObject;
  jwk: Jwk;
}

interface Entry {
  keys: Map<string, ResolvedKey>;
  fetchedAt: number;
  expiresAt: number;
}

export interface JwksCacheOptions {
  /** Cache-Control max-age bo'lmasa (soniya). */
  defaultTtlSec: number;
  /** Noma'lum `kid` uchun qayta yuklashlar orasidagi minimal oraliq — tasodifiy kid bilan DoS'ning oldini oladi. */
  missCooldownSec?: number;
  timeoutMs?: number;
  now?: () => number;
}

const MIN_TTL_SEC = 60;
const MAX_TTL_SEC = 86_400;

/**
 * JWKS kesh (Google / Apple). Kalitlar TTL bilan saqlanadi; token'dagi `kid` keshda bo'lmasa
 * (provider kalitni almashtirgan) bir marta qayta yuklanadi. Provider vaqtincha ishlamasa —
 * eskirgan kesh ishlatiladi, kesh umuman bo'lmasa UPSTREAM_UNAVAILABLE.
 */
export class JwksCache {
  private readonly log = new Logger('JwksCache');
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Entry>>();
  private readonly lastMissRefetch = new Map<string, number>();
  /** Test va monitoring uchun: URL bo'yicha HTTP so'rovlar soni. */
  readonly fetchCount = new Map<string, number>();

  constructor(private readonly opts: JwksCacheOptions) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  async getKey(url: string, kid: string): Promise<ResolvedKey | undefined> {
    let entry = this.entries.get(url);
    let fresh = false;
    if (!entry || entry.expiresAt <= this.now()) {
      entry = await this.refresh(url, entry);
      fresh = true;
    }
    const found = entry.keys.get(kid);
    if (found || fresh) return found;

    // Kalit almashtirilgan bo'lishi mumkin — bir marta qayta yuklaymiz (cooldown bilan)
    const cooldownMs = (this.opts.missCooldownSec ?? 30) * 1000;
    const last = this.lastMissRefetch.get(url);
    if (last !== undefined && this.now() - last < cooldownMs) return undefined;
    this.lastMissRefetch.set(url, this.now());
    entry = await this.refresh(url, entry);
    return entry.keys.get(kid);
  }

  private async refresh(url: string, stale: Entry | undefined): Promise<Entry> {
    const pending = this.inflight.get(url);
    if (pending) return pending;
    const p = this.fetchKeys(url)
      .then((entry) => {
        this.entries.set(url, entry);
        return entry;
      })
      .catch((err: unknown) => {
        if (stale) {
          this.log.warn(`JWKS yangilanmadi (${url}): ${(err as Error).message} — eski kesh ishlatiladi`);
          return stale;
        }
        this.log.error(`JWKS yuklanmadi (${url}): ${(err as Error).message}`);
        throw new AppError('UPSTREAM_UNAVAILABLE');
      })
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, p);
    return p;
  }

  private async fetchKeys(url: string): Promise<Entry> {
    this.fetchCount.set(url, (this.fetchCount.get(url) ?? 0) + 1);
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error('keys massivi yo\'q');

    const keys = new Map<string, ResolvedKey>();
    for (const jwk of body.keys as Jwk[]) {
      if (typeof jwk?.kid !== 'string' || (jwk.use && jwk.use !== 'sig')) continue;
      if (jwk.kty !== 'RSA' && jwk.kty !== 'EC') continue;
      try {
        keys.set(jwk.kid, { key: createPublicKey({ key: jwk, format: 'jwk' }), jwk });
      } catch {
        this.log.warn(`JWKS: yaroqsiz kalit o'tkazib yuborildi (kid=${jwk.kid})`);
      }
    }
    const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
    const ttlSec = maxAge ? Math.min(Math.max(Number(maxAge), MIN_TTL_SEC), MAX_TTL_SEC) : this.opts.defaultTtlSec;
    const now = this.now();
    return { keys, fetchedAt: now, expiresAt: now + ttlSec * 1000 };
  }
}
