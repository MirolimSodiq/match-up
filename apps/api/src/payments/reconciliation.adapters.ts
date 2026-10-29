import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { MulticardClient, type MulticardStatus, parseTashkentTime } from './multicard.client';

export type ReconProvider = 'payme' | 'click' | 'uzum' | 'multicard';
export const RECON_PROVIDERS: readonly ReconProvider[] = ['payme', 'click', 'uzum', 'multicard'];

/** Provider holati bizning terminlarda: pul yechilgan / qaytarilgan / yechilmay bekor qilingan / jarayonda. */
export type ProviderTxStatus = 'succeeded' | 'refunded' | 'cancelled' | 'pending';

export interface ProviderTransaction {
  providerTransactionId: string;
  /** Minor units (tiyin). */
  amount: number;
  currency: string;
  status: ProviderTxStatus;
  /** Provider tomonda yaratilgan vaqt — davrga tegishlilik shu bo'yicha. */
  occurredAt: Date;
  bookingId: string | null;
  /** Provider'ning xom holati (reconciliation_items.details). */
  raw: Record<string, unknown>;
}

/**
 * Provider'dan davr bo'yicha tranzaksiyalar ro'yxatini oladigan adapter.
 * `unsupported` — ro'yxat olib bo'lmasa sababi (hujjatda API yo'q yoki o'chirilgan); bunday adapter
 * kechki job'da o'tkazib yuboriladi, admin qo'lda ishga tushirsa 422.
 */
export interface ReconciliationAdapter {
  readonly provider: ReconProvider;
  readonly unsupported: string | null;
  fetchTransactions(from: Date, to: Date): Promise<ProviderTransaction[]>;
}

export const RECONCILIATION_ADAPTERS = Symbol('RECONCILIATION_ADAPTERS');

// -----------------------------------------------------------------------------
// Payme — Subscribe API `receipts.get_all` (developer.help.paycom.uz/metody-subscribe-api/receipts.get_all)
// -----------------------------------------------------------------------------
interface PaymeReceipt {
  _id: string;
  create_time: number;
  pay_time: number;
  cancel_time: number;
  state: number;
  amount: number;
  currency: number;
  account?: { name: string; value: unknown }[];
}

const PAYME_PAGE = 50; // receipts.get_all: count maksimumi
const PAYME_MAX_RECEIPTS = 100_000;

/**
 * Chek holatlari (Состояния чека): 4 — to'langan, 50 — bekor qilingan (pay_time > 0 bo'lsa — to'lovdan keyin,
 * ya'ni refund), qolganlari (0–3, 5, 6, 20, 21, 30) — jarayonda.
 * Merchant API tranzaksiyasining `params.id` si — shu chekning `_id` si.
 */
export function paymeReceiptStatus(r: Pick<PaymeReceipt, 'state' | 'pay_time'>): ProviderTxStatus {
  if (r.state === 4) return 'succeeded';
  if (r.state === 50) return r.pay_time > 0 ? 'refunded' : 'cancelled';
  return 'pending';
}

@Injectable()
export class PaymeReconciliationAdapter implements ReconciliationAdapter {
  readonly provider = 'payme' as const;

  constructor(@Inject(ENV) private readonly env: Env) {}

  get unsupported(): string | null {
    return this.env.PAYME_RECONCILE_ENABLED ? null : "PAYME_RECONCILE_ENABLED=false — Payme Subscribe API kaliti sozlanmagan";
  }

