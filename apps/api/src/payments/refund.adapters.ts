import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import type { Executor } from '../db/db';
import { FISCAL_ITEM_TITLE, fiscalCodes } from './fiscal';
import { MulticardClient, type MulticardPayment, type MulticardResult } from './multicard.client';

export type RefundProvider = 'payme' | 'click' | 'uzum' | 'multicard';

/** Provider tomonda bekor qilinadigan to'lov (payments qatori). */
export interface ProviderPayment {
  paymentId: string;
  bookingId: string;
  providerTransactionId: string;
  amount: number;
  /** payments.provider_state (masalan Multicard: to'lov usuli `ps`). */
  providerState?: Record<string, unknown>;
}

/**
 * Provider javobi:
 *   succeeded — pul qaytarildi (providerRefundId — provider tomondagi id);
 *   submitted — so'rov qabul qilindi, natija keyin (webhook yoki `check`);
 *   rejected  — provider rad etdi: qayta urinish foydasiz, refund admin navbatiga o'tadi.
 * Tarmoq xatolari va 5xx — exception: job keyinroq qayta urinadi.
 */
export type RefundOutcome =
  | { status: 'succeeded'; providerRefundId: string }
  | { status: 'submitted' }
  | { status: 'rejected'; error: string };

/**
 * Provider orqali refund: to'lovni to'liq bekor qilish (`reverse`). Qisman qaytarish faqat `partial` bor
 * adapterlarda (Multicard, kartadan to'langanlar); qolganlarida qisman refund'lar admin navbatida qoladi
 * (hamyonga o'tkaziladi yoki qo'lda).
 */
export interface RefundAdapter {
  readonly provider: RefundProvider;
  /** Provider'da merchant tomonidan chaqiriladigan refund API'si yo'q — sababi. */
  readonly unsupported: string | null;
  /** Avto-refund env bilan yoqilgan. */
  readonly enabled: boolean;
  reverse(p: ProviderPayment): Promise<RefundOutcome>;
  /** `submitted` so'rov holati; yo'q bo'lsa natija faqat webhook'dan keladi. */
  check?(p: ProviderPayment): Promise<RefundOutcome>;
  /** Qaytarilgani `check` orqali bilindi (webhook kelmadi) — payments.provider_state'ni moslash. */
  markReversed?(ex: Executor, p: ProviderPayment): Promise<void>;
  /**
   * Qisman refund: `amount` qaytariladi, to'lovda `remaining` qoladi. `supports` false bo'lsa (sozlanmagan yoki
   * to'lov usuli qo'llamaydi) — admin navbati (`partial`).
   */
  partial?: {
    supports(p: ProviderPayment): boolean;
    refund(p: ProviderPayment, amount: number, remaining: number): Promise<RefundOutcome>;
  };
}

export const REFUND_ADAPTERS = Symbol('REFUND_ADAPTERS');

// -----------------------------------------------------------------------------
// Payme — Subscribe API `receipts.cancel` / `receipts.check`
// -----------------------------------------------------------------------------
/** JSON-RPC "Системная ошибка" — Payme tomonidagi vaqtinchalik xato, qayta urinish mumkin. */
const PAYME_SYSTEM_ERROR = -32400;

/**
 * Payme Subscribe API (developer.help.paycom.uz/metody-subscribe-api): `receipts.cancel` to'langan chekni bekor
 * qiladi — pul kartaga qaytadi, faqat to'liq summa. Merchant API kassasida Payme bekor qilishni bizning
 * `CancelTransaction` (reason 5) orqali yakunlaydi: chek avval 21 (bekor qilish navbatida), keyin 50.
 * Merchant API tranzaksiyasining `id` si — shu chekning `_id` si (reconciliation bilan bir xil).
 */
@Injectable()
export class PaymeRefundAdapter implements RefundAdapter {
  readonly provider = 'payme' as const;
  readonly unsupported = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled() {
    return this.env.PAYME_REFUND_ENABLED;
  }

  async reverse(p: ProviderPayment): Promise<RefundOutcome> {
    const r = await this.call<{ receipt?: { state?: number } }>('receipts.cancel', { id: p.providerTransactionId });
    return 'error' in r ? r : this.outcome(r.result.receipt?.state, p);
  }

