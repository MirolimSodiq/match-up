import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import type { Locale } from '../common/i18n';
import { money } from '../common/money';
import { DB, type Db, iso, one, rows, type Tx } from '../db/db';
import { type PendingRefund, RefundSettlement } from '../payments/refund-settlement';
import { type Actor, audit } from './audit';
import { joinList } from './schemas';

export interface PaymentFilter {
  status?: string[];
  provider?: string[];
  date_from?: string;
  date_to?: string;
  match_id?: string;
  q?: string;
  limit: number;
  offset: number;
}

export interface RefundFilter {
  status?: string[];
  destination?: string[];
  provider?: string[];
  auto_status?: string[];
  q?: string;
  limit: number;
  offset: number;
}

export interface DashboardFilter {
  date_from: string;
  date_to: string;
  city_id?: number;
  currency: string;
}

interface PaymentRow {
  id: string;
  booking_id: string;
  provider: string;
  amount: number;
  refunded_amount: number;
  currency: string;
  status: string;
  provider_transaction_id: string | null;
  failure_code: string | null;
  created_at: string;
  succeeded_at: string | null;
  cancelled_at: string | null;
  user_id: string;
  display_name: string;
  phone: string | null;
  match_id: string;
  public_code: string;
  starts_at: string;
  venue_name: string;
  booking_status: string;
  total?: number;
}

interface RefundRow {
  id: string;
  booking_id: string;
  payment_id: string | null;
  amount: number;
  currency: string;
  destination: string;
  status: string;
  reason: string;
  provider_refund_id: string | null;
  note: string | null;
  created_at: string;
  completed_at: string | null;
  auto_status: string | null;
  auto_attempts: number;
  auto_next_at: string | null;
  auto_error: string | null;
  manual_reason: string | null;
  initiated_by: string | null;
  processed_by: string | null;
  processed_by_name: string | null;
  user_id: string;
  display_name: string;
  phone: string | null;
  match_id: string;
  public_code: string;
  starts_at: string;
  pay_provider: string | null;
  pay_amount: number | null;
  pay_refunded: number | null;
  pay_status: string | null;
  pay_tx: string | null;
  total?: number;
}

const PAYMENT_SELECT = sql`
  SELECT pay.id, pay.booking_id, pay.provider, pay.amount, pay.refunded_amount, pay.currency, pay.status,
         pay.provider_transaction_id, pay.failure_code, pay.created_at, pay.succeeded_at, pay.cancelled_at,
         u.id AS user_id, u.display_name, u.phone_e164 AS phone,
         m.id AS match_id, m.public_code, m.starts_at, v.name AS venue_name, b.status AS booking_status
  FROM payments pay
  JOIN bookings b ON b.id = pay.booking_id
  JOIN users u ON u.id = pay.user_id
  JOIN matches m ON m.id = b.match_id
  JOIN pitches p ON p.id = m.pitch_id
  JOIN venues v ON v.id = p.venue_id`;

const REFUND_SELECT = sql`
  SELECT r.id, r.booking_id, r.payment_id, r.amount, r.currency, r.destination, r.status, r.reason, r.provider_refund_id,
         r.note, r.created_at, r.completed_at, r.auto_status, r.auto_attempts, r.auto_next_at, r.auto_error, r.manual_reason,
         r.initiated_by, r.processed_by, pu.display_name AS processed_by_name,
         u.id AS user_id, u.display_name, u.phone_e164 AS phone, m.id AS match_id, m.public_code, m.starts_at,
         pay.provider AS pay_provider, pay.amount AS pay_amount, pay.refunded_amount AS pay_refunded,
         pay.status AS pay_status, pay.provider_transaction_id AS pay_tx
  FROM refunds r
  JOIN bookings b ON b.id = r.booking_id
  JOIN users u ON u.id = b.user_id
  JOIN matches m ON m.id = b.match_id
  LEFT JOIN payments pay ON pay.id = r.payment_id
  LEFT JOIN users pu ON pu.id = r.processed_by`;