  async fetchTransactions(from: Date, to: Date): Promise<ProviderTransaction[]> {
    const out: ProviderTransaction[] = [];
    for (let offset = 0; ; offset += PAYME_PAGE) {
      const res = await fetch(this.env.PAYME_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth': `${this.env.PAYME_MERCHANT_ID}:${this.env.PAYME_KEY}` },
        body: JSON.stringify({
          id: offset + 1,
          method: 'receipts.get_all',
          params: { count: PAYME_PAGE, from: from.getTime(), to: to.getTime(), offset },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Payme receipts.get_all: HTTP ${res.status}`);
      const body = (await res.json()) as { result?: PaymeReceipt[]; error?: { code: number; message: unknown } };
      if (body.error) throw new Error(`Payme receipts.get_all: ${body.error.code} ${JSON.stringify(body.error.message)}`);
      const page = body.result ?? [];
      for (const r of page) {
        const booking = r.account?.find((a) => a.name === 'booking_id')?.value;
        out.push({
          providerTransactionId: r._id,
          amount: r.amount,
          currency: r.currency === 860 ? 'UZS' : String(r.currency),
          status: paymeReceiptStatus(r),
          occurredAt: new Date(r.create_time),
          bookingId: typeof booking === 'string' ? booking : null,
          raw: { state: r.state, pay_time: r.pay_time, cancel_time: r.cancel_time },
        });
      }
      if (page.length < PAYME_PAGE) return out;
      // Himoya: provider offset'ni e'tiborsiz qoldirsa cheksiz sikl bo'lmasin
      if (offset >= PAYME_MAX_RECEIPTS) throw new Error(`Payme receipts.get_all: ${PAYME_MAX_RECEIPTS} dan ortiq chek`);
    }
  }
}

// -----------------------------------------------------------------------------
// Click va Uzum — hujjatda davr bo'yicha ro'yxat API'si yo'q (stub)
// -----------------------------------------------------------------------------
@Injectable()
export class ClickReconciliationAdapter implements ReconciliationAdapter {
  readonly provider = 'click' as const;
  /**
   * Click Merchant API (docs.click.uz/merchant-api/requests) da faqat bitta to'lov holati bor:
   * `GET /v2/merchant/payment/status/:service_id/:payment_id` va `status_by_mti/...` — summasiz, ro'yxatsiz.
   * Kunlik reyestr — merchant kabinetida (API emas).
   */
  readonly unsupported =
    "Click Merchant API'da davr bo'yicha to'lovlar ro'yxati yo'q (faqat bitta to'lov holati, summasiz); reyestr — Click merchant kabinetida";

  fetchTransactions(): Promise<ProviderTransaction[]> {
    return Promise.reject(new Error(this.unsupported));
  }
}

@Injectable()
export class UzumReconciliationAdapter implements ReconciliationAdapter {
  readonly provider = 'uzum' as const;
  /** Uzum Bank Merchant API (developer.uzumbank.uz/merchant) — faqat Uzum chaqiradigan webhook'lar. */
  readonly unsupported =
    "Uzum Bank Merchant API faqat webhook'lardan iborat (check/create/confirm/reverse/status); hisobot/reyestr API'si hujjatda yo'q";

  fetchTransactions(): Promise<ProviderTransaction[]> {
    return Promise.reject(new Error(this.unsupported));
  }
}

// -----------------------------------------------------------------------------
// Multicard — reyestr `GET /payment/store/{store_id}/history` (docs.multicard.uz, "Реестр проведенных платежей")
// -----------------------------------------------------------------------------
const MULTICARD_PAGE = 100;
const MULTICARD_MAX = 100_000;

/** success — pul yechilgan; revert — qaytarilgan; error — yechilmagan; draft/progress/billing — jarayonda. */
export function multicardTxStatus(s: MulticardStatus): ProviderTxStatus {
  if (s === 'success') return 'succeeded';
  if (s === 'revert') return 'refunded';
  if (s === 'error') return 'cancelled';
  return 'pending';
}

/**
 * Kassa bo'yicha tranzaksiyalar (davr — GMT+5, `offset`/`limit` bilan sahifalab). `uuid` — tranzaksiya uuid'i: to'langan
 * to'lovlarda payments.provider_transaction_id shu (callback'dan). `store_invoice_id` — bizning payments.id.
 */
@Injectable()
export class MulticardReconciliationAdapter implements ReconciliationAdapter {
  readonly provider = 'multicard' as const;

  constructor(private readonly client: MulticardClient) {}

  get unsupported(): string | null {
    return this.client.configured ? null : 'Multicard kalitlari (MULTICARD_APPLICATION_ID, _SECRET, _STORE_ID) sozlanmagan';
  }

  async fetchTransactions(from: Date, to: Date): Promise<ProviderTransaction[]> {
    const out: ProviderTransaction[] = [];
    for (let offset = 0; ; offset += MULTICARD_PAGE) {
      const r = await this.client.history({ from, to, offset, limit: MULTICARD_PAGE });
      if (!r.ok) throw new Error(`Multicard history: ${r.code} ${r.details}`);
      const page = r.data?.list ?? [];
      for (const t of page) {
        out.push({
          providerTransactionId: t.uuid,
          amount: t.payment_amount,
          currency: 'UZS',
          status: multicardTxStatus(t.status),
          occurredAt: parseTashkentTime(t.added_on) ?? new Date(NaN),
          bookingId: null,
          raw: { status: t.status, ps: t.ps ?? null, store_invoice_id: t.store_invoice_id ?? null, payment_time: t.payment_time ?? null, refund_time: t.refund_time ?? null },
        });
      }
      const total = r.data?.pagination?.total ?? 0;
      if (page.length < MULTICARD_PAGE || offset + page.length >= total) return out;
      if (offset >= MULTICARD_MAX) throw new Error(`Multicard history: ${MULTICARD_MAX} dan ortiq tranzaksiya`);
    }
  }
}
