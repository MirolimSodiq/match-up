import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import type { Locale } from '../common/i18n';
import { minorToMajorString } from '../common/money';
import { DB, type Db, rows } from '../db/db';

/** Ishga tushirilgan provider'lar. Stripe adapter'i — xalqaro bosqichda. */
export const IMPLEMENTED_PROVIDERS = ['wallet', 'payme', 'click', 'uzum'] as const;
export type CheckoutProvider = 'payme' | 'click' | 'uzum';

export interface RedirectCheckout {
  type: 'redirect';
  provider: CheckoutProvider;
  url: string;
}

const PROVIDER_NAMES: Record<string, Record<'uz-Latn' | 'ru' | 'en', string>> = {
  wallet: { 'uz-Latn': 'Hamyon', ru: 'Кошелёк', en: 'Wallet' },
  payme: { 'uz-Latn': 'Payme', ru: 'Payme', en: 'Payme' },
  click: { 'uz-Latn': 'Click', ru: 'Click', en: 'Click' },
  uzum: { 'uz-Latn': 'Uzum Bank', ru: 'Uzum Bank', en: 'Uzum Bank' },
};

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
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
    return r.map((x) => x.provider).filter((p) => (IMPLEMENTED_PROVIDERS as readonly string[]).includes(p));
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
}
