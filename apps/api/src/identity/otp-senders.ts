import { Logger } from '@nestjs/common';
import type { Env } from '../config/env';
import type { Locale } from '../common/i18n';

export type OtpChannel = 'sms' | 'telegram';

export interface OtpSender {
  send(phone: string, code: string, channel: OtpChannel, locale: Locale): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

export function otpText(code: string, locale: Locale): string {
  if (locale === 'ru') return `Match Up: код подтверждения ${code}. Никому не сообщайте его.`;
  if (locale === 'en') return `Match Up: your verification code is ${code}. Do not share it.`;
  return `Match Up: tasdiqlash kodi ${code}. Uni hech kimga bermang.`;
}

/** Dev: kod logga yoziladi. Production'da env validatsiyasi buni taqiqlaydi. */
export class ConsoleOtpSender implements OtpSender {
  private readonly log = new Logger('ConsoleOtpSender');

  async send(phone: string, code: string, channel: OtpChannel): Promise<void> {
    this.log.warn(`[DEV OTP] ${phone} (${channel}): ${code}`);
  }
}

/**
 * Eskiz.uz SMS. Eslatma: Eskiz faqat oldindan tasdiqlangan shablon matnlarini yuboradi —
 * otpText() dagi matnlar Eskiz kabinetida shablon sifatida ro'yxatdan o'tkazilishi kerak.
 * Telegram kanali MVP'da SMS'ga tushadi (Telegram Gateway — keyingi bosqich).
 */
export class EskizOtpSender implements OtpSender {
  private readonly log = new Logger('EskizOtpSender');
  private token?: string;
  private static readonly BASE = 'https://notify.eskiz.uz/api';

  constructor(private readonly env: Env) {
    if (!env.ESKIZ_EMAIL || !env.ESKIZ_PASSWORD) throw new Error('ESKIZ_EMAIL va ESKIZ_PASSWORD majburiy');
  }

  private async login(): Promise<string> {
    const res = await fetch(`${EskizOtpSender.BASE}/auth/login`, {
      method: 'POST',
      body: new URLSearchParams({ email: this.env.ESKIZ_EMAIL!, password: this.env.ESKIZ_PASSWORD! }),
    });
    if (!res.ok) throw new Error(`Eskiz login: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { token?: string } };
    if (!json.data?.token) throw new Error('Eskiz login: token yo\'q');
    this.token = json.data.token;
    return this.token;
  }

  async send(phone: string, code: string, _channel: OtpChannel, locale: Locale): Promise<void> {
    const body = new URLSearchParams({
      mobile_phone: phone.replace(/^\+/, ''),
      message: otpText(code, locale),
      from: this.env.ESKIZ_FROM,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = this.token ?? (await this.login());
      const res = await fetch(`${EskizOtpSender.BASE}/message/sms/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      if (res.status === 401 && attempt === 0) {
        this.token = undefined;
        continue;
      }
      if (!res.ok) {
        this.log.error(`Eskiz send: HTTP ${res.status} ${await res.text().catch(() => '')}`);
        throw new Error('SMS yuborilmadi');
      }
      return;
    }
  }
}

export function createOtpSender(env: Env): OtpSender {
  return env.OTP_PROVIDER === 'eskiz' ? new EskizOtpSender(env) : new ConsoleOtpSender();
}
