/** O'zbekiston raqami: foydalanuvchi faqat 9 ta raqamni kiritadi, +998 prefiksi qat'iy. */
export const UZ_PREFIX = '+998';

export const phoneDigits = (input: string) => input.replace(/\D/g, '').slice(0, 9);

/** "902000001" -> "90 200 00 01" */
export function formatPhoneDigits(digits: string): string {
  const d = phoneDigits(digits);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return parts.join(' ');
}

export const toE164 = (digits: string) => `${UZ_PREFIX}${phoneDigits(digits)}`;

/** "+998902000001" -> "+998 90 200 00 01" */
export function prettyPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  if (!e164.startsWith(UZ_PREFIX)) return e164;
  return `${UZ_PREFIX} ${formatPhoneDigits(e164.slice(UZ_PREFIX.length))}`;
}
