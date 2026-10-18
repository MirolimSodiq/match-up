import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import type { Locale } from '../common/i18n';
import type { UserRole } from '../common/http';
import { DB, type Db, type Executor, one, rows } from '../db/db';

export interface UserRow {
  id: string;
  phone_e164: string | null;
  email: string | null;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  gender: 'male' | 'female' | 'other' | 'undisclosed';
  locale: string;
  country_code: string;
  home_city_id: number | null;
  status: 'active' | 'suspended' | 'deleted';
  onboarded_at: string | null;
}

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async get(id: string, ex: Executor = this.db): Promise<UserRow> {
    const u = await one<UserRow>(
      ex,
      sql`SELECT id, phone_e164, email::text AS email, display_name, first_name, last_name, birth_date, gender,
                 locale, country_code, home_city_id, status, onboarded_at
          FROM users WHERE id = ${id} AND deleted_at IS NULL`,
    );
    if (!u) throw new AppError('NOT_FOUND');
    return u;
  }

  /** Telefon bo'yicha topadi yoki yangi player yaratadi (davlat — telefon prefiksidan). */
  async findOrCreateByPhone(phone: string, locale: Locale): Promise<{ user: UserRow; isNew: boolean }> {
    return this.db.transaction(async (tx) => {
      const existing = await one<{ user_id: string }>(
        tx,
        sql`SELECT user_id FROM auth_identities WHERE provider = 'phone' AND provider_uid = ${phone}`,
      );
      if (existing) {
        await tx.execute(
          sql`UPDATE auth_identities SET last_used_at = now() WHERE provider = 'phone' AND provider_uid = ${phone}`,
        );
        const user = await this.get(existing.user_id, tx);
        if (user.status !== 'active') throw new AppError('FORBIDDEN');
        return { user, isNew: false };
      }

      const country = await one<{ code: string; data_region: string }>(
        tx,
        sql`SELECT code, data_region FROM countries
            WHERE ${phone} LIKE phone_prefix || '%'
            ORDER BY length(phone_prefix) DESC LIMIT 1`,
      );
      const created = await one<{ id: string }>(
        tx,
        sql`INSERT INTO users (phone_e164, display_name, country_code, data_region, locale)
            VALUES (${phone}, ${'Player ' + phone.slice(-4)}, ${country?.code ?? 'UZ'}, ${country?.data_region ?? 'uz-1'}, ${locale})
            ON CONFLICT (phone_e164) DO NOTHING
            RETURNING id`,
      );
      // Parallel ro'yxatdan o'tish: boshqa so'rov allaqachon yaratgan bo'lsa
      const userId = created?.id ?? (await one<{ id: string }>(tx, sql`SELECT id FROM users WHERE phone_e164 = ${phone}`))!.id;
      if (created) {
        await tx.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${userId}, 'player')`);
      }
      await tx.execute(
        sql`INSERT INTO auth_identities (user_id, provider, provider_uid, last_used_at)
            VALUES (${userId}, 'phone', ${phone}, now())
            ON CONFLICT (provider, provider_uid) DO NOTHING`,
      );
      return { user: await this.get(userId, tx), isNew: !!created };
    });
  }

  async profile(id: string) {
    const u = await this.get(id);
    const roles = await rows<{ role: UserRole }>(this.db, sql`SELECT role FROM user_roles WHERE user_id = ${id} ORDER BY role`);
    const sports = await rows<{
      sport: string;
      self_level: string;
      rating: string;
      games_played: number;
      no_show_count: number;
      preferred_position: string | null;
    }>(
      this.db,
      sql`SELECT s.code AS sport, p.self_level, p.rating, p.games_played, p.no_show_count, p.preferred_position
          FROM player_sport_profiles p JOIN sports s ON s.id = p.sport_id
          WHERE p.user_id = ${id} ORDER BY s.code`,
    );
    return {
      id: u.id,
      display_name: u.display_name,
      phone: u.phone_e164,
      email: u.email,
      avatar_url: null,
      roles: roles.map((r) => r.role),
      locale: u.locale,
      country_code: u.country_code,
      home_city_id: u.home_city_id,
      birth_date: u.birth_date,
      gender: u.gender,
      sports: sports.map((s) => ({
        sport: s.sport,
        self_level: s.self_level,
        rating: Number(s.rating),
        games_played: s.games_played,
        preferred_position: s.preferred_position,
      })),
      stats: {
        games_played: sports.reduce((a, s) => a + s.games_played, 0),
        no_show_count: sports.reduce((a, s) => a + s.no_show_count, 0),
      },
      onboarded: u.onboarded_at !== null,
    };
  }

  /** Yoshni hisoblash (birth_date bo'lmasa undefined). */
  static ageAt(birthDate: string | null, at: Date): number | undefined {
    if (!birthDate) return undefined;
    const b = new Date(`${birthDate}T00:00:00Z`);
    let age = at.getUTCFullYear() - b.getUTCFullYear();
    const m = at.getUTCMonth() - b.getUTCMonth();
    if (m < 0 || (m === 0 && at.getUTCDate() < b.getUTCDate())) age--;
    return age;
  }
}
