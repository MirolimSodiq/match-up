import { Inject, Injectable, Logger } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { type Actor, audit } from '../admin/audit';
import { joinList } from '../admin/schemas';
import { AppError } from '../common/errors';
import type { Locale } from '../common/i18n';
import { money } from '../common/money';
import { emit } from '../common/outbox';
import { DB, type Db, iso, one, pgError, PG, rows, type Tx } from '../db/db';
import {
  type ProviderTransaction,
  type ProviderTxStatus,
  RECONCILIATION_ADAPTERS,
  type ReconciliationAdapter,
  type ReconProvider,
} from './reconciliation.adapters';

export type DiffKind = 'missing_at_provider' | 'missing_locally' | 'amount_mismatch' | 'status_mismatch';

/** Provider vaqti va bizning `created_at` orasidagi siljish: chegaradagi tranzaksiyalar "yo'q" deb chiqmasin. */
const WINDOW_PAD_MS = 60 * 60_000;
/** Solishtiriladigan bizning to'lovlar (davr ichida yaratilgan, yakuniy holatda). */
const FINAL_STATUSES = ['succeeded', 'partially_refunded', 'refunded', 'cancelled'] as const;

interface LocalPayment {
  id: string;
  provider_transaction_id: string;
  booking_id: string;
  amount: number;
  currency: string;
  status: string;
  in_window: boolean;
}

export interface Diff {
  kind: DiffKind;
  paymentId: string | null;
  providerTransactionId: string;
  bookingId: string | null;
  currency: string | null;
  localAmount: number | null;
  providerAmount: number | null;
  localStatus: string | null;
  providerStatus: ProviderTxStatus | null;
  details: Record<string, unknown>;
}

/** payments.status -> provider terminlari. */
export function normalizeLocalStatus(status: string): ProviderTxStatus {
  if (status === 'succeeded' || status === 'partially_refunded') return 'succeeded';
  if (status === 'refunded') return 'refunded';
  if (status === 'cancelled' || status === 'failed' || status === 'expired') return 'cancelled';
  return 'pending';
}

/**
 * Bizning to'lovlar ↔ provider tranzaksiyalari (Payme `GetStatement` uslubida, `provider_transaction_id` bo'yicha):
 * - bizda bor (davr ichida, yakuniy holat), providerda yo'q -> missing_at_provider;
 * - providerda pul harakati bor (succeeded/refunded), bizda yo'q -> missing_locally;
 * - ikkalasida bor: summa farqi -> amount_mismatch; holat farqi (provider holati yakuniy bo'lsa) -> status_mismatch.
 * `remote` padding bilan kengroq davrdan olinadi; ikkala tomoni ham davrdan tashqaridagilar e'tiborga olinmaydi.
 */
export function diffTransactions(local: LocalPayment[], remote: ProviderTransaction[], from: Date, to: Date) {
  const byTx = new Map(local.map((l) => [l.provider_transaction_id, l]));
  const seenLocal = new Set<string>();
  const seenRemote = new Set<string>();
  const diffs: Diff[] = [];
  let providerCount = 0;
  let matched = 0;

  for (const r of remote) {
    if (seenRemote.has(r.providerTransactionId)) continue; // sahifalar orasidagi dublikat
    seenRemote.add(r.providerTransactionId);
    const inWindow = r.occurredAt >= from && r.occurredAt < to;
    if (inWindow) providerCount++;
    const l = byTx.get(r.providerTransactionId);
    if (!l) {
      if (inWindow && (r.status === 'succeeded' || r.status === 'refunded')) {
        diffs.push({
          kind: 'missing_locally',
          paymentId: null,
          providerTransactionId: r.providerTransactionId,
          bookingId: r.bookingId,
          currency: r.currency,
          localAmount: null,
          providerAmount: r.amount,
          localStatus: null,
          providerStatus: r.status,
          details: r.raw,
        });
      }
      continue;
    }
    seenLocal.add(l.id);
    if (!inWindow && !l.in_window) continue;
    matched++;
    const base = {
      paymentId: l.id,
      providerTransactionId: r.providerTransactionId,
      bookingId: l.booking_id,
      currency: l.currency,
      localAmount: l.amount,
      providerAmount: r.amount,
      localStatus: l.status,
      providerStatus: r.status,
      details: r.raw,
    };
    if (l.amount !== r.amount || l.currency !== r.currency) diffs.push({ kind: 'amount_mismatch', ...base });
    // Provider'da hali jarayonda (masalan, Payme chek "bekor qilish navbatida") — ertangi solishtirishda ko'rinadi
    if (r.status !== 'pending' && normalizeLocalStatus(l.status) !== r.status) diffs.push({ kind: 'status_mismatch', ...base });
  }

  const finals: readonly string[] = FINAL_STATUSES;
  let localCount = 0;
  for (const l of local) {
    if (!l.in_window || !finals.includes(l.status)) continue;
    localCount++;
    if (seenLocal.has(l.id)) continue;
    diffs.push({
      kind: 'missing_at_provider',
      paymentId: l.id,
      providerTransactionId: l.provider_transaction_id,
      bookingId: l.booking_id,
      currency: l.currency,
      localAmount: l.amount,
      providerAmount: null,
      localStatus: l.status,
      providerStatus: null,
      details: {},
    });
  }
  return { diffs, localCount, providerCount, matched };
}

