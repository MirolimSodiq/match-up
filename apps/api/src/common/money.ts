import type { Locale } from './i18n';

export interface Money {
  amount: number;
  currency: string;
  formatted: string;
}

const MINOR_UNITS: Record<string, number> = { UZS: 2, USD: 2, EUR: 2, KZT: 2, AED: 2 };

function groupDigits(n: string, sep: string): string {
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Minor units'dagi summani (UZS -> tiyin) foydalanuvchi tilida formatlaydi. */
export function formatMoney(amount: number, currency: string, locale: Locale): string {
  const exp = MINOR_UNITS[currency] ?? 2;
  const major = amount / 10 ** exp;
  if (currency === 'UZS') {
    const whole = Number.isInteger(major);
    const [int = '0', frac] = (whole ? major.toFixed(0) : major.toFixed(exp)).split('.');
    const num = groupDigits(int, ' ') + (frac ? `,${frac}` : '');
    if (locale === 'ru') return `${num} сум`;
    if (locale === 'uz-Cyrl') return `${num} сўм`;
    if (locale === 'en') return `${groupDigits(int, ',')}${frac ? `.${frac}` : ''} UZS`;
    return `${num} so'm`;
  }
  const intlLocale = locale === 'uz-Latn' || locale === 'uz-Cyrl' ? 'uz' : locale;
  return new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(major);
}

export function money(amount: number, currency: string, locale: Locale): Money {
  return { amount, currency, formatted: formatMoney(amount, currency, locale) };
}

/** Click summani so'mda (decimal string) yuboradi: "45000.00" -> 4500000 tiyin. */
export function majorStringToMinor(value: string, currency = 'UZS'): number {
  const exp = MINOR_UNITS[currency] ?? 2;
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return Number.NaN;
  const [int = '0', frac = ''] = value.trim().split('.');
  return Number(int) * 10 ** exp + Number(frac.padEnd(exp, '0') || '0');
}

export function minorToMajorString(amount: number, currency = 'UZS'): string {
  const exp = MINOR_UNITS[currency] ?? 2;
  return (amount / 10 ** exp).toFixed(exp);
}
