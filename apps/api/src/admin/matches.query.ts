import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { type Locale, tr } from '../common/i18n';
import { money } from '../common/money';
import { type PolicyRule, policySummary } from '../bookings/policy';
import { DB, type Db, iso, rows } from '../db/db';
import { joinList } from './schemas';

export interface MatchListFilter {
  status?: string[];
  date_from?: string;
  date_to?: string;
  city_id?: number;
  venue_id?: string;
  pitch_id?: string;
  sport?: string[];
  q?: string;
  sort: 'starts_at' | '-starts_at';
  limit: number;
  offset: number;
}

interface AdminMatchRow {
  id: string;
  public_code: string;
  sport: string;
  title: unknown;
  status: string;
  visibility: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  format: string;
  players_per_side: number;
  price_amount: number;
  currency: string;
  min_players: number;
  max_players: number;
  held_slots: number;
  confirmed_slots: number;
  host_fee_amount: number;
  city_id: number;
  city_name: unknown;
  venue_id: string;
  venue_name: string;
  pitch_id: string;
  pitch_name: string;
  lease_id: string | null;
  lease_cost: number | null;
  lease_status: string | null;
  gross: number;
  refunded: number;
  host_user_id: string | null;
  host_name: string | null;
  host_status: string | null;
  published_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  total?: number;
}

/**
 * Admin jadvali uchun match qatori. Tushum — haqiqiy pul harakati bo'yicha:
 * gross = muvaffaqiyatli to'lovlar (hamyon bilan to'langanlari ham), refunded = bajarilgan + navbatdagi refund'lar.
 */
const ADMIN_MATCH_SELECT = sql`
  SELECT m.id, m.public_code, s.code AS sport, m.title, m.status, m.visibility, m.starts_at, m.ends_at, v.timezone,
         m.format, m.players_per_side, m.price_amount, m.currency, m.min_players, m.max_players, m.held_slots,
         m.confirmed_slots, m.host_fee_amount, c.id AS city_id, c.name AS city_name, v.id AS venue_id, v.name AS venue_name,
         p.id AS pitch_id, p.name AS pitch_name, fl.id AS lease_id, fl.cost_amount AS lease_cost, fl.status AS lease_status,
         coalesce(g.gross, 0)::bigint AS gross, coalesce(rf.refunded, 0)::bigint AS refunded,
         h.host_user_id, h.host_name, h.host_status, m.published_at, m.cancelled_at, m.cancel_reason, m.created_at
  FROM matches m
  JOIN sports s ON s.id = m.sport_id
  JOIN pitches p ON p.id = m.pitch_id
  JOIN venues v ON v.id = p.venue_id
  JOIN cities c ON c.id = m.city_id
  LEFT JOIN field_leases fl ON fl.id = m.lease_id
  LEFT JOIN LATERAL (
    SELECT sum(pay.amount) AS gross FROM payments pay JOIN bookings b ON b.id = pay.booking_id
    WHERE b.match_id = m.id AND pay.status IN ('succeeded', 'partially_refunded', 'refunded')
  ) g ON true
  LEFT JOIN LATERAL (
    SELECT sum(r.amount) AS refunded FROM refunds r JOIN bookings b ON b.id = r.booking_id
    WHERE b.match_id = m.id AND r.status <> 'failed'
  ) rf ON true
  LEFT JOIN LATERAL (
    SELECT ha.host_user_id, u.display_name AS host_name, ha.status AS host_status
    FROM host_assignments ha JOIN users u ON u.id = ha.host_user_id
    WHERE ha.match_id = m.id AND ha.status IN ('offered', 'accepted', 'arrived', 'completed', 'no_show')
    ORDER BY (ha.status <> 'offered') DESC, ha.created_at DESC
    LIMIT 1
  ) h ON true`;

