import type { Locale } from '../common/i18n';

/**
 * Push / in-app xabar matnlari. Til — `users.locale` (uz-Cyrl hozircha uz-Latn matnini oladi).
 * Tranzaksion xabarlar har doim yuboriladi; `marketing` — faqat `marketing_push` consent bo'lsa.
 */
export type NotificationType =
  | 'booking.confirmed'
  | 'booking.cancelled'
  | 'refund.issued'
  | 'match.cancelled'
  | 'match.rate'
  | 'match.reminder_24h'
  | 'match.reminder_2h'
  | 'waitlist.offer'
  | 'host.offer'
  | 'match.new';

export type NotificationCategory = 'transactional' | 'marketing';
export type TextLocale = 'uz-Latn' | 'ru' | 'en';

export interface TemplateParams {
  match?: string;
  when?: string;
  time?: string;
  venue?: string;
  address?: string;
  amount?: string;
  fee?: string;
  /** refund.issued: 'wallet' | 'original_method' */
  destination?: string;
}

type Render = (p: TemplateParams) => { title: string; body: string };

interface Template {
  category: NotificationCategory;
  /** Android channel / iOS ko'rinishi uchun ustuvorlik. */
  priority: 'normal' | 'high';
  text: Record<TextLocale, Render>;
}

export const TEMPLATES: Record<NotificationType, Template> = {
  'booking.confirmed': {
    category: 'transactional',
    priority: 'high',
    text: {
      'uz-Latn': (p) => ({ title: 'Joy band qilindi', body: `${p.match} — ${p.when}, ${p.venue}. Chiptangiz ilovada.` }),
      ru: (p) => ({ title: 'Место забронировано', body: `${p.match} — ${p.when}, ${p.venue}. Билет в приложении.` }),
      en: (p) => ({ title: "You're in!", body: `${p.match} — ${p.when}, ${p.venue}. Your ticket is in the app.` }),
    },
  },
  'booking.cancelled': {
    category: 'transactional',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({ title: 'Band bekor qilindi', body: `${p.match} (${p.when}) uchun bandingiz bekor qilindi.` }),
      ru: (p) => ({ title: 'Бронь отменена', body: `Ваша бронь на «${p.match}» (${p.when}) отменена.` }),
      en: (p) => ({ title: 'Booking cancelled', body: `Your booking for ${p.match} (${p.when}) was cancelled.` }),
    },
  },
  'refund.issued': {
    category: 'transactional',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({
        title: "Pul qaytarildi",
        body: p.destination === 'wallet'
          ? `${p.amount} hamyoningizga qaytarildi — ${p.match}.`
          : `${p.amount} kartangizga qaytarildi — ${p.match}.`,
      }),
      ru: (p) => ({
        title: 'Возврат средств',
        body: p.destination === 'wallet'
          ? `${p.amount} зачислено на кошелёк — «${p.match}».`
          : `${p.amount} возвращено на карту — «${p.match}».`,
      }),
      en: (p) => ({
        title: 'Refund issued',
        body: p.destination === 'wallet'
          ? `${p.amount} was credited to your wallet — ${p.match}.`
          : `${p.amount} was refunded to your card — ${p.match}.`,
      }),
    },
  },
  'match.cancelled': {
    category: 'transactional',
    priority: 'high',
    text: {
      'uz-Latn': (p) => ({ title: "O'yin bekor qilindi", body: `${p.match} (${p.when}) bekor qilindi. To'lov to'liq qaytariladi.` }),
      ru: (p) => ({ title: 'Игра отменена', body: `«${p.match}» (${p.when}) отменена. Оплата будет возвращена полностью.` }),
      en: (p) => ({ title: 'Match cancelled', body: `${p.match} (${p.when}) was cancelled. You'll get a full refund.` }),
    },
  },
  'match.rate': {
    category: 'transactional',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({ title: "O'yin qanday o'tdi?", body: `${p.match} yakunlandi. O'yinchilar va host'ni baholang.` }),
      ru: (p) => ({ title: 'Как прошла игра?', body: `«${p.match}» завершена. Оцените игроков и ведущего.` }),
      en: (p) => ({ title: 'How was the game?', body: `${p.match} is over. Rate the players and your host.` }),
    },
  },
  'match.reminder_24h': {
    category: 'transactional',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({ title: "Ertaga o'yin", body: `${p.match} — ${p.when}, ${p.venue}. Manzil: ${p.address}.` }),
      ru: (p) => ({ title: 'Игра завтра', body: `«${p.match}» — ${p.when}, ${p.venue}. Адрес: ${p.address}.` }),
      en: (p) => ({ title: 'Game tomorrow', body: `${p.match} — ${p.when}, ${p.venue}. Address: ${p.address}.` }),
    },
  },
  'match.reminder_2h': {
    category: 'transactional',
    priority: 'high',
    text: {
      'uz-Latn': (p) => ({ title: "2 soatdan keyin o'yin", body: `${p.match} — soat ${p.time}, ${p.venue}. Chiptangizni tayyorlab qo'ying.` }),
      ru: (p) => ({ title: 'Игра через 2 часа', body: `«${p.match}» — в ${p.time}, ${p.venue}. Приготовьте билет.` }),
      en: (p) => ({ title: 'Game in 2 hours', body: `${p.match} — at ${p.time}, ${p.venue}. Have your ticket ready.` }),
    },
  },
  'waitlist.offer': {
    category: 'transactional',
    priority: 'high',
    text: {
      'uz-Latn': (p) => ({ title: "Joy bo'shadi!", body: `${p.match} — ${p.when}. Joy 10 daqiqa siz uchun saqlanadi.` }),
      ru: (p) => ({ title: 'Освободилось место!', body: `«${p.match}» — ${p.when}. Место закреплено за вами на 10 минут.` }),
      en: (p) => ({ title: 'A spot opened up!', body: `${p.match} — ${p.when}. It's held for you for 10 minutes.` }),
    },
  },
  'host.offer': {
    category: 'transactional',
    priority: 'high',
    text: {
      'uz-Latn': (p) => ({ title: 'Yangi taklif', body: `${p.match} — ${p.when}, ${p.venue}. Haq: ${p.fee}. 10 daqiqa ichida javob bering.` }),
      ru: (p) => ({ title: 'Новое предложение', body: `«${p.match}» — ${p.when}, ${p.venue}. Оплата: ${p.fee}. Ответьте в течение 10 минут.` }),
      en: (p) => ({ title: 'New match offer', body: `${p.match} — ${p.when}, ${p.venue}. Fee: ${p.fee}. Reply within 10 minutes.` }),
    },
  },
  'match.new': {
    category: 'marketing',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({ title: "Yangi o'yin", body: `${p.match} — ${p.when}, ${p.venue}. Joylar cheklangan.` }),
      ru: (p) => ({ title: 'Новая игра', body: `«${p.match}» — ${p.when}, ${p.venue}. Мест немного.` }),
      en: (p) => ({ title: 'New game near you', body: `${p.match} — ${p.when}, ${p.venue}. Spots are limited.` }),
    },
  },
};

export function textLocale(locale: string | null | undefined): TextLocale {
  if (locale === 'ru' || locale === 'en') return locale;
  return 'uz-Latn';
}

export function render(type: NotificationType, locale: TextLocale, params: TemplateParams) {
  return TEMPLATES[type].text[locale](params);
}

const INTL: Record<TextLocale, string> = { 'uz-Latn': 'uz-Latn', ru: 'ru', en: 'en' };

/** "21-oktabr, 19:00" | "21 октября в 19:00" | "October 21 at 19:00" — venue vaqt zonasida. */
export function formatWhen(at: Date, timeZone: string, locale: TextLocale | Locale): string {
  return new Intl.DateTimeFormat(INTL[textLocale(locale)], {
    timeZone,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/** "19:00" */
export function formatTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}
