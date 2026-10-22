import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { audit } from '../admin/audit';
import { money } from '../common/money';
import { OpsAlerts } from '../common/ops-alerts';
import { DB, type Db, one, rows, type Tx } from '../db/db';
import { type ProviderPayment, REFUND_ADAPTERS, type RefundAdapter, type RefundOutcome } from './refund.adapters';
import { type PendingRefund, RefundSettlement } from './refund-settlement';

/** Vaqtinchalik xatolardan keyin urinishlar soni; keyin refund admin navbatiga (`failed`). */
export const AUTO_REFUND_MAX_ATTEMPTS = 5;
/** Qayta urinish oralig'i (soniya) — urinish raqami bo'yicha. */
const RETRY_DELAYS_S = [60, 300, 1800, 7200];
/** `submitted`: provider natijasini tekshirish oralig'i va kutish chegarasi (o'tsa — `timeout`). */
const CHECK_DELAY_S = 120;
const SUBMITTED_TIMEOUT_S = 24 * 3600;
const BATCH = 20;

export type ManualReason = 'partial' | 'unsupported' | 'disabled' | 'rejected' | 'failed' | 'timeout';
/** Shu sabablarda ops guruhiga xabar: kutilmagan holat, kimdir provider kabinetida tekshirishi kerak. */
const ALERT_REASONS: ReadonlySet<ManualReason> = new Set(['rejected', 'failed', 'timeout']);

type Result = 'succeeded' | 'submitted' | 'retry' | 'manual';

interface DueRefund extends PendingRefund {
  auto_status: 'queued' | 'submitted' | null;
  auto_attempts: number;
  submitted_age_s: number | null;
  provider: string;
  pay_amount: number;
  pay_refunded: number;
  pay_status: string;
  provider_transaction_id: string | null;
  public_code: string;
}

const DUE = sql`r.status = 'pending' AND r.destination = 'original_method'
  AND (r.auto_status IS NULL OR (r.auto_status IN ('queued', 'submitted') AND r.auto_next_at <= now()))`;

/**
 * Avtomatik provider refund'i (job `provider-refunds`, har daqiqa). Kutilayotgan `original_method` refund'i:
 *   * provider refund API'si yo'q (Uzum) yoki avto-refund o'chiq — admin navbatiga (`unsupported` / `disabled`);
 *   * qisman (refund to'lovning hammasini qoplamaydi) — admin navbatiga (`partial`): admin hamyonga o'tkazadi
 *     yoki provider kabinetidan qo'lda qaytaradi;
 *   * to'liq — provider'da to'lov bekor qilinadi (Payme `receipts.cancel`, Click `payment/reversal`).
 * Provider chaqiruvi tranzaksiyadan tashqarida: Payme shu orada `CancelTransaction` webhook'ini chaqiradi va u
 * refund'ni o'zi yakunlaydi. Vaqtinchalik xato — backoff bilan qayta urinish; provider rad etsa, urinishlar
 * tugasa yoki natija 24 soatda tasdiqlanmasa — admin navbati + ops guruhiga ogohlantirish.
 */
