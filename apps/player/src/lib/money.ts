import type { Money } from '@matchup/contracts';

/** Summa matni — faqat server bergan `formatted` (foydalanuvchi tilida); client o'zi formatlamaydi. */
export function money(m: Money | undefined | null): string {
  return m?.formatted ?? '—';
}
