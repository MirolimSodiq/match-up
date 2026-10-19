import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { type Locale, tr } from '../common/i18n';
import { money } from '../common/money';
import { DB, type Db, type Executor, iso, one, pgError, PG, rows } from '../db/db';
import { type Actor, audit } from './audit';
import { joinList } from './schemas';

export interface HostProfileInput {
  city_id: number;
  base_location?: { lat: number; lng: number } | null;
  max_travel_km?: number;
  has_kit?: boolean;
  kit_notes?: string | null;
  sports: string[];
}

export interface HostCreateInput extends HostProfileInput {
  phone: string;
  display_name?: string;
  approve?: boolean;
}

interface HostRow {
  user_id: string;
  display_name: string;
  phone: string | null;
  user_status: string;
  status: string;
  city_id: number;
  city_name: unknown;
  lat: number | null;
  lng: number | null;
  max_travel_km: number;
  has_kit: boolean;
  kit_notes: string | null;
  rating_avg: string | null;
  rating_count: number;
  completed_matches: number;
  no_show_count: number;
  verified_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  created_at: string;
  sports: string[];
  offers_total: number;
  accepted_total: number;
  declined_total: number;
  expired_total: number;
  upcoming: number;
  earned: number;
  currency: string;
  last_match_at: string | null;
  total?: number;
}

const point = (p: { lat: number; lng: number }) => sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;

/** Host ro'yxati: profil + dispatch statistikasi (offer'lar, qabul qilish, kelgusi o'yinlar, ishlab topgani). */
const HOST_SELECT = sql`
  SELECT hp.user_id, u.display_name, u.phone_e164 AS phone, u.status AS user_status, hp.status,
         hp.home_city_id AS city_id, c.name AS city_name, c.default_currency AS currency,
         ST_Y(hp.base_location::geometry) AS lat, ST_X(hp.base_location::geometry) AS lng,
         hp.max_travel_km, hp.has_kit, hp.kit_notes, hp.rating_avg, hp.rating_count, hp.completed_matches, hp.no_show_count,
         hp.verified_at, hp.suspended_at, hp.suspended_reason, hp.created_at,
         coalesce((SELECT array_agg(s.code ORDER BY s.id) FROM host_sports hs JOIN sports s ON s.id = hs.sport_id
                   WHERE hs.user_id = hp.user_id), '{}') AS sports,
         coalesce(st.offers_total, 0)::int AS offers_total, coalesce(st.accepted_total, 0)::int AS accepted_total,
         coalesce(st.declined_total, 0)::int AS declined_total, coalesce(st.expired_total, 0)::int AS expired_total,
         coalesce(st.upcoming, 0)::int AS upcoming, coalesce(st.earned, 0)::bigint AS earned, st.last_match_at
  FROM host_profiles hp
  JOIN users u ON u.id = hp.user_id
  JOIN cities c ON c.id = hp.home_city_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS offers_total,
           count(*) FILTER (WHERE ha.status IN ('accepted', 'arrived', 'completed', 'no_show')) AS accepted_total,
           count(*) FILTER (WHERE ha.status = 'declined') AS declined_total,
           count(*) FILTER (WHERE ha.status = 'expired') AS expired_total,
           count(*) FILTER (WHERE ha.status IN ('accepted', 'arrived') AND m.starts_at > now()) AS upcoming,
           sum(ha.fee_amount) FILTER (WHERE ha.status = 'completed') AS earned,
           max(m.starts_at) FILTER (WHERE ha.status IN ('accepted', 'arrived', 'completed')) AS last_match_at
    FROM host_assignments ha JOIN matches m ON m.id = ha.match_id
    WHERE ha.host_user_id = hp.user_id
  ) st ON true`;

