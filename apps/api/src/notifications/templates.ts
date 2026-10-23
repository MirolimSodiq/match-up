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
  | 'host.payout_paid'
  | 'match.new'
  | 'highlight.tagged'
  | 'highlight.ready'
  | 'highlight.shared'
  | 'recording.ready'
  | 'privacy.export_ready';

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
  /** highlight.*: host bergan klip nomi (bo'lmasligi mumkin) */
  clip?: string;
  /** highlight.shared: ulashgan o'yinchi */
  actor?: string;
  /** privacy.export_ready: yuklab olish muddati (foydalanuvchi shahri vaqt zonasida). */
  expires?: string;
  /** host.payout_paid: to'lov davri ("13–19 oktabr"). */
  period?: string;
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
  'host.payout_paid': {
    category: 'transactional',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({ title: "Haftalik to'lov o'tkazildi", body: `${p.amount} — ${p.period} kunlari o'tkazgan o'yinlaringiz uchun.` }),
      ru: (p) => ({ title: 'Выплата отправлена', body: `${p.amount} — за игры, проведённые ${p.period}.` }),
      en: (p) => ({ title: 'Payout sent', body: `${p.amount} for the games you hosted ${p.period}.` }),
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
  'highlight.tagged': {
    category: 'transactional',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({ title: "Sizni highlight'da belgilashdi", body: `${clipOf(p, '“', '”')}${p.match}, ${p.when}. Ko'rish uchun bosing.` }),
      ru: (p) => ({ title: 'Вас отметили в хайлайте', body: `${clipOf(p, '«', '»')}«${p.match}», ${p.when}. Нажмите, чтобы посмотреть.` }),
      en: (p) => ({ title: 'You were tagged in a highlight', body: `${clipOf(p, '“', '”')}${p.match}, ${p.when}. Tap to watch.` }),
    },
  },
  'highlight.ready': {
    category: 'transactional',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({ title: "O'yiningizdan highlight", body: `${clipOf(p, '“', '”')}${p.match}, ${p.when}. Klipni ko'ring!` }),
      ru: (p) => ({ title: 'Хайлайт с вашей игры', body: `${clipOf(p, '«', '»')}«${p.match}», ${p.when}. Посмотрите клип!` }),
      en: (p) => ({ title: 'A highlight from your game', body: `${clipOf(p, '“', '”')}${p.match}, ${p.when}. Watch the clip!` }),
    },
  },
  'highlight.shared': {
    category: 'transactional',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({ title: "Highlight'ingiz ulashildi", body: `${p.actor} siz belgilangan klipni ulashdi — ${p.match}, ${p.when}.` }),
      ru: (p) => ({ title: 'Вашим хайлайтом поделились', body: `${p.actor} поделился(-ась) клипом, где вы отмечены, — «${p.match}», ${p.when}.` }),
      en: (p) => ({ title: 'Your highlight was shared', body: `${p.actor} shared a clip you're tagged in — ${p.match}, ${p.when}.` }),
    },
  },
  'recording.ready': {
    category: 'transactional',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({ title: "O'yin videosi tayyor", body: `${p.match}, ${p.when} — to'liq o'yinni ko'ring va eng yaxshi lahzalarga o'ting.` }),
      ru: (p) => ({ title: 'Видео игры готово', body: `«${p.match}», ${p.when} — смотрите всю игру и лучшие моменты.` }),
      en: (p) => ({ title: 'Your game video is ready', body: `${p.match}, ${p.when} — watch the full game and jump to the best moments.` }),
    },
  },
  'privacy.export_ready': {
    category: 'transactional',
    priority: 'normal',
    text: {
      'uz-Latn': (p) => ({ title: "Ma'lumotlaringiz tayyor", body: `Shaxsiy ma'lumotlaringiz nusxasini ${p.expires} gacha yuklab olishingiz mumkin.` }),
      ru: (p) => ({ title: 'Ваши данные готовы', body: `Копию ваших персональных данных можно скачать до ${p.expires}.` }),
      en: (p) => ({ title: 'Your data is ready', body: `Download a copy of your personal data by ${p.expires}.` }),
    },
  },
};

/** `“Ajoyib gol” — ` (klip nomi bo'lsa) */
function clipOf(p: TemplateParams, open: string, close: string): string {
  return p.clip ? `${open}${p.clip}${close} — ` : '';
}

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

/** To'lov davri (sana, vaqt zonasisiz): "13–19-oktabr" | "13–19 октября" | "Oct 13 – 19". */
export function formatPeriod(start: string, end: string, locale: TextLocale | Locale): string {
  const f = new Intl.DateTimeFormat(INTL[textLocale(locale)], { timeZone: 'UTC', day: 'numeric', month: 'long' });
  return f.formatRange(new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`));
}

/** "19:00" */
export function formatTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}
