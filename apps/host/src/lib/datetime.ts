import type { AppLocale } from '@/i18n';

/**
 * Vaqtlar har doim match (venue) `timezone`'ida ko'rsatiladi, qurilma zonasida emas.
 * Oy/hafta kuni nomlari o'zimizda: Hermes/ICU'da `uz` lokali har platformada bir xil emas.
 */

const MONTHS: Record<AppLocale, string[]> = {
  'uz-Latn': ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

// 0 = yakshanba
const WEEKDAYS: Record<AppLocale, string[]> = {
  'uz-Latn': ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

const WEEKDAYS_SHORT: Record<AppLocale, string[]> = {
  'uz-Latn': ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'],
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

export interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = yakshanba
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Berilgan IANA zonadagi kalendar qismlari. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  // en-US: "10/19/2026, 19:00" — formatToParts'ga bog'lanmaslik uchun matndan o'qiymiz
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(formatterFor(timeZone).format(date));
  if (!m) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      weekday: date.getUTCDay(),
    };
  }
  const [, mo, d, y, h, mi] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  return {
    year,
    month,
    day,
    hour: Number(h) % 24,
    minute: Number(mi),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** Zona bo'yicha mahalliy vaqtni (yil, oy, kun, soat) UTC `Date` ga aylantiradi. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (ts: number) => {
    const p = zonedParts(new Date(ts), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ts;
  };
  let ts = guess - offsetAt(guess);
  // DST chegarasida offset o'zgargan bo'lsa — bir marta tuzatamiz
  const second = guess - offsetAt(ts);
  if (second !== ts) ts = second;
  return new Date(ts);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatTime(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "19-oktabr, Dushanba" / "19 октября, понедельник" / "Monday, 19 Oct" */
export function formatDay(iso: string, timeZone: string, locale: AppLocale): string {
  const p = zonedParts(new Date(iso), timeZone);
  const month = MONTHS[locale][p.month - 1];
  const weekday = WEEKDAYS[locale][p.weekday];
  if (locale === 'uz-Latn') return `${p.day}-${month}, ${weekday}`;
  if (locale === 'ru') return `${p.day} ${month}, ${weekday}`;
  return `${weekday}, ${p.day} ${month}`;
}

/** Ro'yxat kartasi uchun ixcham: "Du, 19-okt · 19:00–20:30" */
export function formatSlot(startIso: string, endIso: string, timeZone: string, locale: AppLocale): string {
  const p = zonedParts(new Date(startIso), timeZone);
  const wd = WEEKDAYS_SHORT[locale][p.weekday];
  const month = MONTHS[locale][p.month - 1]!;
  const date =
    locale === 'uz-Latn' ? `${p.day}-${month.slice(0, 3)}` : locale === 'ru' ? `${p.day} ${month.slice(0, 3)}` : `${p.day} ${month}`;
  return `${wd}, ${date} · ${formatTime(startIso, timeZone)}–${formatTime(endIso, timeZone)}`;
}

/** "19-oktabr, 18:30" — muddatlar uchun (hold, chipta). */
export function formatDateTime(iso: string, timeZone: string, locale: AppLocale): string {
  const p = zonedParts(new Date(iso), timeZone);
  const month = MONTHS[locale][p.month - 1];
  const date = locale === 'uz-Latn' ? `${p.day}-${month}` : `${p.day} ${month}`;
  return `${date}, ${formatTime(iso, timeZone)}`;
}

export function shortWeekday(date: Date, timeZone: string, locale: AppLocale): string {
  return WEEKDAYS_SHORT[locale][zonedParts(date, timeZone).weekday]!;
}

/** Zona bo'yicha `offset` kun keyingi sutka: [boshlanish, tugash) ISO, boshlanish hozirdan oldin bo'lmaydi. */
export function dayRange(timeZone: string, offset: number, now = new Date()): { from: string; to: string; date: Date } {
  const p = zonedParts(now, timeZone);
  const start = zonedTimeToUtc(p.year, p.month, p.day + offset, 0, 0, timeZone);
  const end = zonedTimeToUtc(p.year, p.month, p.day + offset + 1, 0, 0, timeZone);
  const from = start.getTime() < now.getTime() ? now : start;
  return { from: from.toISOString(), to: end.toISOString(), date: start };
}