  async check(p: ProviderPayment): Promise<RefundOutcome> {
    const r = await this.call<{ state?: number }>('receipts.check', { id: p.providerTransactionId });
    return 'error' in r ? r : this.outcome(r.result.state, p);
  }

  async markReversed(ex: Executor, p: ProviderPayment) {
    await ex.execute(
      sql`UPDATE payments
             SET provider_state = provider_state || jsonb_build_object('state', -2, 'cancel_time', ${Date.now()}::bigint, 'reason', 5)
           WHERE id = ${p.paymentId} AND (provider_state->>'state')::int = 2`,
    );
  }

  /** Chek holatlari: 50 — bekor qilingan (pul qaytdi), 4 — hali to'langan (bekor qilinmadi), 21/20/… — jarayonda. */
  private outcome(state: number | undefined, p: ProviderPayment): RefundOutcome {
    if (state === 50) return { status: 'succeeded', providerRefundId: p.providerTransactionId };
    if (state === 4) return { status: 'rejected', error: 'Payme: chek bekor qilinmadi (state 4)' };
    if (state === undefined) throw new Error('Payme: javobda chek holati yo\'q');
    return { status: 'submitted' };
  }

  private async call<T>(method: string, params: Record<string, unknown>): Promise<{ result: T } | { status: 'rejected'; error: string }> {
    const res = await fetch(this.env.PAYME_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth': `${this.env.PAYME_MERCHANT_ID}:${this.env.PAYME_KEY}` },
      body: JSON.stringify({ id: Date.now(), method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Payme ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { code: number; message: unknown } };
    if (body.error) {
      const text = `Payme ${method}: ${body.error.code} ${JSON.stringify(body.error.message)}`;
      if (body.error.code === PAYME_SYSTEM_ERROR) throw new Error(text);
      return { status: 'rejected', error: text };
    }
    if (body.result === undefined) throw new Error(`Payme ${method}: javobda result yo'q`);
    return { result: body.result };
  }
}

// -----------------------------------------------------------------------------
// Click — Merchant API `DELETE payment/reversal`
// -----------------------------------------------------------------------------
/**
 * Click Merchant API (docs.click.uz/merchant-api-request): `DELETE /payment/reversal/:service_id/:payment_id` —
 * to'lovni bekor qilish, pul kartaga qaytadi; javob sinxron: `{ error_code, error_note, payment_id }`.
 * payment_id — Click'dagi to'lov id: SHOP API'ning click_trans_id'si (payments.provider_transaction_id).
 * Click SHOP API bekor qilish haqida webhook yubormaydi — natija shu javobning o'zi.
 */
@Injectable()
export class ClickRefundAdapter implements RefundAdapter {
  readonly provider = 'click' as const;
  readonly unsupported = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled() {
    return this.env.CLICK_REFUND_ENABLED;
  }

  /** `Auth: merchant_user_id:digest:timestamp`, digest = sha1(timestamp + secret_key). */
  authHeader(now = Math.floor(Date.now() / 1000)): string {
    const digest = createHash('sha1').update(`${now}${this.env.CLICK_SECRET_KEY}`).digest('hex');
    return `${this.env.CLICK_MERCHANT_USER_ID}:${digest}:${now}`;
  }

  async reverse(p: ProviderPayment): Promise<RefundOutcome> {
    const url = `${this.env.CLICK_API_URL}/payment/reversal/${this.env.CLICK_SERVICE_ID}/${encodeURIComponent(p.providerTransactionId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Auth: this.authHeader() },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 500) throw new Error(`Click payment/reversal: HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { error_code?: number; error_note?: string; payment_id?: number | string } | null;
    if (typeof body?.error_code !== 'number') throw new Error(`Click payment/reversal: HTTP ${res.status}, javob noma'lum`);
    if (body.error_code === 0) return { status: 'succeeded', providerRefundId: String(body.payment_id ?? p.providerTransactionId) };
    return { status: 'rejected', error: `Click payment/reversal: ${body.error_code} ${body.error_note ?? ''}`.trim() };
  }
}

// -----------------------------------------------------------------------------
// Uzum — merchant tomonidan refund API'si yo'q
// -----------------------------------------------------------------------------
@Injectable()
export class UzumRefundAdapter implements RefundAdapter {
  readonly provider = 'uzum' as const;
  /** Uzum Bank Merchant API (developer.uzumbank.uz/merchant) — faqat Uzum chaqiradigan webhook'lar. */
  readonly unsupported =
    "Uzum Bank Merchant API'da merchant chaqiradigan refund metodi yo'q: Uzum kabinetidan bekor qilinadi, /reverse webhook'i refund'ni yakunlaydi";
  readonly enabled = false;

  reverse(): Promise<RefundOutcome> {
    return Promise.reject(new Error(this.unsupported));
  }
}

// -----------------------------------------------------------------------------
// Multicard — `DELETE /payment/{uuid}` (to'liq), `DELETE /payment/{uuid}/partial` (qisman)
// -----------------------------------------------------------------------------
/** Kartadan to'g'ridan-to'g'ri to'lov (ilova orqali emas): qisman refund'da karta raqami so'ralmaydi. */
const MULTICARD_CARD_PS: ReadonlySet<string> = new Set(['uzcard', 'humo', 'visa', 'mastercard']);

/**
 * Multicard (docs.multicard.uz, "Отмена платежа (возврат средств)"): `DELETE /payment/{uuid}` — to'lovni bekor qilish,
 * pul kartaga qaytadi; javob sinxron (`paymentModel`, holat `revert`). uuid — callback'dagi tranzaksiya uuid'i
 * (payments.provider_transaction_id). Qisman — `DELETE /payment/{uuid}/partial` {refund_amount, ofd}: eski fiskal
 * chek bekor qilinadi, `ofd` — qolgan summaga yangi chek. Ilova (Payme, Click, …) orqali to'langanda to'liq karta
 * raqami (`card_pan`) kerak — bizda yo'q, shuning uchun qisman faqat kartadan to'langanlarda.
 */
@Injectable()
export class MulticardRefundAdapter implements RefundAdapter {
  readonly provider = 'multicard' as const;
  readonly unsupported = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly client: MulticardClient,
  ) {}

  get enabled() {
    return this.env.MULTICARD_REFUND_ENABLED && this.client.configured;
  }

  async reverse(p: ProviderPayment): Promise<RefundOutcome> {
    return this.outcome(await this.client.refund(p.providerTransactionId), p, 'revert');
  }

  async check(p: ProviderPayment): Promise<RefundOutcome> {
    return this.outcome(await this.client.payment(p.providerTransactionId), p, 'check');
  }

  async markReversed(ex: Executor, p: ProviderPayment) {
    await ex.execute(
      sql`UPDATE payments SET provider_state = provider_state || jsonb_build_object('status', 'revert', 'refund_time', ${Date.now()}::bigint)
          WHERE id = ${p.paymentId}`,
    );
  }

  readonly partial = {
    supports: (p: ProviderPayment): boolean =>
      this.env.MULTICARD_PARTIAL_REFUND_ENABLED && !!fiscalCodes(this.env) && MULTICARD_CARD_PS.has(String(p.providerState?.ps ?? '')),
    refund: async (p: ProviderPayment, amount: number, remaining: number): Promise<RefundOutcome> => {
      const codes = fiscalCodes(this.env)!;
      const r = await this.client.partialRefund(p.providerTransactionId, {
        refund_amount: amount,
        ofd: [{ qty: 1, price: remaining, total: remaining, mxik: codes.mxik, package_code: codes.packageCode, name: FISCAL_ITEM_TITLE, vat: 0 }],
      });
      if (!r.ok) return { status: 'rejected', error: `Multicard partial: ${r.code} ${r.details}`.trim() };
      return { status: 'succeeded', providerRefundId: r.data?.uuid ?? p.providerTransactionId };
    },
  };

  /** To'liq refund javobi / tekshiruvi: `revert` — qaytarildi; boshqa holat — kutilmoqda (check) yoki rad. */
  private outcome(r: MulticardResult<MulticardPayment>, p: ProviderPayment, action: 'revert' | 'check'): RefundOutcome {
    if (!r.ok) return { status: 'rejected', error: `Multicard ${action}: ${r.code} ${r.details}`.trim() };
    const status = r.data?.status;
    if (status === 'revert' || (action === 'revert' && status === undefined)) {
      return { status: 'succeeded', providerRefundId: r.data?.uuid ?? p.providerTransactionId };
    }
    if (status === 'error') return { status: 'rejected', error: `Multicard ${action}: to'lov holati ${status}` };
    return { status: 'submitted' };
  }
}
