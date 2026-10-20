import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { type Actor, audit } from '../../admin/audit';
import { ENV, type Env } from '../../config/env';
import { AppError } from '../../common/errors';
import { DB, type Db, iso, one, pgError, PG, rows } from '../../db/db';
import { REDIS } from '../../redis/redis.module';
import type { SocialIdentity, SocialProvider } from '../users.service';
import { IdTokenRejected, verifyIdToken } from './id-token';
import { JwksCache } from './jwks';
import { verifyTelegramAuth } from './telegram';

const IdTokenFields = {
  id_token: z.string().min(20).max(8192),
  /** Xom nonce (provider'ga SHA-256 yoki aynan shu qiymat berilgan). */
  nonce: z.string().min(8).max(512).optional(),
};
const NameHint = z.object({
  first_name: z.string().trim().max(60).optional(),
  last_name: z.string().trim().max(60).optional(),
});

/** Google / Apple ID token yoki Telegram Login ma'lumotlari. */
export const SocialCredential = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('google'), ...IdTokenFields }),
  // Apple ismni token'da bermaydi — faqat birinchi kirishda client'ga (credential.fullName)
  z.object({ provider: z.literal('apple'), ...IdTokenFields, profile: NameHint.optional() }),
  z.object({
    provider: z.literal('telegram'),
    telegram_auth: z
      .record(z.string().max(64), z.union([z.string().max(2048), z.number()]))
      .refine((o) => Object.keys(o).length <= 20, 'Juda ko\'p maydon'),
  }),
]);
export type SocialCredential = z.infer<typeof SocialCredential>;

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const APPLE_ISSUERS = ['https://appleid.apple.com'];

export interface IdentityView {
  provider: 'phone' | SocialProvider;
  label: string | null;
  created_at: string | null;
  last_used_at: string | null;
}