@Injectable()
export class AdminHostsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private present(h: HostRow, locale: Locale) {
    const decided = h.accepted_total + h.declined_total + h.expired_total;
    return {
      user_id: h.user_id,
      display_name: h.display_name,
      phone: h.phone,
      user_status: h.user_status,
      status: h.status,
      city: { id: h.city_id, name: tr(h.city_name, locale) },
      base_location: h.lat === null || h.lng === null ? null : { lat: h.lat, lng: h.lng },
      max_travel_km: h.max_travel_km,
      has_kit: h.has_kit,
      kit_notes: h.kit_notes,
      sports: h.sports,
      rating: { avg: h.rating_avg === null ? null : Number(h.rating_avg), count: h.rating_count },
      verified_at: iso(h.verified_at),
      suspended_at: iso(h.suspended_at),
      suspended_reason: h.suspended_reason,
      created_at: iso(h.created_at),
      stats: {
        completed_matches: h.completed_matches,
        no_show_count: h.no_show_count,
        offers_total: h.offers_total,
        accepted_total: h.accepted_total,
        declined_total: h.declined_total,
        expired_total: h.expired_total,
        acceptance_rate: decided ? Math.round((h.accepted_total / decided) * 1000) / 1000 : null,
        upcoming_matches: h.upcoming,
        earned: money(h.earned, h.currency, locale),
        last_match_at: iso(h.last_match_at),
      },
    };
  }

  async list(f: { status?: string[]; city_id?: number; sport?: string; q?: string; limit: number; offset: number }, locale: Locale) {
    const conds: SQL[] = [sql`true`];
    if (f.status?.length) conds.push(sql`hp.status = ANY(string_to_array(${joinList(f.status)}, ',')::host_status[])`);
    if (f.city_id !== undefined) conds.push(sql`hp.home_city_id = ${f.city_id}`);
    if (f.sport) {
      conds.push(sql`EXISTS (SELECT 1 FROM host_sports hs JOIN sports s ON s.id = hs.sport_id WHERE hs.user_id = hp.user_id AND s.code = ${f.sport})`);
    }
    if (f.q) {
      const like = '%' + f.q.replace(/\s+/g, '') + '%';
      conds.push(sql`(u.display_name ILIKE ${'%' + f.q + '%'} OR u.phone_e164 LIKE ${like})`);
    }
    const list = await rows<HostRow>(
      this.db,
      sql`SELECT x.*, count(*) OVER ()::int AS total FROM (${HOST_SELECT} WHERE ${sql.join(conds, sql` AND `)}) x
          ORDER BY CASE x.status WHEN 'applicant' THEN 0 WHEN 'active' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END,
                   x.display_name, x.user_id
          LIMIT ${f.limit} OFFSET ${f.offset}`,
    );
    let total = list[0]?.total;
    if (total === undefined) {
      total = f.offset
        ? (await one<{ n: number }>(this.db, sql`SELECT count(*)::int AS n FROM (${HOST_SELECT} WHERE ${sql.join(conds, sql` AND `)}) x`))!.n
        : 0;
    }
    return { items: list.map((h) => this.present(h, locale)), total };
  }

  async get(userId: string, locale: Locale, ex: Executor = this.db) {
    const h = await one<HostRow>(ex, sql`${HOST_SELECT} WHERE hp.user_id = ${userId}`);
    if (!h) throw new AppError('NOT_FOUND');
    return this.present(h, locale);
  }

  private async sportIds(codes: string[], ex: Executor): Promise<number[]> {
    const found = await rows<{ id: number; code: string }>(
      ex,
      sql`SELECT id, code FROM sports WHERE code = ANY(string_to_array(${joinList(codes)}, ','))`,
    );
    const missing = codes.filter((c) => !found.some((s) => s.code === c));
    if (missing.length) {
      throw new AppError('VALIDATION_FAILED', {}, [{ field: 'sports', code: 'invalid', message: `Noma'lum sport turlari: ${missing.join(', ')}` }]);
    }
    return found.map((s) => s.id);
  }

  private async setSports(ex: Executor, userId: string, ids: number[]) {
    await ex.execute(sql`DELETE FROM host_sports WHERE user_id = ${userId}`);
    await ex.execute(
      sql`INSERT INTO host_sports (user_id, sport_id) SELECT ${userId}, unnest(string_to_array(${joinList(ids)}, ',')::smallint[])`,
    );
  }

  private async requireCity(cityId: number, ex: Executor) {
    if (!(await one(ex, sql`SELECT 1 FROM cities WHERE id = ${cityId}`))) {
      throw new AppError('VALIDATION_FAILED', {}, [{ field: 'city_id', code: 'invalid', message: 'Shahar topilmadi' }]);
    }
  }

  /**
   * Telefon raqami bo'yicha foydalanuvchini host qiladi: `host` roli + host_profiles + host_sports.
   * Foydalanuvchi hali ro'yxatdan o'tmagan bo'lsa — yaratiladi (Host ilovasiga shu raqam bilan OTP orqali kiradi).
   */
  async create(actor: Actor, input: HostCreateInput, locale: Locale) {
    let userId: string;
    try {
      userId = await this.db.transaction(async (tx) => {
        await this.requireCity(input.city_id, tx);
        const sports = await this.sportIds(input.sports, tx);
        let user = await one<{ id: string; status: string }>(tx, sql`SELECT id, status FROM users WHERE phone_e164 = ${input.phone}`);
        let created = false;
        if (!user) {
          const country = await one<{ code: string; data_region: string }>(
            tx,
            sql`SELECT code, data_region FROM countries WHERE ${input.phone} LIKE phone_prefix || '%'
                ORDER BY length(phone_prefix) DESC LIMIT 1`,
          );
          user = await one<{ id: string; status: string }>(
            tx,
            sql`INSERT INTO users (phone_e164, display_name, country_code, data_region, home_city_id)
                VALUES (${input.phone}, ${input.display_name ?? 'Host ' + input.phone.slice(-4)}, ${country?.code ?? 'UZ'},
                        ${country?.data_region ?? 'uz-1'}, ${input.city_id})
                RETURNING id, status`,
          );
          await tx.execute(sql`INSERT INTO user_roles (user_id, role, granted_by) VALUES (${user!.id}, 'player', ${actor.id})`);
          await tx.execute(sql`INSERT INTO auth_identities (user_id, provider, provider_uid) VALUES (${user!.id}, 'phone', ${input.phone})`);
          created = true;
        }
        if (user!.status !== 'active') throw new AppError('INVALID_STATE');
        await tx.execute(
          sql`INSERT INTO user_roles (user_id, role, granted_by) VALUES (${user!.id}, 'host', ${actor.id})
              ON CONFLICT (user_id, role) DO NOTHING`,
        );
        const approve = input.approve ?? false;
        await tx.execute(
          sql`INSERT INTO host_profiles (user_id, status, home_city_id, base_location, max_travel_km, has_kit, kit_notes,
                                         verified_at, verified_by)
              VALUES (${user!.id}, ${approve ? 'active' : 'applicant'}::host_status, ${input.city_id},
                      ${input.base_location ? point(input.base_location) : null}, ${input.max_travel_km ?? 10},
                      ${input.has_kit ?? false}, ${input.kit_notes ?? null},
                      ${approve ? sql`now()` : null}, ${approve ? actor.id : null})`,
        );
        await this.setSports(tx, user!.id, sports);
        await audit(tx, actor, 'host.create', 'user', user!.id, { ...input, user_created: created });
        return user!.id;
      });
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) {
        throw new AppError('ALREADY_EXISTS', {}, [{ field: 'phone', code: 'taken', message: 'Bu foydalanuvchi allaqachon host' }]);
      }
      throw err;
    }
    return this.get(userId, locale);
  }

  async update(actor: Actor, userId: string, input: Partial<HostProfileInput>, locale: Locale) {
    await this.db.transaction(async (tx) => {
      if (!(await one(tx, sql`SELECT 1 FROM host_profiles WHERE user_id = ${userId} FOR UPDATE`))) throw new AppError('NOT_FOUND');
      const sets: SQL[] = [];
      if (input.city_id !== undefined) {
        await this.requireCity(input.city_id, tx);
        sets.push(sql`home_city_id = ${input.city_id}`);
      }
      if (input.base_location !== undefined) sets.push(sql`base_location = ${input.base_location ? point(input.base_location) : null}`);
      if (input.max_travel_km !== undefined) sets.push(sql`max_travel_km = ${input.max_travel_km}`);
      if (input.has_kit !== undefined) sets.push(sql`has_kit = ${input.has_kit}`);
      if (input.kit_notes !== undefined) sets.push(sql`kit_notes = ${input.kit_notes}`);
      if (sets.length) await tx.execute(sql`UPDATE host_profiles SET ${sql.join(sets, sql`, `)} WHERE user_id = ${userId}`);
      if (input.sports !== undefined) await this.setSports(tx, userId, await this.sportIds(input.sports, tx));
      await audit(tx, actor, 'host.update', 'user', userId, input);
    });
    return this.get(userId, locale);
  }

  /** applicant/suspended -> active. Tasdiqlash vaqti va admin qayd etiladi. */
  async approve(actor: Actor, userId: string, locale: Locale) {
    await this.db.transaction(async (tx) => {
      const h = await one<{ status: string }>(tx, sql`SELECT status FROM host_profiles WHERE user_id = ${userId} FOR UPDATE`);
      if (!h) throw new AppError('NOT_FOUND');
      if (!['applicant', 'suspended'].includes(h.status)) throw new AppError('INVALID_STATE');
      await tx.execute(
        sql`UPDATE host_profiles
               SET status = 'active', verified_at = coalesce(verified_at, now()), verified_by = coalesce(verified_by, ${actor.id}),
                   suspended_at = NULL, suspended_reason = NULL
             WHERE user_id = ${userId}`,
      );
      await tx.execute(
        sql`INSERT INTO user_roles (user_id, role, granted_by) VALUES (${userId}, 'host', ${actor.id}) ON CONFLICT (user_id, role) DO NOTHING`,
      );
      await audit(tx, actor, 'host.approve', 'user', userId, { from: h.status });
    });
    return this.get(userId, locale);
  }

  /**
   * active/applicant -> suspended. Kutilayotgan offer'lar va kelgusi tayinlovlar bekor qilinadi —
   * dispatch o'sha match'lar uchun boshqa hostni qidiradi.
   */
  async suspend(actor: Actor, userId: string, reason: string, locale: Locale) {
    let cancelled = 0;
    await this.db.transaction(async (tx) => {
      const h = await one<{ status: string }>(tx, sql`SELECT status FROM host_profiles WHERE user_id = ${userId} FOR UPDATE`);
      if (!h) throw new AppError('NOT_FOUND');
      if (!['active', 'applicant'].includes(h.status)) throw new AppError('INVALID_STATE');
      await tx.execute(
        sql`UPDATE host_profiles SET status = 'suspended', suspended_at = now(), suspended_reason = ${reason} WHERE user_id = ${userId}`,
      );
      const res = await tx.execute(
        sql`UPDATE host_assignments ha SET status = 'cancelled'
            FROM matches m
            WHERE m.id = ha.match_id AND ha.host_user_id = ${userId}
              AND (ha.status = 'offered' OR (ha.status = 'accepted' AND m.starts_at > now()))`,
      );
      cancelled = res.rowCount ?? 0;
      await audit(tx, actor, 'host.suspend', 'user', userId, { from: h.status, reason, cancelled_assignments: cancelled });
    });
    return { ...(await this.get(userId, locale)), cancelled_assignments: cancelled };
  }
}
