/**
 * Match Up dizayn tokenlari — `apps/player/src/components/theme.ts` dan ko'chirilgan qiymatlar
 * (och asos + sport ranglari, Oswald sarlavhalar, pill tugmalar). Tailwind config shu fayldan o'qiydi;
 * komponentlarda hex rang yozilmaydi. `packages/ui` paydo bo'lgach shu fayl o'rniga u ulanadi.
 *
 * Kontrast (WCAG 2.1, player'dagi hisob):
 *   text #12141A / bg #F6F7FB — 17.2; textMuted #5F6675 / bg — 5.4, / oq — 5.8
 *   oq / primary #161B33 — 17.0; oq / futbol #1F4FD8 — 6.6; oq / basketbol #C2410C — 5.2; oq / voleybol #6D28D9 — 7.1
 *   danger #B91C1C / oq — 6.5; success #15803D / oq — 5.0
 */
export const palette = {
  ink: '#12141A',
  navy: '#161B33',
  navySoft: '#232A4A',
  white: '#FFFFFF',
  bg: '#F6F7FB',
  gray100: '#EEF1F6',
  gray200: '#E3E7EE',
  gray300: '#CDD3DD',
  gray500: '#5F6675',
  red: '#B91C1C',
  green: '#15803D',
  amber: '#B45309',
} as const;

export const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export const colors = {
  bg: palette.bg,
  surface: palette.white,
  'surface-muted': palette.gray100,
  'surface-sunken': palette.gray200,
  border: palette.gray200,
  'border-strong': palette.gray300,
  overlay: alpha(palette.navy, 0.45),

  text: palette.ink,
  'text-muted': palette.gray500,
  'text-inverse': palette.white,

  primary: palette.navy,
  'primary-soft': palette.navySoft,
  'on-primary': palette.white,
  'on-primary-muted': alpha(palette.white, 0.74),

  success: palette.green,
  'success-soft': alpha(palette.green, 0.1),
  danger: palette.red,
  'danger-soft': alpha(palette.red, 0.08),
  warning: palette.amber,
  'warning-soft': alpha(palette.amber, 0.1),

  'on-sport': palette.white,
  'sport-glass': alpha(palette.white, 0.14),
  'sport-glass-strong': alpha(palette.white, 0.22),

  payme: '#33CCCC',
  click: '#0073FF',
  wallet: palette.navy,
} as const;

export interface SportColors {
  base: string;
  deep: string;
  muted: string;
  tint: string;
}

/** Bitta sport — bitta rang (player bilan bir xil). */
export const SPORTS: Record<string, SportColors> = {
  football: { base: '#1F4FD8', deep: '#1838A8', muted: alpha(palette.white, 0.8), tint: alpha('#1F4FD8', 0.1) },
  basketball: { base: '#C2410C', deep: '#9A3412', muted: palette.white, tint: alpha('#C2410C', 0.1) },
  volleyball: { base: '#6D28D9', deep: '#5B21B6', muted: alpha(palette.white, 0.8), tint: alpha('#6D28D9', 0.1) },
};
export const DEFAULT_SPORT: SportColors = { base: '#0F766E', deep: '#115E59', muted: palette.white, tint: alpha('#0F766E', 0.1) };

export const sportColors = (sport: string | undefined | null): SportColors => (sport && SPORTS[sport]) || DEFAULT_SPORT;

export const gradients = {
  hero: ['#0E1430', '#1B1F4D', '#2A1F5C'],
  promo: [palette.navy, '#26205A'],
  screenTop: [alpha('#8EA2FF', 0.22), alpha('#FFC6A8', 0.12), alpha(palette.bg, 0)],
} as const;

/** px — player'dagi radius/space shkalasi. */
export const radius = { sm: 10, md: 16, lg: 20, xl: 28, pill: 999 } as const;
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Yumshoq soya (navy asosida), 3 daraja. */
export const shadows = {
  1: `0 2px 6px ${alpha(palette.navy, 0.06)}`,
  2: `0 6px 14px ${alpha(palette.navy, 0.1)}`,
  3: `0 10px 24px ${alpha(palette.navy, 0.16)}`,
} as const;
