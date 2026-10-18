import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { decodeCursor, encodeCursor } from '../common/http';
import { type Locale, tr } from '../common/i18n';
import { money } from '../common/money';
import { DB, type Db, type Executor, iso, one, pgError, PG, rows } from '../db/db';
import { type PolicyRule, policySummary } from '../bookings/policy';

/** Match summary uchun umumiy SELECT ro'yxati (m, s, v aliaslari bilan). */
export const MATCH_SUMMARY_COLUMNS = sql`
  m.id, m.public_code, s.code AS sport, m.title, m.starts_at, m.ends_at, v.timezone, m.format,
  m.price_amount, m.currency, m.max_players, m.min_players, m.held_slots, m.confirmed_slots,
  m.skill_min, m.skill_max, m.gender_policy, m.status,
  EXISTS (SELECT 1 FROM host_assignments ha
          WHERE ha.match_id = m.id AND ha.status IN ('accepted', 'arrived', 'completed')) AS host_assigned,
  v.id AS venue_id, v.name AS venue_name, v.address AS venue_address,
  ST_Y(v.location::geometry) AS venue_lat, ST_X(v.location::geometry) AS venue_lng`;

export const MATCH_JOINS = sql`
  JOIN sports s ON s.id = m.sport_id
  JOIN pitches p ON p.id = m.pitch_id
  JOIN venues v ON v.id = p.venue_id`;

export interface MatchSummaryRow {
  id: string;
  public_code: string;
  sport: string;
  title: unknown;
  starts_at: string;
  ends_at: string;
  timezone: string;
  format: string;
  price_amount: number;
  currency: string;
  max_players: number;
  min_players: number;
  held_slots: number;
  confirmed_slots: number;
  skill_min: string | null;
  skill_max: string | null;
  gender_policy: string;
  status: string;
  host_assigned: boolean;
  venue_id: string;
  venue_name: string;
  venue_address: unknown;
  venue_lat: number;
  venue_lng: number;
  distance_m?: number | null;
}

export function toMatchSummary(r: MatchSummaryRow, locale: Locale) {
  const taken = r.held_slots + r.confirmed_slots;
  return {
    id: r.id,
    public_code: r.public_code,
    sport: r.sport,
    title: tr(r.title, locale),
    starts_at: iso(r.starts_at),
    ends_at: iso(r.ends_at),
    timezone: r.timezone,
    format: r.format,
    price: money(r.price_amount, r.currency, locale),
    slots: { max: r.max_players, min_to_play: r.min_players, taken, available: Math.max(r.max_players - taken, 0) },
    level: { min: r.skill_min, max: r.skill_max },
    gender_policy: r.gender_policy,
    status: r.status,
    host_assigned: r.host_assigned,
    venue: {
      id: r.venue_id,
      name: r.venue_name,
      address: tr(r.venue_address, locale),
      location: { lat: r.venue_lat, lng: r.venue_lng },
      distance_m: r.distance_m === undefined || r.distance_m === null ? null : Math.round(Number(r.distance_m)),
    },
  };
}

export interface SearchParams {
  lat: number;
  lng: number;
  radius_km: number;
  sport?: string[];
  date_from?: string;
  date_to?: string;
  min_slots: number;
  price_max?: number;
  level?: string;
  sort: 'starts_at' | 'distance';
  cursor?: string;
  limit: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MatchesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** db/queries/discovery.sql bilan bir xil mantiq: partial GiST (location, starts_at) index'iga mos predikat. */
  async search(p: SearchParams, locale: Locale) {
    const ref = sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;
    const distance = sql`ST_Distance(m.location, ${ref})`;
    const conds: SQL[] = [
      sql`m.status IN ('open', 'full')`,
      sql`m.visibility = 'public'`,
      sql`ST_DWithin(m.location, ${ref}, ${p.radius_km * 1000})`,
      sql`m.starts_at >= coalesce(${p.date_from ?? null}::timestamptz, now())`,
      sql`m.starts_at < coalesce(${p.date_to ?? null}::timestamptz, now() + interval '14 days')`,
      sql`m.max_players - m.held_slots - m.confirmed_slots >= ${p.min_slots}`,
    ];
    // drizzle JS massivni ($1, $2) ro'yxatga yoyadi — shuning uchun bitta qator sifatida uzatamiz
    if (p.sport?.length) conds.push(sql`s.code = ANY(string_to_array(${p.sport.join(',')}, ','))`);
    if (p.price_max !== undefined) conds.push(sql`m.price_amount <= ${p.price_max}`);
    if (p.level) {
      conds.push(sql`(m.skill_min IS NULL OR m.skill_min <= ${p.level}::skill_level)`);
      conds.push(sql`(m.skill_max IS NULL OR m.skill_max >= ${p.level}::skill_level)`);
    }

    const cur = decodeCursor<{ k: string | number; id: string }>(p.cursor);
    let order: SQL;
    if (p.sort === 'distance') {
      if (cur) conds.push(sql`(${distance}, m.id) > (${Number(cur.k)}::float8, ${cur.id}::uuid)`);
      order = sql`ORDER BY ${distance}, m.id`;
    } else {
      if (cur) conds.push(sql`(m.starts_at, m.id) > (${String(cur.k)}::timestamptz, ${cur.id}::uuid)`);
      order = sql`ORDER BY m.starts_at, m.id`;
    }

    const list = await rows<MatchSummaryRow>(
      this.db,
      sql`SELECT ${MATCH_SUMMARY_COLUMNS}, ${distance} AS distance_m
          FROM matches m ${MATCH_JOINS}
          WHERE ${sql.join(conds, sql` AND `)}
          ${order}
          LIMIT ${p.limit + 1}`,
    );
    const page = list.slice(0, p.limit);
    const last = page[page.length - 1];
    const next =
      list.length > p.limit && last
        ? encodeCursor({ k: p.sort === 'distance' ? Number(last.distance_m) : last.starts_at, id: last.id })
        : null;
    return { items: page.map((r) => toMatchSummary(r, locale)), next_cursor: next };
  }

