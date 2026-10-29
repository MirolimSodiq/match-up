import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, type Env, multicardConfigured } from '../config/env';
import { REDIS } from '../redis/redis.module';

/**
 * Rahmat (Multicard) to'lov shlyuzi API'si (docs.multicard.uz). Javoblar `{success, data}` yoki
 * `{success: false, error: {code, details}}`; summalar tiyin'da; vaqtlar GMT+5 (`YYYY-mm-dd H:i:s`).
 * Auth: `POST /auth` {application_id, secret} -> {token, expiry} — token 24 soat, Redis'da keshlanadi
 * (hujjat har so'rovda token olishni tavsiya etmaydi); 401 kelsa token yangilanib so'rov bir marta qaytariladi.
 */

/** Tranzaksiya holatlari (PaymentStatusEnum). */
export type MulticardStatus = 'draft' | 'progress' | 'billing' | 'success' | 'error' | 'revert';

/** Fiskal chek qatori (ofdRequest): narxlar tiyin'da, MXIK va o'lchov birligi — tasnif.soliq.uz. */
export interface OfdItem {
  qty: number;
  price: number;
  total: number;
  mxik: string;
  package_code: string;
  name: string;
  vat?: number;
}

/** paymentModel (kerakli maydonlar). */
export interface MulticardPayment {
  uuid: string;
  status: MulticardStatus;
  total_amount?: number;
  payment_amount?: number;
  store_invoice_id?: string;
  ps?: string | null;
  card_pan?: string | null;
  receipt_url?: string | null;
  payment_time?: string | null;
  refund_time?: string | null;
}

export interface MulticardInvoice {
  uuid: string;
  invoice_id: string;
  amount: number;
  checkout_url: string;
  short_link?: string | null;
  deeplink?: string | null;
  /** Invoys hali to'lanmagan bo'lsa null yoki draft. */
  payment?: MulticardPayment | null;
}

export interface HistoryItem {
  uuid: string;
  status: MulticardStatus;
  ps?: string | null;
  store_invoice_id?: string | null;
  payment_amount: number;
  payment_time?: string | null;
  refund_time?: string | null;
  added_on: string;
}

/** Multicard biznes xatosi (4xx yoki `success: false`). Tarmoq xatosi va 5xx — exception. */
export interface MulticardFailure {
  ok: false;
  status: number;
  code: string;
  details: string;
}
export type MulticardResult<T> = { ok: true; data: T } | MulticardFailure;

const TIMEOUT_MS = 20_000;
/** Token muddatidan oldinroq yangilanadi (soat farqi va uzoq so'rovlar uchun). */
const TOKEN_MARGIN_MS = 10 * 60_000;
const TOKEN_FALLBACK_TTL_MS = 23 * 3600_000;