/** Asia/Tashkent (UTC+5, DST yo'q) bo'yicha oldingi kun: [kecha 00:00, bugun 00:00). */
export function previousTashkentDay(now = new Date()): { from: Date; to: Date } {
  const offset = 5 * 3600_000;
  const day = 86_400_000;
  const startToday = Math.floor((now.getTime() + offset) / day) * day - offset;
  return { from: new Date(startToday - day), to: new Date(startToday) };
}

interface RunRow {
  id: string;
  provider: string;
  period_from: string;
  period_to: string;
  status: string;
  trigger: string;
  triggered_by: string | null;
  triggered_by_name: string | null;
  local_count: number;
  provider_count: number;
  matched_count: number;
  diff_count: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  kinds: Record<string, number> | null;
  total?: number;
}

interface ItemRow {
  id: string;
  kind: DiffKind;
  payment_id: string | null;
  provider_transaction_id: string | null;
  booking_id: string | null;
  currency: string | null;
  local_amount: number | null;
  provider_amount: number | null;
  local_status: string | null;
  provider_status: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface RunFilter {
  provider?: string[];
  status?: string[];
  has_diffs?: boolean;
  date_from?: string;
  date_to?: string;
  limit: number;
  offset: number;
}

const RUN_SELECT = sql`
  SELECT r.id, r.provider, r.period_from, r.period_to, r.status, r.trigger, r.triggered_by, u.display_name AS triggered_by_name,
         r.local_count, r.provider_count, r.matched_count, r.diff_count, r.error, r.started_at, r.finished_at,
         (SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT kind, count(*)::int AS n FROM reconciliation_items i
                                                     WHERE i.run_id = r.id GROUP BY kind) k) AS kinds
  FROM reconciliation_runs r
  LEFT JOIN users u ON u.id = r.triggered_by`;

@Injectable()
export class ReconciliationService {
  private readonly log = new Logger('Reconciliation');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RECONCILIATION_ADAPTERS) private readonly adapters: ReconciliationAdapter[],
  ) {}

  adapter(provider: ReconProvider): ReconciliationAdapter | undefined {
    return this.adapters.find((a) => a.provider === provider);
  }

  /** Davr bo'yicha ro'yxat bera oladigan adapter'lar (kechki job shularni aylanadi). */
  supported(): ReconciliationAdapter[] {
    return this.adapters.filter((a) => a.unsupported === null);
  }

  /** Kechki job: barcha qo'llab-quvvatlanadigan provider'lar, oldingi Toshkent kuni. */
  async nightly(now = new Date()) {
    const { from, to } = previousTashkentDay(now);
    const out: { provider: string; status: string; diffs: number }[] = [];
    for (const a of this.supported()) {
      const run = await this.run(a.provider, from, to, null);
      out.push({ provider: run.provider, status: run.status, diffs: run.diff_count });
    }
    return out;
  }

  /**
   * Bitta provider + davr. Run qatori (va qo'lda bo'lsa audit) alohida tranzaksiyada yaratiladi; provider API
   * tashqarida chaqiriladi; farqlar, ularning audit_logs va outbox yozuvlari, run yakuni — bitta tranzaksiyada.
   * Provider xatosi -> run `failed` (`error` bilan).
   */
  async run(provider: ReconProvider, from: Date, to: Date, actor: Actor | null): Promise<RunRow> {
    const adapter = this.adapter(provider);
    if (!adapter || adapter.unsupported !== null) throw new Error(`reconciliation: ${provider} qo'llab-quvvatlanmaydi`);
    let runId: string;
    try {
      runId = await this.db.transaction(async (tx) => {
        const r = await one<{ id: string }>(
          tx,
          sql`INSERT INTO reconciliation_runs (provider, period_from, period_to, trigger, triggered_by)
              VALUES (${provider}, ${from.toISOString()}, ${to.toISOString()}, ${actor ? 'manual' : 'schedule'}, ${actor?.id ?? null})
              RETURNING id`,
        );
        if (actor) {
          await audit(tx, actor, 'reconciliation.run', 'reconciliation_run', r!.id, {
            provider,
            period_from: from.toISOString(),
            period_to: to.toISOString(),
          });
        }
        return r!.id;
      });
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) throw new AppError('INVALID_STATE');
      throw err;
    }

    try {
      const remote = await adapter.fetchTransactions(new Date(from.getTime() - WINDOW_PAD_MS), new Date(to.getTime() + WINDOW_PAD_MS));
      await this.db.transaction(async (tx) => {
        const local = await this.localPayments(tx, provider, from, to, remote);
        const result = diffTransactions(local, remote, from, to);
        for (const d of result.diffs) await this.record(tx, runId, provider, d, actor);
        await tx.execute(
          sql`UPDATE reconciliation_runs SET status = 'completed', finished_at = now(), local_count = ${result.localCount},
                     provider_count = ${result.providerCount}, matched_count = ${result.matched}, diff_count = ${result.diffs.length}
              WHERE id = ${runId}`,
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`${provider} reconciliation xato: ${message}`);
      await this.db.execute(
        sql`UPDATE reconciliation_runs SET status = 'failed', finished_at = now(), error = ${message.slice(0, 2000)} WHERE id = ${runId}`,
      );
    }
    return (await this.runRow(runId))!;
  }

  private async localPayments(tx: Tx, provider: ReconProvider, from: Date, to: Date, remote: ProviderTransaction[]) {
    const ids = JSON.stringify([...new Set(remote.map((r) => r.providerTransactionId))]);
    return rows<LocalPayment>(
      tx,
      sql`SELECT id, provider_transaction_id, booking_id, amount, currency, status::text AS status,
                 (created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz) AS in_window
          FROM payments
          WHERE provider = ${provider}::payment_provider AND provider_transaction_id IS NOT NULL
            AND ((created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz
                  AND status = ANY(string_to_array(${joinList(FINAL_STATUSES)}, ',')::payment_status[]))
                 OR provider_transaction_id IN (SELECT jsonb_array_elements_text(${ids}::jsonb)))`,
    );
  }

  /** Farq: reconciliation_items + audit_logs + outbox (ReconciliationMismatch) — bitta tranzaksiyada. */
  private async record(tx: Tx, runId: string, provider: ReconProvider, d: Diff, actor: Actor | null) {
    const item = await one<{ id: string }>(
      tx,
      sql`INSERT INTO reconciliation_items (run_id, kind, payment_id, provider_transaction_id, booking_id, currency,
                                            local_amount, provider_amount, local_status, provider_status, details)
          VALUES (${runId}, ${d.kind}, ${d.paymentId}, ${d.providerTransactionId},
                  ${d.bookingId && /^[0-9a-f-]{36}$/i.test(d.bookingId) ? d.bookingId : null},
                  (SELECT code FROM currencies WHERE code = ${d.currency}), ${d.localAmount}, ${d.providerAmount},
                  ${d.localStatus}, ${d.providerStatus}, ${JSON.stringify(d.details)}::jsonb)
          RETURNING id`,
    );
    const payload = {
      run_id: runId,
      provider,
      kind: d.kind,
      payment_id: d.paymentId,
      provider_transaction_id: d.providerTransactionId,
      booking_id: d.bookingId,
      currency: d.currency,
      local_amount: d.localAmount,
      provider_amount: d.providerAmount,
      local_status: d.localStatus,
      provider_status: d.providerStatus,
    };
    await audit(tx, actor, 'reconciliation.mismatch', 'reconciliation_item', item!.id, payload);
    await emit(tx, 'reconciliation', item!.id, 'ReconciliationMismatch', payload);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------
  private async runRow(id: string): Promise<RunRow | undefined> {
    return one<RunRow>(this.db, sql`${RUN_SELECT} WHERE r.id = ${id}`);
  }

  presentRun(r: RunRow) {
    return {
      id: r.id,
      provider: r.provider,
      period: { from: iso(r.period_from), to: iso(r.period_to) },
      status: r.status,
      trigger: r.trigger,
      triggered_by: r.triggered_by ? { id: r.triggered_by, display_name: r.triggered_by_name } : null,
      counts: { local: r.local_count, provider: r.provider_count, matched: r.matched_count, diffs: r.diff_count },
      diffs_by_kind: {
        missing_at_provider: r.kinds?.missing_at_provider ?? 0,
        missing_locally: r.kinds?.missing_locally ?? 0,
        amount_mismatch: r.kinds?.amount_mismatch ?? 0,
        status_mismatch: r.kinds?.status_mismatch ?? 0,
      },
      error: r.error,
      started_at: iso(r.started_at),
      finished_at: iso(r.finished_at),
    };
  }

  private presentItem(i: ItemRow, locale: Locale) {
    const amount = (v: number | null) => (v === null || !i.currency ? null : money(v, i.currency, locale));
    return {
      id: i.id,
      kind: i.kind,
      payment_id: i.payment_id,
      provider_transaction_id: i.provider_transaction_id,
      booking_id: i.booking_id,
      local: { amount: amount(i.local_amount), status: i.local_status },
      provider: { amount: amount(i.provider_amount), status: i.provider_status },
      details: i.details,
      created_at: iso(i.created_at),
    };
  }

  async list(f: RunFilter) {
    const conds: SQL[] = [sql`true`];
    if (f.provider?.length) conds.push(sql`r.provider = ANY(string_to_array(${joinList(f.provider)}, ',')::payment_provider[])`);
    if (f.status?.length) conds.push(sql`r.status = ANY(string_to_array(${joinList(f.status)}, ',')::reconciliation_run_status[])`);
    if (f.has_diffs !== undefined) conds.push(f.has_diffs ? sql`r.diff_count > 0` : sql`r.diff_count = 0`);
    if (f.date_from) conds.push(sql`r.period_to > ${f.date_from}::timestamptz`);
    if (f.date_to) conds.push(sql`r.period_from < ${f.date_to}::timestamptz`);
    const list = await rows<RunRow>(
      this.db,
      sql`SELECT x.*, count(*) OVER ()::int AS total FROM (${RUN_SELECT} WHERE ${sql.join(conds, sql` AND `)}) x
          ORDER BY x.started_at DESC, x.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
    );
    return { items: list.map((r) => this.presentRun(r)), total: list[0]?.total ?? 0 };
  }

  async detail(id: string, locale: Locale) {
    const run = await this.runRow(id);
    if (!run) throw new AppError('NOT_FOUND');
    const items = await rows<ItemRow>(
      this.db,
      sql`SELECT id, kind, payment_id, provider_transaction_id, booking_id, currency, local_amount, provider_amount,
                 local_status, provider_status, details, created_at
          FROM reconciliation_items WHERE run_id = ${id} ORDER BY created_at, id`,
    );
    return { ...this.presentRun(run), items: items.map((i) => this.presentItem(i, locale)) };
  }
}