/** Telefon, booking/to'lov id, provider tranzaksiya id yoki match kodi bo'yicha qidiruv. */
function search(q: string, extra: SQL[] = []): SQL {
  const digits = q.replace(/[\s()+-]/g, '');
  const like = '%' + q + '%';
  const parts: SQL[] = [
    sql`m.public_code ILIKE ${like}`,
    sql`u.display_name ILIKE ${like}`,
    sql`b.id::text = ${q.toLowerCase()}`,
    ...extra,
  ];
  if (digits.length >= 4 && /^\d+$/.test(digits)) parts.push(sql`u.phone_e164 LIKE ${'%' + digits + '%'}`);
  return sql`(${sql.join(parts, sql` OR `)})`;
}

@Injectable()
export class AdminFinanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settlement: RefundSettlement,
  ) {}

  // -------------------------------------------------------------------------
  // To'lovlar
  // -------------------------------------------------------------------------
  async payments(f: PaymentFilter, locale: Locale) {
    const conds: SQL[] = [sql`true`];
    if (f.status?.length) conds.push(sql`pay.status = ANY(string_to_array(${joinList(f.status)}, ',')::payment_status[])`);
    if (f.provider?.length) conds.push(sql`pay.provider = ANY(string_to_array(${joinList(f.provider)}, ',')::payment_provider[])`);
    if (f.date_from) conds.push(sql`pay.created_at >= ${f.date_from}::timestamptz`);
    if (f.date_to) conds.push(sql`pay.created_at < ${f.date_to}::timestamptz`);
    if (f.match_id) conds.push(sql`m.id = ${f.match_id}`);
    if (f.q) conds.push(search(f.q, [sql`pay.id::text = ${f.q.toLowerCase()}`, sql`pay.provider_transaction_id = ${f.q}`]));
    const where = sql.join(conds, sql` AND `);

    const [list, totals] = await Promise.all([
      rows<PaymentRow>(
        this.db,
        sql`SELECT x.*, count(*) OVER ()::int AS total FROM (${PAYMENT_SELECT} WHERE ${where}) x
            ORDER BY x.created_at DESC, x.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
      ),
      rows<{ currency: string; count: number; amount: number; refunded: number; succeeded: number }>(
        this.db,
        sql`SELECT pay.currency, count(*)::int AS count,
                   coalesce(sum(pay.amount) FILTER (WHERE pay.status IN ('succeeded', 'partially_refunded', 'refunded')), 0)::bigint AS succeeded,
                   coalesce(sum(pay.amount), 0)::bigint AS amount, coalesce(sum(pay.refunded_amount), 0)::bigint AS refunded
            FROM payments pay JOIN bookings b ON b.id = pay.booking_id JOIN users u ON u.id = pay.user_id
            JOIN matches m ON m.id = b.match_id JOIN pitches p ON p.id = m.pitch_id JOIN venues v ON v.id = p.venue_id
            WHERE ${where} GROUP BY pay.currency ORDER BY pay.currency`,
      ),
    ]);
    return {
      items: list.map((p) => ({
        id: p.id,
        booking_id: p.booking_id,
        booking_status: p.booking_status,
        provider: p.provider,
        amount: money(p.amount, p.currency, locale),
        refunded: money(p.refunded_amount, p.currency, locale),
        status: p.status,
        provider_transaction_id: p.provider_transaction_id,
        failure_code: p.failure_code,
        created_at: iso(p.created_at),
        succeeded_at: iso(p.succeeded_at),
        cancelled_at: iso(p.cancelled_at),
        user: { id: p.user_id, display_name: p.display_name, phone: p.phone },
        match: { id: p.match_id, public_code: p.public_code, starts_at: iso(p.starts_at), venue_name: p.venue_name },
      })),
      total: totals.reduce((a, t) => a + t.count, 0),
      totals: totals.map((t) => ({
        currency: t.currency,
        count: t.count,
        amount: money(t.amount, t.currency, locale),
        succeeded: money(t.succeeded, t.currency, locale),
        refunded: money(t.refunded, t.currency, locale),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Refund navbati
  // -------------------------------------------------------------------------
  private presentRefund(r: RefundRow, locale: Locale) {
    return {
      id: r.id,
      booking_id: r.booking_id,
      amount: money(r.amount, r.currency, locale),
      destination: r.destination,
      status: r.status,
      reason: r.reason,
      provider_refund_id: r.provider_refund_id,
      note: r.note,
      created_at: iso(r.created_at),
      completed_at: iso(r.completed_at),
      auto: {
        status: r.auto_status,
        attempts: r.auto_attempts,
        next_attempt_at: iso(r.auto_next_at),
        manual_reason: r.manual_reason,
        error: r.auto_error,
      },
      initiated_by: r.initiated_by,
      processed_by: r.processed_by ? { id: r.processed_by, display_name: r.processed_by_name } : null,
      user: { id: r.user_id, display_name: r.display_name, phone: r.phone },
      match: { id: r.match_id, public_code: r.public_code, starts_at: iso(r.starts_at) },
      payment: r.payment_id
        ? {
            id: r.payment_id,
            provider: r.pay_provider,
            amount: money(r.pay_amount ?? 0, r.currency, locale),
            refunded: money(r.pay_refunded ?? 0, r.currency, locale),
            status: r.pay_status,
            provider_transaction_id: r.pay_tx,
          }
        : null,
    };
  }

  async refunds(f: RefundFilter, locale: Locale) {
    const conds: SQL[] = [sql`true`];
    if (f.status?.length) conds.push(sql`r.status = ANY(string_to_array(${joinList(f.status)}, ',')::refund_status[])`);
    if (f.destination?.length) conds.push(sql`r.destination = ANY(string_to_array(${joinList(f.destination)}, ',')::refund_destination[])`);
    if (f.provider?.length) conds.push(sql`pay.provider = ANY(string_to_array(${joinList(f.provider)}, ',')::payment_provider[])`);
    if (f.auto_status?.length) conds.push(sql`r.auto_status = ANY(string_to_array(${joinList(f.auto_status)}, ',')::refund_auto_status[])`);
    if (f.q) conds.push(search(f.q, [sql`r.id::text = ${f.q.toLowerCase()}`, sql`pay.provider_transaction_id = ${f.q}`]));
    const where = sql.join(conds, sql` AND `);
    // Navbat: eng eskisi birinchi (FIFO); yakunlanganlar — eng yangisi birinchi
    const pendingOnly = f.status?.length === 1 && f.status[0] === 'pending';
    const [list, totals] = await Promise.all([
      rows<RefundRow>(
        this.db,
        sql`SELECT x.*, count(*) OVER ()::int AS total FROM (${REFUND_SELECT} WHERE ${where}) x
            ORDER BY ${pendingOnly ? sql`x.created_at ASC, x.id ASC` : sql`coalesce(x.completed_at, x.created_at) DESC, x.id DESC`}
            LIMIT ${f.limit} OFFSET ${f.offset}`,
      ),
      rows<{ currency: string; count: number; amount: number }>(
        this.db,
        sql`SELECT r.currency, count(*)::int AS count, coalesce(sum(r.amount), 0)::bigint AS amount
            FROM refunds r JOIN bookings b ON b.id = r.booking_id JOIN users u ON u.id = b.user_id
            JOIN matches m ON m.id = b.match_id LEFT JOIN payments pay ON pay.id = r.payment_id
            WHERE ${where} GROUP BY r.currency ORDER BY r.currency`,
      ),
    ]);
    return {
      items: list.map((r) => this.presentRefund(r, locale)),
      total: totals.reduce((a, t) => a + t.count, 0),
      totals: totals.map((t) => ({ currency: t.currency, count: t.count, amount: money(t.amount, t.currency, locale) })),
    };
  }

  /** Navbatdagi refund (lock bilan): faqat kutilayotgan `original_method`; provider'ga yuborilgani — 409. */
  private async lockQueued(tx: Tx, refundId: string) {
    const r = await one<PendingRefund & { status: string; destination: string; auto_status: string | null }>(
      tx,
      sql`SELECT r.id, r.booking_id, r.payment_id, r.amount, r.currency, r.status, r.destination, r.auto_status, b.user_id
          FROM refunds r JOIN bookings b ON b.id = r.booking_id
          WHERE r.id = ${refundId} FOR UPDATE OF r`,
    );
    if (!r) throw new AppError('NOT_FOUND');
    // submitted — avto-refund provider javobini kutyapti: ikki marta qaytarmaslik uchun admin tegmaydi
    if (r.status !== 'pending' || r.destination !== 'original_method' || !r.payment_id || r.auto_status === 'submitted') {
      throw new AppError('INVALID_STATE');
    }
    return r;
  }

  private async presentById(refundId: string, locale: Locale) {
    const r = await one<RefundRow>(this.db, sql`${REFUND_SELECT} WHERE r.id = ${refundId}`);
    return this.presentRefund(r!, locale);
  }

  /**
   * Qo'lda bajarilgan provider refund'ini yakunlash: refund -> succeeded (provider_refund_id, izoh),
   * payments.refunded_amount oshadi va status refunded / partially_refunded bo'ladi.
   */
  async completeRefund(actor: Actor, refundId: string, body: { provider_refund_id: string; note?: string }, locale: Locale) {
    await this.db.transaction(async (tx) => {
      const r = await this.lockQueued(tx, refundId);
      const pay = await one<{ amount: number; refunded_amount: number }>(
        tx,
        sql`SELECT amount, refunded_amount FROM payments WHERE id = ${r.payment_id} FOR UPDATE`,
      );
      // CHECK (refunded_amount <= amount)
      const refunded = Math.min(pay!.amount, pay!.refunded_amount + r.amount);
      await tx.execute(
        sql`UPDATE payments
               SET refunded_amount = ${refunded},
                   status = ${refunded >= pay!.amount ? 'refunded' : 'partially_refunded'}::payment_status
             WHERE id = ${r.payment_id}`,
      );
      await this.settlement.complete(tx, r, body.provider_refund_id, { processedBy: actor.id, note: body.note });
      await audit(tx, actor, 'refund.complete', 'refund', refundId, {
        provider_refund_id: body.provider_refund_id,
        note: body.note ?? null,
        payment_id: r.payment_id,
        payment_refunded_amount: refunded,
      });
    });
    return this.presentById(refundId, locale);
  }

  /**
   * Kartaga qaytarib bo'lmaydigan refund'ni (qisman — provider faqat to'liq qaytaradi — yoki provider rad etgan)
   * o'yinchi hamyoniga o'tkazish: refund -> wallet + succeeded, hamyon kreditlanadi, `RefundIssued` (push).
   */
  async refundToWallet(actor: Actor, refundId: string, body: { note?: string }, locale: Locale) {
    await this.db.transaction(async (tx) => {
      const r = await this.lockQueued(tx, refundId);
      await this.settlement.toWallet(tx, r, actor.id, body.note ?? null);
      await audit(tx, actor, 'refund.to_wallet', 'refund', refundId, {
        amount: r.amount,
        payment_id: r.payment_id,
        note: body.note ?? null,
      });
    });
    return this.presentById(refundId, locale);
  }

  /** Admin navbatidagi refund'ni avto-refund'ga qaytarish (masalan provider xatosi tuzatilgach yoki yoqilgach). */
  async retryAutoRefund(actor: Actor, refundId: string, locale: Locale) {
    await this.db.transaction(async (tx) => {
      const r = await this.lockQueued(tx, refundId);
      if (r.auto_status !== 'manual') throw new AppError('INVALID_STATE');
      await tx.execute(
        sql`UPDATE refunds
               SET auto_status = 'queued', manual_reason = NULL, auto_error = NULL, auto_attempts = 0, auto_next_at = now()
             WHERE id = ${refundId}`,
      );
      await audit(tx, actor, 'refund.auto_retry', 'refund', refundId, {});
    });
    return this.presentById(refundId, locale);
  }

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------
  /**
   * Davr — match boshlanish vaqti bo'yicha [date_from, date_to). Draft'lar hisobga olinmaydi.
   *   GMV           — muvaffaqiyatli to'lovlar (hamyon bilan ham), refund'lar ayrilmagan
   *   net_revenue   — GMV - refund'lar (bajarilgan va navbatdagi)
   *   lease_cost    — bekor qilinmagan ijaralar (bekor qilingan match'niki ham — ijara to'lanadi)
   *   host_payouts  — qabul qilingan / bajarilgan tayinlovlar (bekor qilingan match'lardan tashqari)
   *   gross_margin  — net_revenue - lease_cost - host_payouts
   *   fill_rate     — confirmed / max (bekor qilinmagan match'lar)
   *   no_show_rate  — no_show / (checked_in + no_show)
   */
  async dashboard(f: DashboardFilter, locale: Locale) {
    const conds: SQL[] = [
      sql`m.status <> 'draft'`,
      sql`m.starts_at >= ${f.date_from}::timestamptz`,
      sql`m.starts_at < ${f.date_to}::timestamptz`,
      sql`m.currency = ${f.currency}`,
    ];
    if (f.city_id !== undefined) conds.push(sql`m.city_id = ${f.city_id}`);
    const where = sql.join(conds, sql` AND `);

    const kpi = (await one<{
      matches: number;
      open: number;
      full: number;
      in_progress: number;
      completed: number;
      cancelled: number;
      confirmed: number;
      capacity: number;
      gmv: number;
      refunds: number;
      lease_cost: number;
      host_payouts: number;
      checked_in: number;
      no_show: number;
      bookings_confirmed: number;
      bookings_cancelled: number;
    }>(
      this.db,
      sql`WITH ms AS (SELECT m.* FROM matches m WHERE ${where})
          SELECT
            (SELECT count(*)::int FROM ms) AS matches,
            (SELECT count(*)::int FROM ms WHERE status = 'open') AS open,
            (SELECT count(*)::int FROM ms WHERE status = 'full') AS "full",
            (SELECT count(*)::int FROM ms WHERE status = 'in_progress') AS in_progress,
            (SELECT count(*)::int FROM ms WHERE status = 'completed') AS completed,
            (SELECT count(*)::int FROM ms WHERE status = 'cancelled') AS cancelled,
            (SELECT coalesce(sum(confirmed_slots), 0)::int FROM ms WHERE status <> 'cancelled') AS confirmed,
            (SELECT coalesce(sum(max_players), 0)::int FROM ms WHERE status <> 'cancelled') AS capacity,
            (SELECT coalesce(sum(pay.amount), 0)::bigint FROM payments pay JOIN bookings b ON b.id = pay.booking_id
              JOIN ms ON ms.id = b.match_id WHERE pay.status IN ('succeeded', 'partially_refunded', 'refunded')) AS gmv,
            (SELECT coalesce(sum(r.amount), 0)::bigint FROM refunds r JOIN bookings b ON b.id = r.booking_id
              JOIN ms ON ms.id = b.match_id WHERE r.status <> 'failed') AS refunds,
            (SELECT coalesce(sum(fl.cost_amount), 0)::bigint FROM field_leases fl JOIN ms ON ms.lease_id = fl.id
              WHERE fl.status <> 'cancelled') AS lease_cost,
            (SELECT coalesce(sum(ha.fee_amount), 0)::bigint FROM host_assignments ha JOIN ms ON ms.id = ha.match_id
              WHERE ha.status IN ('accepted', 'arrived', 'completed') AND ms.status <> 'cancelled') AS host_payouts,
            (SELECT count(*)::int FROM match_participants mp JOIN ms ON ms.id = mp.match_id WHERE mp.status = 'checked_in') AS checked_in,
            (SELECT count(*)::int FROM match_participants mp JOIN ms ON ms.id = mp.match_id WHERE mp.status = 'no_show') AS no_show,
            (SELECT count(*)::int FROM bookings b JOIN ms ON ms.id = b.match_id WHERE b.confirmed_at IS NOT NULL) AS bookings_confirmed,
            (SELECT count(*)::int FROM bookings b JOIN ms ON ms.id = b.match_id
              WHERE b.status = 'cancelled' AND b.confirmed_at IS NOT NULL) AS bookings_cancelled`,
    ))!;

    const [reasons, series, pending] = await Promise.all([
      rows<{ reason: string; count: number }>(
        this.db,
        sql`SELECT coalesce(m.cancel_reason, 'other') AS reason, count(*)::int AS count
            FROM matches m WHERE ${where} AND m.status = 'cancelled' GROUP BY 1 ORDER BY 2 DESC`,
      ),
      rows<{ date: string; matches: number; cancelled: number; confirmed: number; capacity: number; gmv: number }>(
        this.db,
        sql`SELECT (m.starts_at AT TIME ZONE c.timezone)::date::text AS date,
                   count(*)::int AS matches,
                   count(*) FILTER (WHERE m.status = 'cancelled')::int AS cancelled,
                   coalesce(sum(m.confirmed_slots) FILTER (WHERE m.status <> 'cancelled'), 0)::int AS confirmed,
                   coalesce(sum(m.max_players) FILTER (WHERE m.status <> 'cancelled'), 0)::int AS capacity,
                   coalesce(sum(g.gross), 0)::bigint AS gmv
            FROM matches m JOIN cities c ON c.id = m.city_id
            LEFT JOIN LATERAL (
              SELECT sum(pay.amount) AS gross FROM payments pay JOIN bookings b ON b.id = pay.booking_id
              WHERE b.match_id = m.id AND pay.status IN ('succeeded', 'partially_refunded', 'refunded')
            ) g ON true
            WHERE ${where}
            GROUP BY 1 ORDER BY 1`,
      ),
      one<{ count: number; amount: number }>(
        this.db,
        sql`SELECT count(*)::int AS count, coalesce(sum(amount), 0)::bigint AS amount FROM refunds
            WHERE status = 'pending' AND destination = 'original_method' AND currency = ${f.currency}`,
      ),
    ]);

    const m = (amount: number) => money(amount, f.currency, locale);
    const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);
    const net = kpi.gmv - kpi.refunds;
    const margin = net - kpi.lease_cost - kpi.host_payouts;
    return {
      range: { date_from: new Date(f.date_from).toISOString(), date_to: new Date(f.date_to).toISOString(), city_id: f.city_id ?? null, currency: f.currency },
      matches: {
        total: kpi.matches,
        by_status: { open: kpi.open, full: kpi.full, in_progress: kpi.in_progress, completed: kpi.completed, cancelled: kpi.cancelled },
      },
      fill_rate: ratio(kpi.confirmed, kpi.capacity),
      seats: { confirmed: kpi.confirmed, capacity: kpi.capacity },
      gmv: m(kpi.gmv),
      refunds: m(kpi.refunds),
      net_revenue: m(net),
      lease_cost: m(kpi.lease_cost),
      host_payouts: m(kpi.host_payouts),
      gross_margin: m(margin),
      gross_margin_pct: ratio(margin, net),
      no_show_rate: ratio(kpi.no_show, kpi.checked_in + kpi.no_show),
      attendance: { checked_in: kpi.checked_in, no_show: kpi.no_show },
      cancellations: {
        matches: kpi.cancelled,
        match_rate: ratio(kpi.cancelled, kpi.matches),
        by_reason: reasons,
        bookings: kpi.bookings_cancelled,
        booking_rate: ratio(kpi.bookings_cancelled, kpi.bookings_confirmed),
      },
      refund_queue: { count: pending?.count ?? 0, amount: m(pending?.amount ?? 0) },
      series: series.map((s) => ({
        date: s.date,
        matches: s.matches,
        cancelled: s.cancelled,
        fill_rate: ratio(s.confirmed, s.capacity),
        gmv: m(s.gmv),
      })),
    };
  }
}
