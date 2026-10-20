/**
 * Push yetkazish abstraksiyasi. Hozir — Expo Push API; keyinchalik FCM / APNs adapterlari
 * shu interfeysni amalga oshiradi va `PUSH_SENDERS` ro'yxatiga qo'shiladi
 * (`device_tokens.provider` qaysi adapter ishlatilishini belgilaydi).
 */
export type PushProvider = 'expo' | 'fcm' | 'apns';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Ilova o'qiydigan ma'lumot: `url` — deep link (expo-router yo'li), id'lar. */
  data: Record<string, unknown>;
  badge?: number;
  /** Android notification channel. */
  channelId?: string;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  /** Soniyalarda: qurilma offline bo'lsa qancha vaqt saqlab turiladi. */
  ttl?: number;
}

/** Provider xatolarining normallashtirilgan kodlari (Expo nomlari asos qilib olingan). */
export const PushError = {
  DEVICE_NOT_REGISTERED: 'DeviceNotRegistered',
  MESSAGE_TOO_BIG: 'MessageTooBig',
  RATE_EXCEEDED: 'MessageRateExceeded',
  CREDENTIALS: 'InvalidCredentials',
  UNKNOWN: 'Unknown',
} as const;

/** `send` natijasi — kiruvchi xabarlar bilan bir xil tartibda. */
export type PushTicket =
  | { ok: true; id: string | null }
  | { ok: false; error: string; message?: string };

export type PushReceipt = { ok: true } | { ok: false; error: string; message?: string };

export interface PushSender {
  readonly provider: PushProvider;
  /** Tarmoq/HTTP darajasidagi xatoda throw qiladi (xabar navbatda qoladi va qayta yuboriladi). */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  /** Ticket id -> yakuniy natija. Hali tayyor bo'lmagan id'lar natijada bo'lmaydi. */
  receipts?(ids: string[]): Promise<Map<string, PushReceipt>>;
}

export const PUSH_SENDERS = Symbol('PUSH_SENDERS');
