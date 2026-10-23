import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { tr, type Locale } from '../common/i18n';
import { minorToMajorString, money } from '../common/money';
import { emit } from '../common/outbox';
import { DB, type Db, iso, rows } from '../db/db';
import { pgUuidArray } from '../notifications/notifications.service';
import { type Actor, audit } from './audit';
import { joinList } from './schemas';

export interface PayoutFilter {
  status?: string[];
  host_id?: string;
  period_from?: string;
  period_to?: string;
  q?: string;
  limit: number;
  offset: number;
}

interface PayoutRow {
  id: string;
  host_user_id: string;
  display_name: string;
  phone: string | null;
  payout_method: string | null;
  payout_details_ref: string | null;
  period_start: string;
  period_end: string;
  amount: number;
  currency: string;
  status: string;
  assignments_count: number;
  provider_ref: string | null;
  paid_at: string | null;
  paid_by: string | null;
  paid_by_name: string | null;
  note: string | null;
  created_at: string;
  total?: number;
}

const PAYOUT_SELECT = sql`
  SELECT hp.id, hp.host_user_id, u.display_name, u.phone_e164 AS phone, h.payout_method, h.payout_details_ref,
         hp.period_start::text AS period_start, hp.period_end::text AS period_end, hp.amount, hp.currency, hp.status,
         hp.assignments_count, hp.provider_ref, hp.paid_at, hp.paid_by, pu.display_name AS paid_by_name, hp.note, hp.created_at
  FROM host_payouts hp
  JOIN host_profiles h ON h.user_id = hp.host_user_id
  JOIN users u ON u.id = hp.host_user_id
  LEFT JOIN users pu ON pu.id = hp.paid_by`;

/** CSV: bank o'tkazmasi uchun eksport chegarasi (bir haftadagi host'lar soni bundan ancha kam). */
export const PAYOUT_EXPORT_MAX = 5000;

/**
 * Admin: haftalik host payout'lari (`HostPayouts` job'i yaratadi). Admin pulni bank / karta orqali o'tkazadi va
 * shu yerda "to'landi" deb belgilaydi — bittalab yoki ommaviy (bitta o'tkazma raqami bilan). Har belgilash —
 * `audit_logs` va `HostPayoutPaid` (host'ga push).
 */
