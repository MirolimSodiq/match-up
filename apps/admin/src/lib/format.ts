import type { Lang } from './i18n';

export const DEFAULT_TZ = 'Asia/Tashkent';

// Brauzerlarning uz-Latn Intl ma'lumotlari to'liq emas ("M10", inglizcha hafta kunlari) — o'zbekcha nomlar qo'lda
const UZ_MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const UZ_WEEKDAYS = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

const intlLocale = (lang: Lang) => (lang === 'ru' ? 'ru-RU' : 'uz-Latn-UZ');

/** Vaqt zonasidagi sana qismlari. */
function zonedParts(iso: string, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day: Number(get('day')), month: Number(get('month')) - 1, weekday: wd, time: `${get('hour')}:${get('minute')}` };
}

/** Venue vaqt zonasida: "21-okt, 19:00" / "21 окт., 19:00". */
export function formatDateTime(iso: string | null | undefined, lang: Lang, tz = DEFAULT_TZ): string {
  if (!iso) return '—';
  if (lang === 'ru') {
    return new Intl.DateTimeFormat(intlLocale(lang), { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  }
  const p = zonedParts(iso, tz);
  return `${p.day}-${UZ_MONTHS[p.month]}, ${p.time}`;
}

/** "Se, 20-okt" / "вт, 20 окт." */
export function formatDate(iso: string | null | undefined, lang: Lang, tz = DEFAULT_TZ): string {
  if (!iso) return '—';
  if (lang === 'ru') return new Intl.DateTimeFormat(intlLocale(lang), { timeZone: tz, day: 'numeric', month: 'short', weekday: 'short' }).format(new Date(iso));
  const p = zonedParts(iso, tz);
  return `${UZ_WEEKDAYS[p.weekday]}, ${p.day}-${UZ_MONTHS[p.month]}`;
}

/** Kalendar kuni "2026-10-20" -> "20-okt" / "20 окт." (vaqt zonasiz). */
export function formatDay(date: string, lang: Lang): string {
  const d = new Date(date + 'T12:00:00Z');
  if (lang === 'ru') return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(d);
  return `${d.getUTCDate()}-${UZ_MONTHS[d.getUTCMonth()]}`;
}

export function formatTime(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export const formatPct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`);

export function formatInt(n: number, lang: Lang): string {
  return new Intl.NumberFormat(intlLocale(lang)).format(n);
}

/** So'm (forma) -> tiyin (API). "45 000" / "45000,5" -> 4500000 / 4500050. */
export function somToTiyin(input: string): number | null {
  const clean = input.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [int = '0', frac = ''] = clean.split('.');
  return Number(int) * 100 + Number(frac.padEnd(2, '0') || '0');
}

export const tiyinToSom = (amount: number) => amount / 100;

/** Berilgan vaqt zonasidagi offset (ms) shu lahzada: UTC + offset = mahalliy vaqt. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

/**
 * Venue vaqt zonasidagi sana + soat ("2026-10-21", "19:00") -> ISO 8601 offset bilan
 * ("2026-10-21T19:00:00+05:00"). Admin brauzerining vaqt zonasiga bog'liq emas.
 */
export function zonedToIso(date: string, time: string, tz = DEFAULT_TZ): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let offset = tzOffsetMs(naive, tz);
  offset = tzOffsetMs(naive - offset, tz); // DST chegarasida aniqlashtirish
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset) / 60000;
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${date}T${time.length === 5 ? time + ':00' : time}${sign}${hh}:${mm}`;
}

/** Venue vaqt zonasidagi bugungi sana: "2026-10-19". */
export function todayIn(tz = DEFAULT_TZ, plusDays = 0): string {
  const d = new Date(Date.now() + plusDays * 86400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Sana oralig'i (mahalliy kunlar, [from, to+1 kun)) -> API uchun ISO. */
export function dayRange(from: string, to: string, tz = DEFAULT_TZ): { date_from: string; date_to: string } {
  const next = new Date(Date.parse(to + 'T00:00:00Z') + 86400_000).toISOString().slice(0, 10);
  return { date_from: zonedToIso(from, '00:00', tz), date_to: zonedToIso(next, '00:00', tz) };
}