@Injectable()
export class AutoRefunds {
  private readonly log = new Logger('AutoRefunds');
  private readonly adapters: Map<string, RefundAdapter>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REFUND_ADAPTERS) adapters: RefundAdapter[],
    private readonly settlement: RefundSettlement,
    private readonly ops: OpsAlerts,
  ) {
    this.adapters = new Map(adapters.map((a) => [a.provider, a]));
  }

  async run(): Promise<Record<Result, number> & { processed: number }> {
    const due = await rows<{ id: string }>(this.db, sql`SELECT r.id FROM refunds r WHERE ${DUE} ORDER BY r.created_at, r.id LIMIT ${BATCH}`);
    const stats: Record<Result, number> = { succeeded: 0, submitted: 0, retry: 0, manual: 0 };
    for (const { id } of due) {
      try {
        const res = await this.process(id);
        if (res) stats[res]++;
      } catch (err) {
        this.log.error(`refund ${id}: ${(err as Error).message}`);
      }
    }
    return { processed: due.length, ...stats };
  }

  /** Bitta refund: da'vo (lock ostida) -> provider (tranzaksiyadan tashqarida) -> natijani yozish. */
  async process(refundId: string): Promise<Result | null> {
    const claimed = await this.db.transaction((tx) => this.claim(tx, refundId));
    if (!claimed) return null;
    if ('manual' in claimed) return this.done(claimed);

    const { r, adapter, action } = claimed;
    const payment: ProviderPayment = {
      paymentId: r.payment_id,
      bookingId: r.booking_id,
      providerTransactionId: r.provider_transaction_id!,
      amount: r.pay_amount,
    };
    let outcome: RefundOutcome | Error;
    try {
      outcome = action === 'check' ? await adapter.check!(payment) : await adapter.reverse(payment);
    } catch (err) {
      outcome = err as Error;
    }
    return this.done(await this.db.transaction((tx) => this.apply(tx, r, adapter, payment, action, outcome)));
  }

  private async claim(tx: Tx, refundId: string) {
    const r = await one<DueRefund>(
      tx,
      sql`SELECT r.id, r.booking_id, r.payment_id, r.amount, r.currency, b.user_id,
                 r.auto_status, r.auto_attempts, extract(epoch FROM now() - r.auto_submitted_at)::int AS submitted_age_s,
                 pay.provider, pay.amount AS pay_amount, pay.refunded_amount AS pay_refunded, pay.status AS pay_status,
                 pay.provider_transaction_id, m.public_code
          FROM refunds r
          JOIN bookings b ON b.id = r.booking_id
          JOIN matches m ON m.id = b.match_id
          JOIN payments pay ON pay.id = r.payment_id
          WHERE r.id = ${refundId} AND ${DUE}
          FOR UPDATE OF r SKIP LOCKED`,
    );
    if (!r) return null;
    const adapter = this.adapters.get(r.provider);
    if (!adapter || adapter.unsupported) {
      return this.manual(tx, r, 'unsupported', adapter?.unsupported ?? `${r.provider}: provider orqali refund qilinmaydi`);
    }
    if (!adapter.enabled) return this.manual(tx, r, 'disabled', null);
    // Provider faqat butun to'lovni bekor qiladi: refund to'lovning hammasini qoplashi kerak
    if (r.pay_refunded > 0 || r.amount < r.pay_amount) return this.manual(tx, r, 'partial', null);
    if (r.pay_status !== 'succeeded' || !r.provider_transaction_id) {
      return this.manual(tx, r, 'rejected', `to'lov holati: ${r.pay_status}`);
    }

    const action = r.auto_status === 'submitted' ? ('check' as const) : ('reverse' as const);
    if (action === 'check') {
      if (!adapter.check) return this.manual(tx, r, 'timeout', "natija noma'lum (javob olinmadi) — provider kabinetida tekshiring");
      if ((r.submitted_age_s ?? 0) > SUBMITTED_TIMEOUT_S) return this.manual(tx, r, 'timeout', 'provider 24 soatda tasdiqlamadi');
    }
    // `submitted` + keyingi tekshiruv vaqti: jarayon shu yerda uzilsa ham keyingi job qayta yubormaydi, tekshiradi
    await tx.execute(
      sql`UPDATE refunds
             SET auto_status = 'submitted', auto_next_at = now() + make_interval(secs => ${CHECK_DELAY_S}),
                 auto_attempts = auto_attempts + ${action === 'reverse' ? 1 : 0},
                 auto_submitted_at = CASE WHEN ${action} = 'reverse' THEN now() ELSE auto_submitted_at END
           WHERE id = ${r.id}`,
    );
    if (action === 'reverse') r.auto_attempts++;
    return { r, adapter, action };
  }

  private async apply(
    tx: Tx,
    r: DueRefund,
    adapter: RefundAdapter,
    payment: ProviderPayment,
    action: 'reverse' | 'check',
    outcome: RefundOutcome | Error,
  ): Promise<{ result: Result; alert?: string } | null> {
    const cur = await one<{ status: string; auto_status: string | null }>(
      tx,
      sql`SELECT status, auto_status FROM refunds WHERE id = ${r.id} FOR UPDATE`,
    );
    // Shu orada webhook (Payme CancelTransaction) yoki admin yakunlagan
    if (cur!.status !== 'pending') return { result: 'succeeded' };
    if (cur!.auto_status !== 'submitted') return null;

    if (outcome instanceof Error) {
      this.log.warn(`refund ${r.id} (${r.provider} ${action}): ${outcome.message}`);
      // Tekshiruv xatosi — keyingi tekshiruv allaqachon rejalashtirilgan
      if (action === 'check') return { result: 'retry' };
      if (r.auto_attempts >= AUTO_REFUND_MAX_ATTEMPTS) return this.manual(tx, r, 'failed', outcome.message);
      const delay = RETRY_DELAYS_S[Math.min(r.auto_attempts - 1, RETRY_DELAYS_S.length - 1)]!;
      await tx.execute(
        sql`UPDATE refunds SET auto_status = 'queued', auto_next_at = now() + make_interval(secs => ${delay}), auto_error = ${outcome.message}
            WHERE id = ${r.id}`,
      );
      return { result: 'retry' };
    }
    if (outcome.status === 'submitted') return { result: 'submitted' };
    if (outcome.status === 'rejected') return this.manual(tx, r, 'rejected', outcome.error);

    await adapter.markReversed?.(tx, payment);
    await this.settlement.providerReversed(tx, r.payment_id, outcome.providerRefundId);
    await audit(tx, null, 'refund.auto_complete', 'refund', r.id, {
      provider: r.provider,
      provider_refund_id: outcome.providerRefundId,
      attempts: r.auto_attempts,
    });
    return { result: 'succeeded' };
  }

  private async manual(tx: Tx, r: DueRefund, reason: ManualReason, error: string | null) {
    await tx.execute(
      sql`UPDATE refunds SET auto_status = 'manual', manual_reason = ${reason}, auto_error = ${error}, auto_next_at = NULL
          WHERE id = ${r.id}`,
    );
    await audit(tx, null, 'refund.auto_manual', 'refund', r.id, { provider: r.provider, reason, error });
    return { manual: true as const, result: 'manual' as const, alert: ALERT_REASONS.has(reason) ? this.alertText(r, reason, error) : undefined };
  }

  /** Ogohlantirish tranzaksiya yozilgandan keyin yuboriladi; Telegram xatosi refund holatiga ta'sir qilmaydi. */
  private async done(res: { result: Result; alert?: string } | null): Promise<Result | null> {
    if (res?.alert) {
      await this.ops.send(res.alert).catch((err: Error) => this.log.error(`ops ogohlantirishi yuborilmadi: ${err.message}`));
    }
    return res?.result ?? null;
  }

  private alertText(r: DueRefund, reason: ManualReason, error: string | null): string {
    const what = { rejected: 'provider rad etdi', failed: 'urinishlar tugadi', timeout: 'provider natijani tasdiqlamadi' }[
      reason as 'rejected' | 'failed' | 'timeout'
    ];
    const link = this.ops.adminLink(`/refunds?q=${r.id}`);
    return [
      `⚠️ Refund avtomatik bajarilmadi — ${what}`,
      `O'yin ${r.public_code}, ${money(r.amount, r.currency, 'uz-Latn').formatted}, ${r.provider}`,
      error ? `Xato: ${error}` : null,
      "Provider kabinetida tekshiring va admin panelda yakunlang (bajarildi / hamyonga).",
      link,
    ]
      .filter(Boolean)
      .join('\n');
  }
}