@Injectable()
export class AdminHostPayoutsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private where(f: Omit<PayoutFilter, 'limit' | 'offset'>): SQL {
    const conds: SQL[] = [sql`true`];
    if (f.status?.length) conds.push(sql`hp.status = ANY(string_to_array(${joinList(f.status)}, ',')::payout_status[])`);
    if (f.host_id) conds.push(sql`hp.host_user_id = ${f.host_id}`);
    if (f.period_from) conds.push(sql`hp.period_end >= ${f.period_from}::date`);
    if (f.period_to) conds.push(sql`hp.period_start <= ${f.period_to}::date`);
    if (f.q) {
      const digits = f.q.replace(/[\s()+-]/g, '');
      const parts: SQL[] = [sql`u.display_name ILIKE ${'%' + f.q + '%'}`, sql`hp.provider_ref = ${f.q}`, sql`hp.id::text = ${f.q.toLowerCase()}`];
      if (digits.length >= 4 && /^\d+$/.test(digits)) parts.push(sql`u.phone_e164 LIKE ${'%' + digits + '%'}`);
      conds.push(sql`(${sql.join(parts, sql` OR `)})`);
    }
    return sql.join(conds, sql` AND `);
  }

  /** To'lanmaganlar — eng eski hafta birinchi (navbat); qolganlari — eng yangisi birinchi. */
  private order(f: Pick<PayoutFilter, 'status'>): SQL {
    const pendingOnly = f.status?.length === 1 && f.status[0] === 'pending';
    return pendingOnly
      ? sql`x.period_start ASC, x.display_name ASC, x.id ASC`
      : sql`x.period_start DESC, x.display_name ASC, x.id ASC`;
  }

  private present(r: PayoutRow, locale: Locale) {
    return {
      id: r.id,
      host: {
        id: r.host_user_id,
        display_name: r.display_name,
        phone: r.phone,
        payout_method: r.payout_method,
        payout_details_ref: r.payout_details_ref,
      },
      period: { start: r.period_start, end: r.period_end },
      amount: money(r.amount, r.currency, locale),
      status: r.status,
      assignments_count: r.assignments_count,
      provider_ref: r.provider_ref,
      paid_at: iso(r.paid_at),
      paid_by: r.paid_by ? { id: r.paid_by, display_name: r.paid_by_name } : null,
      note: r.note,
      created_at: iso(r.created_at),
    };
  }

  async list(f: PayoutFilter, locale: Locale) {
    const where = this.where(f);
    const [list, totals] = await Promise.all([
      rows<PayoutRow>(
        this.db,
        sql`SELECT x.*, count(*) OVER ()::int AS total FROM (${PAYOUT_SELECT} WHERE ${where}) x
            ORDER BY ${this.order(f)} LIMIT ${f.limit} OFFSET ${f.offset}`,
      ),
      rows<{ currency: string; count: number; amount: number }>(
        this.db,
        sql`SELECT hp.currency, count(*)::int AS count, coalesce(sum(hp.amount), 0)::bigint AS amount
            FROM host_payouts hp JOIN host_profiles h ON h.user_id = hp.host_user_id JOIN users u ON u.id = hp.host_user_id
            WHERE ${where} GROUP BY hp.currency ORDER BY hp.currency`,
      ),
    ]);
    return {
      items: list.map((r) => this.present(r, locale)),
      total: totals.reduce((a, t) => a + t.count, 0),
      totals: totals.map((t) => ({ currency: t.currency, count: t.count, amount: money(t.amount, t.currency, locale) })),
    };
  }

  /** Payout + unga kirgan tayinlovlar (match, sana, venue, haq). */
  async get(id: string, locale: Locale) {
    const [r] = await rows<PayoutRow>(this.db, sql`${PAYOUT_SELECT} WHERE hp.id = ${id}`);
    if (!r) throw new AppError('NOT_FOUND');
    const items = await rows<{
      id: string;
      fee_amount: number;
      currency: string;
      completed_at: string | null;
      match_id: string;
      public_code: string;
      title: unknown;
      sport_name: unknown;
      format: string;
      starts_at: string;
      venue_name: string;
    }>(
      this.db,
      sql`SELECT ha.id, ha.fee_amount, ha.currency, ha.completed_at, m.id AS match_id, m.public_code, m.title,
                 s.name AS sport_name, m.format, m.starts_at, v.name AS venue_name
          FROM host_assignments ha
          JOIN matches m ON m.id = ha.match_id
          JOIN sports s ON s.id = m.sport_id
          JOIN pitches p ON p.id = m.pitch_id
          JOIN venues v ON v.id = p.venue_id
          WHERE ha.payout_id = ${id}
          ORDER BY m.starts_at, ha.id`,
    );
    return {
      ...this.present(r, locale),
      assignments: items.map((a) => ({
        id: a.id,
        match: {
          id: a.match_id,
          public_code: a.public_code,
          title: tr(a.title, locale) || `${tr(a.sport_name, locale)} ${a.format}`,
          starts_at: iso(a.starts_at),
          venue_name: a.venue_name,
        },
        fee: money(a.fee_amount, a.currency, locale),
        completed_at: iso(a.completed_at),
      })),
    };
  }

  /**
   * Bank o'tkazmasi uchun CSV (UTF-8 BOM — Excel kirill/apostrofni to'g'ri ochadi). Karta raqami bazada yo'q:
   * `payout_details_ref` — vault havolasi. Formula injection'dan himoya: `= + - @` bilan boshlangan katakka `'`.
   */
  async exportCsv(f: Omit<PayoutFilter, 'limit' | 'offset'>): Promise<string> {
    const list = await rows<PayoutRow>(
      this.db,
      sql`SELECT x.* FROM (${PAYOUT_SELECT} WHERE ${this.where(f)}) x ORDER BY ${this.order(f)} LIMIT ${PAYOUT_EXPORT_MAX + 1}`,
    );
    if (list.length > PAYOUT_EXPORT_MAX) {
      throw new AppError('VALIDATION_FAILED', {}, [
        { field: 'status', code: 'too_big', message: `Eksport ${PAYOUT_EXPORT_MAX} qatordan oshmasin — davr yoki holat bilan toraytiring` },
      ]);
    }
    const header = ['payout_id', 'host', 'phone', 'payout_method', 'payout_details_ref', 'amount', 'currency', 'period_start', 'period_end', 'assignments', 'status', 'provider_ref'];
    const lines = list.map((r) =>
      [
        r.id,
        r.display_name,
        r.phone ?? '',
        r.payout_method ?? '',
        r.payout_details_ref ?? '',
        minorToMajorString(r.amount, r.currency),
        r.currency,
        r.period_start,
        r.period_end,
        String(r.assignments_count),
        r.status,
        r.provider_ref ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
    return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  /**
   * "To'landi": hammasi `pending` bo'lishi shart (aks holda hech biri o'zgarmaydi — 409). Ommaviyda bitta
   * o'tkazma raqami barcha payout'larga yoziladi. Har payout — audit va `HostPayoutPaid` (host'ga push).
   */
  async markPaid(actor: Actor, ids: string[], body: { provider_ref: string; note?: string }, locale: Locale) {
    const unique = [...new Set(ids)];
    await this.db.transaction(async (tx) => {
      const found = await rows<{ id: string; status: string; host_user_id: string; amount: number; currency: string; period_start: string; period_end: string }>(
        tx,
        sql`SELECT id, status, host_user_id, amount, currency, period_start::text AS period_start, period_end::text AS period_end
            FROM host_payouts WHERE id = ANY(${pgUuidArray(unique)}) ORDER BY id FOR UPDATE`,
      );
      if (found.length !== unique.length) throw new AppError('NOT_FOUND');
      if (found.some((p) => p.status !== 'pending')) throw new AppError('INVALID_STATE');
      await tx.execute(
        sql`UPDATE host_payouts
               SET status = 'paid', provider_ref = ${body.provider_ref}, note = ${body.note ?? null}, paid_at = now(), paid_by = ${actor.id}
             WHERE id = ANY(${pgUuidArray(unique)})`,
      );
      for (const p of found) {
        await audit(tx, actor, 'host_payout.paid', 'host_payout', p.id, {
          provider_ref: body.provider_ref,
          note: body.note ?? null,
          amount: Number(p.amount),
          currency: p.currency,
          ...(unique.length > 1 ? { batch_size: unique.length } : {}),
        });
        await emit(tx, 'host_payout', p.id, 'HostPayoutPaid', {
          host_user_id: p.host_user_id,
          amount: Number(p.amount),
          currency: p.currency,
          period_start: p.period_start,
          period_end: p.period_end,
        });
      }
    });
    const list = await rows<PayoutRow>(
      this.db,
      sql`SELECT x.* FROM (${PAYOUT_SELECT} WHERE hp.id = ANY(${pgUuidArray(unique)})) x ORDER BY x.display_name, x.id`,
    );
    return list.map((r) => this.present(r, locale));
  }
}

function csvCell(v: string): string {
  // Sof son (telefon +998…, summa) formula emas — o'zgarmaydi
  const safe = /^[=+\-@\t\r]/.test(v) && !/^[+-]?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
