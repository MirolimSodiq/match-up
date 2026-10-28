import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import type { Locale } from '../common/i18n';
import { minorToMajorString } from '../common/money';
import { DB, type Db, rows } from '../db/db';
import { FISCAL_ITEM_TITLE, fiscalCodes } from '../payments/fiscal';
import { MulticardClient } from '../payments/multicard.client';

/** Ishga tushirilgan provider'lar. Stripe adapter'i — xalqaro bosqichda. */
export const IMPLEMENTED_PROVIDERS = ['wallet', 'payme', 'click', 'uzum', 'multicard'] as const;
/** Checkout havolasi deterministik yasaladi (provider bizni chaqiradi). Multicard'da havola invoys javobidan. */
export type CheckoutProvider = 'payme' | 'click' | 'uzum';

export interface RedirectCheckout {
  type: 'redirect';
  provider: CheckoutProvider | 'multicard';
  url: string;
}

/** Multicard invoysi: `uuid` -> payments.provider_transaction_id, `checkout_url` -> payments.checkout_url. */
export interface MulticardCheckout extends RedirectCheckout {
  provider: 'multicard';
  invoiceUuid: string;
  lang: 'uz' | 'ru' | 'en';
  ttl: number;
}

/** Invoys yaratilmadi (Multicard rad etdi yoki javob bermadi). */
export class InvoiceError extends Error {}