/** `YYYY-mm-dd H:i:s` (GMT+5, Toshkent — DST yo'q) -> Date; boshqa format — ISO sifatida. */
export function parseTashkentTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2}):(\d{2})$/.exec(s.trim());
  const d = m ? new Date(`${m[1]}T${m[2]!.padStart(2, '0')}:${m[3]}:${m[4]}+05:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date -> `YYYY-mm-dd H:i:s` (GMT+5). */
export function formatTashkentTime(d: Date): string {
  return new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
}

@Injectable()
export class MulticardClient {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  get configured(): boolean {
    return multicardConfigured(this.env);
  }

  get storeId(): number {
    return this.env.MULTICARD_STORE_ID!;
  }

  private get base(): string {
    return this.env.MULTICARD_BASE_URL.replace(/\/+$/, '');
  }

  private get tokenKey(): string {
    return `multicard:token:${this.env.MULTICARD_APPLICATION_ID}`;
  }

  // ---------------------------------------------------------------------------
  // Invoys (to'lov sahifasi)
  // ---------------------------------------------------------------------------
  createInvoice(body: {
    amount: number;
    invoice_id: string;
    callback_url: string;
    return_url?: string;
    return_error_url?: string;
    lang: 'uz' | 'ru' | 'en';
    ttl: number;
    ofd?: OfdItem[];
  }): Promise<MulticardResult<MulticardInvoice>> {
    return this.call('POST', '/payment/invoice', { store_id: this.storeId, ...body });
  }

  invoice(uuid: string): Promise<MulticardResult<MulticardInvoice>> {
    return this.call('GET', `/payment/invoice/${encodeURIComponent(uuid)}`);
  }

  /** To'lanmagan invoysni bekor qilish; to'langan bo'lsa — 400. */
  cancelInvoice(uuid: string): Promise<MulticardResult<unknown>> {
    return this.call('DELETE', `/payment/invoice/${encodeURIComponent(uuid)}`);
  }

  // ---------------------------------------------------------------------------
  // To'lov (tranzaksiya)
  // ---------------------------------------------------------------------------
  payment(uuid: string): Promise<MulticardResult<MulticardPayment>> {
    return this.call('GET', `/payment/${encodeURIComponent(uuid)}`);
  }

  /** To'liq refund (to'lovni bekor qilish, pul kartaga qaytadi). */
  refund(uuid: string): Promise<MulticardResult<MulticardPayment>> {
    return this.call('DELETE', `/payment/${encodeURIComponent(uuid)}`);
  }

  /** Qisman refund: eski fiskal chek bekor qilinadi, `ofd` — qolgan summaga yangi chek. */
  partialRefund(uuid: string, body: { refund_amount: number; ofd: OfdItem[] }): Promise<MulticardResult<MulticardPayment>> {
    return this.call('DELETE', `/payment/${encodeURIComponent(uuid)}/partial`, body);
  }

  /** O'tkazilgan to'lovlar reyestri (kassa bo'yicha, sahifalab). */
  history(p: { from: Date; to: Date; offset: number; limit: number }): Promise<
    MulticardResult<{ pagination: { total: number; offset: number; limit: number }; list: HistoryItem[] }>
  > {
    const q = new URLSearchParams({
      offset: String(p.offset),
      limit: String(p.limit),
      start_date: formatTashkentTime(p.from),
      end_date: formatTashkentTime(p.to),
    });
    return this.call('GET', `/payment/store/${this.storeId}/history?${q.toString()}`);
  }

  // ---------------------------------------------------------------------------
  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, retried = false): Promise<MulticardResult<T>> {
    if (!this.configured) throw new Error('Multicard: MULTICARD_APPLICATION_ID / MULTICARD_SECRET / MULTICARD_STORE_ID sozlanmagan');
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${await this.token()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 && !retried) {
      // Token muddati tugagan yoki bekor qilingan — yangisini olib bir marta qaytaramiz
      await this.redis.del(this.tokenKey);
      return this.call(method, path, body, true);
    }
    const what = `Multicard ${method} ${path.split('?')[0]}`;
    if (res.status >= 500) throw new Error(`${what}: HTTP ${res.status}`);
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: T; error?: { code?: string; details?: unknown } }
      | null;
    if (!json || typeof json.success !== 'boolean') throw new Error(`${what}: HTTP ${res.status}, javob noma'lum`);
    if (json.success && res.ok) return { ok: true, data: json.data as T };
    return {
      ok: false,
      status: res.status,
      code: json.error?.code ?? `HTTP_${res.status}`,
      details: typeof json.error?.details === 'string' ? json.error.details : JSON.stringify(json.error?.details ?? null),
    };
  }

  /** Keshdagi token yoki yangisi (`POST /auth`). */
  private async token(): Promise<string> {
    const cached = await this.redis.get(this.tokenKey);
    if (cached) return cached;
    const res = await fetch(`${this.base}/auth`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ application_id: this.env.MULTICARD_APPLICATION_ID, secret: this.env.MULTICARD_SECRET }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Auth javobi `{success, data}` ga o'ralmagan: {token, role, expiry}
    const json = (await res.json().catch(() => null)) as { token?: string; expiry?: string } | null;
    if (!res.ok || !json?.token) throw new Error(`Multicard /auth: HTTP ${res.status}${res.ok ? ", javobda token yo'q" : ''}`);
    const expiry = parseTashkentTime(json.expiry);
    const ttl = expiry ? expiry.getTime() - Date.now() - TOKEN_MARGIN_MS : TOKEN_FALLBACK_TTL_MS;
    if (ttl > 0) await this.redis.set(this.tokenKey, json.token, 'PX', Math.min(ttl, TOKEN_FALLBACK_TTL_MS));
    return json.token;
  }
}