  async summaryRow(
    idOrCode: string,
    ex: Executor = this.db,
    opts: { includeDraft?: boolean } = {},
  ): Promise<MatchSummaryRow & Record<string, unknown>> {
    const where = UUID_RE.test(idOrCode) ? sql`m.id = ${idOrCode}` : sql`m.public_code = ${idOrCode.toUpperCase()}`;
    const r = await one<MatchSummaryRow & Record<string, unknown>>(
      ex,
      sql`SELECT ${MATCH_SUMMARY_COLUMNS}, m.description, m.booking_closes_at, m.min_players_deadline,
                 m.waiver_template_code, m.visibility, cp.rules AS policy_rules, m.sport_id, v.description AS venue_description
          FROM matches m ${MATCH_JOINS}
          JOIN cancellation_policies cp ON cp.id = m.cancellation_policy_id
          WHERE ${where} AND (${opts.includeDraft ?? false}::boolean OR m.status <> 'draft')`,
    );
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  async detail(idOrCode: string, locale: Locale, userId?: string, opts: { includeDraft?: boolean } = {}) {
    const r = await this.summaryRow(idOrCode, this.db, opts);
    const participants = await rows<{ display_name: string | null; guest: boolean; level: string | null }>(
      this.db,
      sql`SELECT u.display_name, mp.user_id IS NULL AS guest, psp.self_level AS level
          FROM match_participants mp
          LEFT JOIN users u ON u.id = mp.user_id
          LEFT JOIN player_sport_profiles psp ON psp.user_id = mp.user_id AND psp.sport_id = ${r.sport_id}
          WHERE mp.match_id = ${r.id} AND mp.status IN ('held', 'confirmed', 'checked_in')
          ORDER BY mp.created_at`,
    );
    let myBooking: unknown = null;
    let signed: boolean | null = null;
    if (userId) {
      const b = await one<{ id: string; status: string; seats: number; total_amount: number; currency: string; expires_at: string | null; confirmed_at: string | null }>(
        this.db,
        sql`SELECT id, status, seats, total_amount, currency, expires_at, confirmed_at FROM bookings
            WHERE match_id = ${r.id} AND user_id = ${userId} AND status IN ('pending_payment', 'confirmed')
            ORDER BY created_at DESC LIMIT 1`,
      );
      if (b) {
        myBooking = {
          id: b.id,
          match_id: r.id,
          status: b.status,
          seats: b.seats,
          total: money(b.total_amount, b.currency, locale),
          expires_at: iso(b.expires_at),
          confirmed_at: iso(b.confirmed_at),
        };
      }
      signed = !!(await one(
        this.db,
        sql`SELECT 1 FROM waiver_signatures ws JOIN waiver_templates t ON t.id = ws.template_id
            WHERE ws.user_id = ${userId} AND t.code = ${r.waiver_template_code as string}
              AND t.version = (SELECT max(version) FROM waiver_templates
                               WHERE code = ${r.waiver_template_code as string} AND retired_at IS NULL)`,
      ));
    }
    return {
      ...toMatchSummary(r, locale),
      description: tr(r.description, locale),
      booking_closes_at: iso(r.booking_closes_at as string),
      min_players_deadline: iso(r.min_players_deadline as string),
      cancellation_policy: { summary: policySummary(r.policy_rules as PolicyRule[], locale) },
      participants_preview: participants.map((p) => ({
        display_name: p.guest ? (locale === 'ru' ? 'Гость' : locale === 'en' ? 'Guest' : 'Mehmon') : p.display_name,
        avatar_url: null,
        level: p.level,
      })),
      waiver: { required: true, template_code: r.waiver_template_code, signed },
      my_booking: myBooking,
    };
  }

  async joinWaitlist(idOrCode: string, userId: string) {
    const r = await this.summaryRow(idOrCode);
    if (!['open', 'full'].includes(r.status)) throw new AppError('INVALID_STATE');
    try {
      await this.db.execute(sql`INSERT INTO match_waitlist (match_id, user_id) VALUES (${r.id}, ${userId})`);
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) throw new AppError('ALREADY_ON_WAITLIST');
      throw err;
    }
    const pos = await one<{ position: number }>(
      this.db,
      sql`SELECT count(*)::int AS position FROM match_waitlist WHERE match_id = ${r.id} AND status = 'waiting'
          AND created_at <= (SELECT created_at FROM match_waitlist
                             WHERE match_id = ${r.id} AND user_id = ${userId} AND status = 'waiting')`,
    );
    return { position: pos?.position ?? 1 };
  }

  async leaveWaitlist(idOrCode: string, userId: string) {
    const r = await this.summaryRow(idOrCode);
    const res = await this.db.execute(
      sql`UPDATE match_waitlist SET status = 'cancelled'
          WHERE match_id = ${r.id} AND user_id = ${userId} AND status IN ('waiting', 'notified')`,
    );
    if (!res.rowCount) throw new AppError('NOT_FOUND');
  }
}