@Injectable()
export class SocialAuthService {
  private readonly log = new Logger('SocialAuth');
  readonly jwks: JwksCache;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: Db,
  ) {
    this.jwks = new JwksCache({ defaultTtlSec: env.JWKS_CACHE_TTL_SEC });
  }

  /** Imzo/hash, iss, aud, muddat va nonce tekshiruvi; token bir martalik (replay himoyasi). */
  async verify(c: SocialCredential): Promise<SocialIdentity> {
    try {
      const { identity, credential, validForSec } = await this.verifyCredential(c);
      // Bir martalik: tutib olingan token'ni amal qilish muddati ichida qayta ishlatib bo'lmaydi
      const key = `social:used:${c.provider}:${createHash('sha256').update(credential).digest('base64url')}`;
      const fresh = await this.redis.set(key, '1', 'EX', Math.max(validForSec, 60), 'NX');
      if (!fresh) throw new IdTokenRejected('qayta ishlatilgan');
      return identity;
    } catch (err) {
      if (err instanceof IdTokenRejected) {
        this.log.warn(`${c.provider} kirish rad etildi: ${err.message}`);
        throw new AppError('SOCIAL_TOKEN_INVALID');
      }
      throw err;
    }
  }

  private async verifyCredential(c: SocialCredential): Promise<{ identity: SocialIdentity; credential: string; validForSec: number }> {
    const now = Math.floor(Date.now() / 1000);
    if (c.provider === 'telegram') {
      if (!this.env.TELEGRAM_BOT_TOKEN) throw new AppError('SOCIAL_PROVIDER_DISABLED');
      const tg = verifyTelegramAuth(c.telegram_auth, this.env.TELEGRAM_BOT_TOKEN, this.env.TELEGRAM_AUTH_MAX_AGE_SEC, now);
      return {
        identity: {
          provider: 'telegram',
          uid: tg.id,
          label: tg.username ? `@${tg.username}` : null,
          firstName: tg.firstName,
          lastName: tg.lastName,
        },
        credential: String(c.telegram_auth.hash),
        validForSec: tg.authDate + this.env.TELEGRAM_AUTH_MAX_AGE_SEC - now,
      };
    }

    const google = c.provider === 'google';
    const audiences = google ? this.env.GOOGLE_CLIENT_IDS : this.env.APPLE_CLIENT_IDS;
    if (!audiences.length) throw new AppError('SOCIAL_PROVIDER_DISABLED');
    const claims = await verifyIdToken(c.id_token, this.jwks, {
      jwksUrl: google ? this.env.GOOGLE_JWKS_URL : this.env.APPLE_JWKS_URL,
      issuers: google ? GOOGLE_ISSUERS : APPLE_ISSUERS,
      audiences,
      nonce: c.nonce,
      now,
    });
    const email = typeof claims.email === 'string' ? claims.email.slice(0, 254) : null;
    const hint = c.provider === 'apple' ? c.profile : undefined;
    return {
      identity: {
        provider: c.provider,
        uid: claims.sub,
        label: email,
        firstName: hint?.first_name || (typeof claims.given_name === 'string' ? claims.given_name : undefined),
        lastName: hint?.last_name || (typeof claims.family_name === 'string' ? claims.family_name : undefined),
        displayName: typeof claims.name === 'string' ? claims.name : undefined,
      },
      credential: c.id_token,
      validForSec: claims.exp - now,
    };
  }

  // -------------------------------------------------------------------------
  // Kirgan foydalanuvchining identity'lari
  // -------------------------------------------------------------------------
  async list(userId: string): Promise<IdentityView[]> {
    const list = await rows<{ provider: IdentityView['provider']; label: string | null; created_at: string; last_used_at: string | null }>(
      this.db,
      sql`SELECT provider, CASE WHEN provider = 'phone' THEN provider_uid ELSE display_label END AS label, created_at, last_used_at
          FROM auth_identities WHERE user_id = ${userId} ORDER BY created_at, provider`,
    );
    return list.map((i) => ({ provider: i.provider, label: i.label, created_at: iso(i.created_at), last_used_at: iso(i.last_used_at) }));
  }

  /**
   * Social identity'ni joriy akkauntga bog'lash. Boshqa akkauntga bog'langan bo'lsa — IDENTITY_IN_USE
   * (birlashtirish yo'q); shu provider'dan boshqa identity bog'langan bo'lsa — ALREADY_EXISTS.
   */
  async link(actor: Actor, credential: SocialCredential): Promise<IdentityView[]> {
    const identity = await this.verify(credential);
    try {
      await this.db.transaction(async (tx) => {
        // Bir user'ning parallel link/unlink so'rovlari navbatga turadi
        await tx.execute(sql`SELECT 1 FROM users WHERE id = ${actor.id} FOR UPDATE`);
        const owner = await one<{ user_id: string }>(
          tx,
          sql`SELECT user_id FROM auth_identities WHERE provider = ${identity.provider} AND provider_uid = ${identity.uid}`,
        );
        if (owner && owner.user_id !== actor.id) throw new AppError('IDENTITY_IN_USE');
        if (owner) {
          await tx.execute(
            sql`UPDATE auth_identities SET display_label = coalesce(${identity.label}, display_label)
                WHERE provider = ${identity.provider} AND provider_uid = ${identity.uid}`,
          );
          return;
        }
        const same = await one(tx, sql`SELECT 1 FROM auth_identities WHERE user_id = ${actor.id} AND provider = ${identity.provider}`);
        if (same) throw new AppError('ALREADY_EXISTS');
        await tx.execute(
          sql`INSERT INTO auth_identities (user_id, provider, provider_uid, display_label)
              VALUES (${actor.id}, ${identity.provider}, ${identity.uid}, ${identity.label})`,
        );
        await audit(tx, actor, 'identity.link', 'user', actor.id, { provider: identity.provider }, 'player');
      });
    } catch (err) {
      const pg = pgError(err);
      if (pg?.code === PG.UNIQUE_VIOLATION) {
        throw new AppError(pg.constraint === 'auth_identities_user_provider_key' ? 'ALREADY_EXISTS' : 'IDENTITY_IN_USE');
      }
      throw err;
    }
    return this.list(actor.id);
  }

  /** Social identity'ni uzish. Oxirgi kirish usulini uzib bo'lmaydi (akkaunt yetim qoladi). */
  async unlink(actor: Actor, provider: SocialProvider): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM users WHERE id = ${actor.id} FOR UPDATE`);
      const all = await rows<{ provider: string }>(tx, sql`SELECT provider FROM auth_identities WHERE user_id = ${actor.id}`);
      if (!all.some((i) => i.provider === provider)) throw new AppError('NOT_FOUND');
      if (all.length <= 1) throw new AppError('LAST_LOGIN_METHOD');
      await tx.execute(sql`DELETE FROM auth_identities WHERE user_id = ${actor.id} AND provider = ${provider}`);
      await audit(tx, actor, 'identity.unlink', 'user', actor.id, { provider }, 'player');
    });
  }
}