function present(r: AdminMatchRow, locale: Locale) {
  const taken = r.held_slots + r.confirmed_slots;
  const m = (amount: number) => money(amount, r.currency, locale);
  return {
    id: r.id,
    public_code: r.public_code,
    sport: r.sport,
    title: tr(r.title, locale),
    status: r.status,
    visibility: r.visibility,
    starts_at: iso(r.starts_at),
    ends_at: iso(r.ends_at),
    timezone: r.timezone,
    format: r.format,
    players_per_side: r.players_per_side,
    city: { id: r.city_id, name: tr(r.city_name, locale) },
    venue: { id: r.venue_id, name: r.venue_name },
    pitch: { id: r.pitch_id, name: r.pitch_name },
    price: m(r.price_amount),
    slots: {
      max: r.max_players,
      min_to_play: r.min_players,
      held: r.held_slots,
      confirmed: r.confirmed_slots,
      taken,
      available: Math.max(r.max_players - taken, 0),
    },
    fill_rate: r.max_players ? Math.round((r.confirmed_slots / r.max_players) * 1000) / 1000 : 0,
    revenue: { gross: m(r.gross), refunded: m(r.refunded), net: m(r.gross - r.refunded) },
    lease_cost: r.lease_cost === null ? null : m(r.lease_cost),
    host_fee: m(r.host_fee_amount),
    host: r.host_user_id ? { user_id: r.host_user_id, display_name: r.host_name, assignment_status: r.host_status } : null,
    published_at: iso(r.published_at),
    cancelled_at: iso(r.cancelled_at),
    cancel_reason: r.cancel_reason,
    created_at: iso(r.created_at),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AdminMatchesQuery {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(f: MatchListFilter, locale: Locale) {
    const conds: SQL[] = [sql`true`];
    if (f.status?.length) conds.push(sql`m.status = ANY(string_to_array(${joinList(f.status)}, ',')::match_status[])`);
    if (f.date_from) conds.push(sql`m.starts_at >= ${f.date_from}::timestamptz`);
    if (f.date_to) conds.push(sql`m.starts_at < ${f.date_to}::timestamptz`);
    if (f.city_id !== undefined) conds.push(sql`m.city_id = ${f.city_id}`);
    if (f.venue_id) conds.push(sql`v.id = ${f.venue_id}`);
    if (f.pitch_id) conds.push(sql`m.pitch_id = ${f.pitch_id}`);
    if (f.sport?.length) conds.push(sql`s.code = ANY(string_to_array(${joinList(f.sport)}, ','))`);
    if (f.q) {
      const like = '%' + f.q + '%';
      conds.push(sql`(m.public_code ILIKE ${like} OR v.name ILIKE ${like} OR m.title::text ILIKE ${like})`);
    }
    const dir = f.sort === '-starts_at' ? sql`DESC` : sql`ASC`;
    const list = await rows<AdminMatchRow>(
      this.db,
      sql`SELECT x.*, count(*) OVER ()::int AS total FROM (${ADMIN_MATCH_SELECT} WHERE ${sql.join(conds, sql` AND `)}) x
          ORDER BY x.starts_at ${dir}, x.id ${dir}
          LIMIT ${f.limit} OFFSET ${f.offset}`,
    );
    let total = list[0]?.total;
    if (total === undefined) {
      total = f.offset
        ? (await rows<{ n: number }>(this.db, sql`SELECT count(*)::int AS n FROM (${ADMIN_MATCH_SELECT} WHERE ${sql.join(conds, sql` AND `)}) x`))[0]!.n
        : 0;
    }
    return { items: list.map((r) => present(r, locale)), total };
  }

  async detail(idOrCode: string, locale: Locale) {
    const where = UUID_RE.test(idOrCode) ? sql`m.id = ${idOrCode}` : sql`m.public_code = ${idOrCode.toUpperCase()}`;
    const r = (
      await rows<
        AdminMatchRow & {
          description: unknown;
          skill_min: string | null;
          skill_max: string | null;
          gender_policy: string;
          min_age: number;
          booking_closes_at: string;
          min_players_deadline: string;
          completed_at: string | null;
          policy_code: string;
          policy_rules: PolicyRule[];
          lease_starts_at: string | null;
          lease_ends_at: string | null;
          owner_invoice_ref: string | null;
          paid_to_owner_at: string | null;
        }
      >(
        this.db,
        sql`SELECT x.*, mm.description, mm.skill_min, mm.skill_max, mm.gender_policy, mm.min_age, mm.booking_closes_at,
                   mm.min_players_deadline, mm.completed_at, cp.code AS policy_code, cp.rules AS policy_rules,
                   lower(fl.period) AS lease_starts_at, upper(fl.period) AS lease_ends_at, fl.owner_invoice_ref, fl.paid_to_owner_at
            FROM (${ADMIN_MATCH_SELECT} WHERE ${where}) x
            JOIN matches mm ON mm.id = x.id
            JOIN cancellation_policies cp ON cp.id = mm.cancellation_policy_id
            LEFT JOIN field_leases fl ON fl.id = x.lease_id`,
      )
    )[0];
    if (!r) throw new AppError('NOT_FOUND');
    const m = (amount: number) => money(amount, r.currency, locale);

    const [sides, roster, bookings, payments, refunds, hosts, auditLog] = await Promise.all([
      rows<{ side_no: number; label: string; bib_color: string | null; score: number | null }>(
        this.db,
        sql`SELECT side_no, label, bib_color, score FROM match_sides WHERE match_id = ${r.id} ORDER BY side_no`,
      ),
      rows<{
        id: string;
        booking_id: string | null;
        user_id: string | null;
        display_name: string | null;
        phone: string | null;
        guest_name: string | null;
        side_no: number | null;
        status: string;
        source: string;
        checked_in_at: string | null;
        created_at: string;
      }>(
        this.db,
        sql`SELECT mp.id, mp.booking_id, mp.user_id, u.display_name, u.phone_e164 AS phone, mp.guest_name, mp.side_no,
                   mp.status, mp.source, mp.checked_in_at, mp.created_at
            FROM match_participants mp LEFT JOIN users u ON u.id = mp.user_id
            WHERE mp.match_id = ${r.id}
            ORDER BY (mp.status IN ('held', 'confirmed', 'checked_in', 'no_show')) DESC, mp.created_at`,
      ),
      rows<{
        id: string;
        user_id: string;
        display_name: string;
        phone: string | null;
        seats: number;
        status: string;
        unit_price_amount: number;
        wallet_applied_amount: number;
        total_amount: number;
        created_at: string;
        confirmed_at: string | null;
        cancelled_at: string | null;
        cancel_reason: string | null;
        expires_at: string | null;
      }>(
        this.db,
        sql`SELECT b.id, b.user_id, u.display_name, u.phone_e164 AS phone, b.seats, b.status, b.unit_price_amount,
                   b.wallet_applied_amount, b.total_amount, b.created_at, b.confirmed_at, b.cancelled_at, b.cancel_reason, b.expires_at
            FROM bookings b JOIN users u ON u.id = b.user_id
            WHERE b.match_id = ${r.id} ORDER BY b.created_at`,
      ),
      rows<{
        id: string;
        booking_id: string;
        user_id: string;
        provider: string;
        amount: number;
        refunded_amount: number;
        currency: string;
        status: string;
        provider_transaction_id: string | null;
        created_at: string;
        succeeded_at: string | null;
        cancelled_at: string | null;
      }>(
        this.db,
        sql`SELECT pay.id, pay.booking_id, pay.user_id, pay.provider, pay.amount, pay.refunded_amount, pay.currency, pay.status,
                   pay.provider_transaction_id, pay.created_at, pay.succeeded_at, pay.cancelled_at
            FROM payments pay JOIN bookings b ON b.id = pay.booking_id
            WHERE b.match_id = ${r.id} ORDER BY pay.created_at`,
      ),
      rows<{
        id: string;
        booking_id: string;
        payment_id: string | null;
        amount: number;
        destination: string;
        status: string;
        reason: string;
        provider_refund_id: string | null;
        note: string | null;
        created_at: string;
        completed_at: string | null;
      }>(
        this.db,
        sql`SELECT r.id, r.booking_id, r.payment_id, r.amount, r.destination, r.status, r.reason, r.provider_refund_id, r.note,
                   r.created_at, r.completed_at
            FROM refunds r JOIN bookings b ON b.id = r.booking_id
            WHERE b.match_id = ${r.id} ORDER BY r.created_at`,
      ),
      rows<{
        id: string;
        host_user_id: string;
        display_name: string;
        phone: string | null;
        status: string;
        dispatch_round: number;
        fee_amount: number;
        offered_at: string;
        offer_expires_at: string;
        responded_at: string | null;
        decline_reason: string | null;
        arrived_at: string | null;
        arrival_distance_m: number | null;
        completed_at: string | null;
      }>(
        this.db,
        sql`SELECT ha.id, ha.host_user_id, u.display_name, u.phone_e164 AS phone, ha.status, ha.dispatch_round, ha.fee_amount,
                   ha.offered_at, ha.offer_expires_at, ha.responded_at, ha.decline_reason, ha.arrived_at, ha.arrival_distance_m,
                   ha.completed_at
            FROM host_assignments ha JOIN users u ON u.id = ha.host_user_id
            WHERE ha.match_id = ${r.id} ORDER BY ha.offered_at DESC`,
      ),
      rows<{ id: number; action: string; actor_user_id: string | null; actor_name: string | null; changes: unknown; created_at: string }>(
        this.db,
        sql`SELECT a.id, a.action, a.actor_user_id, u.display_name AS actor_name, a.changes, a.created_at
            FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
            WHERE a.entity_type = 'match' AND a.entity_id = ${r.id} ORDER BY a.created_at DESC, a.id DESC LIMIT 50`,
      ),
    ]);

    const guestLabel = locale === 'ru' ? 'Гость' : locale === 'en' ? 'Guest' : 'Mehmon';
    return {
      ...present(r, locale),
      description: tr(r.description, locale),
      level: { min: r.skill_min, max: r.skill_max },
      gender_policy: r.gender_policy,
      min_age: r.min_age,
      booking_closes_at: iso(r.booking_closes_at),
      min_players_deadline: iso(r.min_players_deadline),
      completed_at: iso(r.completed_at),
      cancellation_policy: { code: r.policy_code, summary: policySummary(r.policy_rules, locale) },
      lease: r.lease_id
        ? {
            id: r.lease_id,
            status: r.lease_status,
            starts_at: iso(r.lease_starts_at),
            ends_at: iso(r.lease_ends_at),
            cost: m(r.lease_cost ?? 0),
            owner_invoice_ref: r.owner_invoice_ref,
            paid_to_owner_at: iso(r.paid_to_owner_at),
          }
        : null,
      sides,
      roster: roster.map((p) => ({
        participant_id: p.id,
        booking_id: p.booking_id,
        user: p.user_id ? { id: p.user_id, display_name: p.display_name, phone: p.phone } : null,
        display_name: p.user_id ? p.display_name : `${p.guest_name} (${guestLabel})`,
        is_guest: !p.user_id,
        side_no: p.side_no,
        status: p.status,
        source: p.source,
        checked_in_at: iso(p.checked_in_at),
        created_at: iso(p.created_at),
      })),
      bookings: bookings.map((b) => ({
        id: b.id,
        user: { id: b.user_id, display_name: b.display_name, phone: b.phone },
        seats: b.seats,
        status: b.status,
        unit_price: m(b.unit_price_amount),
        wallet_applied: m(b.wallet_applied_amount),
        total: m(b.total_amount),
        paid: m(b.total_amount + b.wallet_applied_amount),
        created_at: iso(b.created_at),
        confirmed_at: iso(b.confirmed_at),
        cancelled_at: iso(b.cancelled_at),
        cancel_reason: b.cancel_reason,
        expires_at: b.status === 'pending_payment' ? iso(b.expires_at) : null,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        booking_id: p.booking_id,
        user_id: p.user_id,
        provider: p.provider,
        amount: money(p.amount, p.currency, locale),
        refunded: money(p.refunded_amount, p.currency, locale),
        status: p.status,
        provider_transaction_id: p.provider_transaction_id,
        created_at: iso(p.created_at),
        succeeded_at: iso(p.succeeded_at),
        cancelled_at: iso(p.cancelled_at),
      })),
      refunds: refunds.map((x) => ({
        id: x.id,
        booking_id: x.booking_id,
        payment_id: x.payment_id,
        amount: m(x.amount),
        destination: x.destination,
        status: x.status,
        reason: x.reason,
        provider_refund_id: x.provider_refund_id,
        note: x.note,
        created_at: iso(x.created_at),
        completed_at: iso(x.completed_at),
      })),
      host_assignments: hosts.map((h) => ({
        id: h.id,
        host: { user_id: h.host_user_id, display_name: h.display_name, phone: h.phone },
        status: h.status,
        dispatch_round: h.dispatch_round,
        fee: m(h.fee_amount),
        offered_at: iso(h.offered_at),
        offer_expires_at: iso(h.offer_expires_at),
        responded_at: iso(h.responded_at),
        decline_reason: h.decline_reason,
        arrived_at: iso(h.arrived_at),
        arrival_distance_m: h.arrival_distance_m,
        completed_at: iso(h.completed_at),
      })),
      audit: auditLog.map((a) => ({
        id: a.id,
        action: a.action,
        actor: a.actor_user_id ? { id: a.actor_user_id, display_name: a.actor_name } : null,
        changes: a.changes,
        created_at: iso(a.created_at),
      })),
    };
  }
}
