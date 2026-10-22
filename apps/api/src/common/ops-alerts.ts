import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

/**
 * Operatsiya jamoasiga tezkor ogohlantirish — Telegram ops guruhi (login uchun ishlatiladigan bot orqali).
 * Matnga telefon raqami va boshqa shaxsiy ma'lumot yozilmaydi (Telegram serverlari O'zbekistondan tashqarida):
 * ism va admin panel havolasi yetarli, qolgani panelda.
 */
@Injectable()
export class OpsAlerts {
  private readonly log = new Logger('OpsAlerts');

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Yuborildi — true; ops guruhi sozlanmagan (dev) — false, matn logga. Telegram xatosi — exception. */
  async send(text: string): Promise<boolean> {
    const { OPS_TELEGRAM_CHAT_ID: chatId, TELEGRAM_BOT_TOKEN: token } = this.env;
    if (!chatId || !token) {
      this.log.warn(`ops guruhi sozlanmagan, ogohlantirish faqat logda:\n${text}`);
      return false;
    }
    const res = await fetch(`${this.env.TELEGRAM_API_URL}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!res.ok || !body?.ok) throw new Error(`Telegram sendMessage: HTTP ${res.status} ${body?.description ?? ''}`.trim());
    return true;
  }

  /** Admin panel havolasi (ADMIN_PUBLIC_URL sozlangan bo'lsa). */
  adminLink(path: string): string | null {
    return this.env.ADMIN_PUBLIC_URL ? `${this.env.ADMIN_PUBLIC_URL.replace(/\/$/, '')}${path}` : null;
  }
}