const PROVIDER_NAMES: Record<string, Record<'uz-Latn' | 'ru' | 'en', string>> = {
  wallet: { 'uz-Latn': 'Hamyon', ru: 'Кошелёк', en: 'Wallet' },
  payme: { 'uz-Latn': 'Payme', ru: 'Payme', en: 'Payme' },
  click: { 'uz-Latn': 'Click', ru: 'Click', en: 'Click' },
  uzum: { 'uz-Latn': 'Uzum Bank', ru: 'Uzum Bank', en: 'Uzum Bank' },
  multicard: { 'uz-Latn': 'Rahmat', ru: 'Rahmat', en: 'Rahmat' },
};

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    private readonly multicard: MulticardClient,
  ) {}

  /** Match davlati va valyutasi uchun yoqilgan va ishga tushirilgan provider'lar (priority bo'yicha). */
  async availableProviders(matchId: string): Promise<string[]> {
    const r = await rows<{ provider: string }>(
      this.db,
      sql`SELECT ppc.provider
          FROM matches m
          JOIN cities c ON c.id = m.city_id
          JOIN payment_provider_configs ppc ON ppc.country_code = c.country_code
          WHERE m.id = ${matchId} AND ppc.is_enabled AND m.currency = ANY(ppc.currencies)
          ORDER BY ppc.priority`,
    );
    return r
      .map((x) => x.provider)
      .filter((p) => (IMPLEMENTED_PROVIDERS as readonly string[]).includes(p))
      .filter((p) => p !== 'multicard' || this.multicard.configured);
  }

  displayName(provider: string, locale: Locale): string {
    const n = PROVIDER_NAMES[provider];
    if (!n) return provider;
    return locale === 'ru' ? n.ru : locale === 'en' ? n.en : n['uz-Latn'];
  }

  /**
   * Payme: https://checkout.paycom.uz/<base64("m=..;ac.booking_id=..;a=<tiyin>;l=uz;c=<return>")>
   * Click: https://my.click.uz/services/pay?service_id=..&merchant_id=..&amount=<so'm>&transaction_param=<booking>
   * Uzum: https://www.uzumbank.uz/open-service?serviceId=..&booking_id=<booking>&amount=<tiyin> — Uzum Bank ilovasida
   *   servisni ochadi, to'lov Merchant API webhook'lari (/check, /create, /confirm) orqali. Havola formati Uzum'ning
   *   rasmiy Merchant API hujjatida yo'q — ulanishda Uzum menejeri bilan tasdiqlanadi (UZUM_CHECKOUT_URL, UZUM_ACCOUNT_PARAM).
   */
  buildRedirect(provider: CheckoutProvider, p: { bookingId: string; amount: number; currency: string; returnUrl?: string; locale: Locale }): RedirectCheckout {
    if (provider === 'payme') {
      const lang = p.locale === 'ru' ? 'ru' : p.locale === 'en' ? 'en' : 'uz';
      const params = [`m=${this.env.PAYME_MERCHANT_ID}`, `ac.booking_id=${p.bookingId}`, `a=${p.amount}`, `l=${lang}`];
      if (p.returnUrl) params.push(`c=${p.returnUrl}`);
      const encoded = Buffer.from(params.join(';')).toString('base64');
      return { type: 'redirect', provider, url: `${this.env.PAYME_CHECKOUT_URL}/${encoded}` };
    }
    if (provider === 'uzum') {
      const q = new URLSearchParams({
        serviceId: String(this.env.UZUM_SERVICE_ID),
        [this.env.UZUM_ACCOUNT_PARAM]: p.bookingId,
        amount: String(p.amount),
      });
      return { type: 'redirect', provider, url: `${this.env.UZUM_CHECKOUT_URL}?${q.toString()}` };
    }
    const q = new URLSearchParams({
      service_id: this.env.CLICK_SERVICE_ID,
      merchant_id: this.env.CLICK_MERCHANT_ID,
      amount: minorToMajorString(p.amount, p.currency),
      transaction_param: p.bookingId,
    });
    if (p.returnUrl) q.set('return_url', p.returnUrl);
    return { type: 'redirect', provider, url: `${this.env.CLICK_CHECKOUT_URL}?${q.toString()}` };
  }

  /**
   * Multicard: server-to-server invoys (`POST /payment/invoice`). `invoice_id` — bizning payments.id (callback shu bilan
   * keladi), `ttl` — hold muddati (to'lanmasa Multicard invoysni o'zi bekor qiladi), `ofd` — fiskal chek (MXIK sozlangan
   * bo'lsa; bo'lmasa kassaning standart MXIK'i). DB tranzaksiyasidan tashqarida chaqiriladi.
   */
  async createInvoice(p: { paymentId: string; amount: number; returnUrl?: string; locale: Locale }): Promise<MulticardCheckout> {
    const lang = p.locale === 'ru' ? 'ru' : p.locale === 'en' ? 'en' : 'uz';
    const ttl = this.env.HOLD_MINUTES * 60;
    const codes = fiscalCodes(this.env);
    const r = await this.multicard
      .createInvoice({
        amount: p.amount,
        invoice_id: p.paymentId,
        callback_url: `${this.env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/v1/webhooks/multicard`,
        ...(p.returnUrl ? { return_url: p.returnUrl, return_error_url: p.returnUrl } : {}),
        lang,
        ttl,
        ...(codes
          ? { ofd: [{ qty: 1, price: p.amount, total: p.amount, mxik: codes.mxik, package_code: codes.packageCode, name: FISCAL_ITEM_TITLE, vat: 0 }] }
          : {}),
      })
      .catch((err: Error) => {
        throw new InvoiceError(err.message);
      });
    if (!r.ok) throw new InvoiceError(`Multicard invoys: ${r.code} ${r.details}`);
    if (!r.data?.uuid || !r.data.checkout_url) throw new InvoiceError("Multicard invoys: javobda uuid yoki checkout_url yo'q");
    return { type: 'redirect', provider: 'multicard', url: r.data.checkout_url, invoiceUuid: r.data.uuid, lang, ttl };
  }

  /** Ortiqcha yoki keraksiz invoysni bekor qilish (xato e'tiborsiz — Multicard `ttl` dan keyin o'zi bekor qiladi). */
  async cancelInvoice(uuid: string): Promise<boolean> {
    const r = await this.multicard.cancelInvoice(uuid).catch(() => null);
    return !!r?.ok;
  }
}
