import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { SIGNING_KEYS, type SigningKeys } from '../config/keys';
import { AppError } from '../common/errors';
import { signJwt, verifyJwt } from '../common/jwt';
import type { AuthUser, UserRole } from '../common/http';
import { DB, type Db, one, rows } from '../db/db';

const ISSUER = 'matchup';
const AUDIENCE = 'matchup-app';

export interface DeviceMeta {
  device_id?: string;
  platform?: 'ios' | 'android' | 'web';
  app_version?: string;
  ip?: string;
  user_agent?: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export interface AccessClaims extends AuthUser {
  sessionFamily: string;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest();

@Injectable()
export class TokensService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SIGNING_KEYS) private readonly keys: SigningKeys,
    @Inject(DB) private readonly db: Db,
  ) {}

  async signAccess(user: AuthUser, sessionFamily: string): Promise<string> {
    return signJwt(
      { sub: user.id, iss: ISSUER, aud: AUDIENCE, roles: user.roles, sid: sessionFamily },
      this.env.ACCESS_TOKEN_TTL_SEC,
      this.keys.jwt.privateKey,
    );
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const payload = verifyJwt(token, this.keys.jwt.publicKey, { iss: ISSUER, aud: AUDIENCE });
      if (!payload.sub || !Array.isArray(payload.roles) || typeof payload.sid !== 'string') throw new Error('claims');
      return { id: payload.sub, roles: payload.roles as UserRole[], sessionFamily: payload.sid };
    } catch {
      throw new AppError('UNAUTHORIZED');
    }
  }

  async loadRoles(userId: string): Promise<UserRole[]> {
    const r = await rows<{ role: UserRole }>(this.db, sql`SELECT role FROM user_roles WHERE user_id = ${userId} ORDER BY role`);
    return r.map((x) => x.role);
  }

  /** Yangi sessiya (login) yoki mavjud family ichida yangi refresh token (rotation). */
  async issue(userId: string, meta: DeviceMeta, family?: string): Promise<TokenPair> {
    const refresh = randomBytes(32).toString('base64url');
    const ttlDays = this.env.REFRESH_TOKEN_TTL_DAYS;
    const session = await one<{ family_id: string }>(
      this.db,
      sql`INSERT INTO user_sessions (user_id, family_id, refresh_token_hash, device_id, platform, app_version, ip, user_agent, expires_at)
          VALUES (${userId}, coalesce(${family ?? null}::uuid, uuidv7()), ${sha256(refresh)}, ${meta.device_id ?? null},
                  ${meta.platform ?? null}, ${meta.app_version ?? null}, ${meta.ip ?? null}::inet, ${meta.user_agent ?? null},
                  now() + make_interval(days => ${ttlDays}))
          RETURNING family_id`,
    );
    const roles = await this.loadRoles(userId);
    return {
      access_token: await this.signAccess({ id: userId, roles }, session!.family_id),
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: this.env.ACCESS_TOKEN_TTL_SEC,
    };
  }

  /**
   * Refresh token rotation. Eski (allaqachon almashtirilgan) token qayta kelsa — bu o'g'irlik
   * belgisi: butun family bekor qilinadi va TOKEN_REUSED qaytariladi.
   */
  async rotate(refreshToken: string, meta: DeviceMeta): Promise<TokenPair> {
    const outcome = await this.db.transaction(async (tx) => {
      const s = await one<{ id: string; user_id: string; family_id: string; revoked_at: string | null; expired: boolean; status: string }>(
        tx,
        sql`SELECT s.id, s.user_id, s.family_id, s.revoked_at, s.expires_at < now() AS expired, u.status
            FROM user_sessions s JOIN users u ON u.id = s.user_id
            WHERE s.refresh_token_hash = ${sha256(refreshToken)}
            FOR UPDATE OF s`,
      );
      if (!s) return { kind: 'invalid' as const };
      if (s.revoked_at) {
        await tx.execute(
          sql`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'reuse_detected'
              WHERE family_id = ${s.family_id} AND revoked_at IS NULL`,
        );
        return { kind: 'reused' as const };
      }
      if (s.expired || s.status !== 'active') return { kind: 'invalid' as const };
      await tx.execute(
        sql`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'rotated', last_used_at = now() WHERE id = ${s.id}`,
      );
      return { kind: 'ok' as const, userId: s.user_id, family: s.family_id };
    });
    if (outcome.kind === 'reused') throw new AppError('TOKEN_REUSED');
    if (outcome.kind === 'invalid') throw new AppError('UNAUTHORIZED');
    return this.issue(outcome.userId, meta, outcome.family);
  }

  async revokeFamily(family: string, reason = 'logout'): Promise<void> {
    await this.db.execute(
      sql`UPDATE user_sessions SET revoked_at = now(), revoked_reason = ${reason}
          WHERE family_id = ${family} AND revoked_at IS NULL`,
    );
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE user_sessions SET revoked_at = now(), revoked_reason = ${reason} WHERE user_id = ${userId} AND revoked_at IS NULL`,
    );
  }
}
