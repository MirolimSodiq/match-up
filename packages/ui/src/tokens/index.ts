/**
 * Match Up dizayn tokenlari — sof TypeScript obyektlar, React Native'ga bog'lanmagan.
 * Mobil ilovalar (`@matchup/ui`) ham, web admin panel ham shu qiymatlardan foydalanadi.
 * Ekranlarda hex rang yozilmaydi: hamma narsa shu fayldagi tokenlardan olinadi.
 *
 * Kontrast (WCAG 2.1, hisoblangan):
 *   text      #12141A / bg #F6F7FB — 17.2
 *   textMuted #5F6675 / bg #F6F7FB — 5.4, / surfaceMuted #EEF1F6 — 5.1, / oq — 5.8
 *   oq / primary #161B33 — 17.0
 *   oq / futbol #1F4FD8 — 6.6 (80% oq — 4.7), oq / basketbol #C2410C — 5.2, oq / voleybol #6D28D9 — 7.1 (80% — 4.9)
 *   danger #B91C1C / oq — 6.5, success #15803D / oq — 5.0
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

/** `#RRGGBB` -> `rgba(r, g, b, a)`. */
export const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export const colors = {
  // Fon va konteynerlar
  bg: palette.bg,
  surface: palette.white,
  surfaceMuted: palette.gray100,
  surfaceSunken: palette.gray200,
  border: palette.gray200,
  borderStrong: palette.gray300,
  overlay: alpha(palette.navy, 0.45),
  glass: alpha(palette.white, 0.78),
  glassBorder: alpha(palette.white, 0.9),

  // Matn
  text: palette.ink,
  textMuted: palette.gray500,
  textInverse: palette.white,

  // Asosiy pill tugma — to'q navy
  primary: palette.navy,
  primarySoft: palette.navySoft,
  onPrimary: palette.white,
  /** To'q (navy/hero) fonda ikkinchi darajali matn — kontrast 10+ */
  onPrimaryMuted: alpha(palette.white, 0.74),
  heroGlass: alpha(palette.white, 0.12),
  heroGlassBorder: alpha(palette.white, 0.2),

  success: palette.green,
  successSoft: alpha(palette.green, 0.1),
  danger: palette.red,
  dangerSoft: alpha(palette.red, 0.08),
  warning: palette.amber,
  warningSoft: alpha(palette.amber, 0.1),

  // Sport rangidagi ekran/kartalar ichida
  onSport: palette.white,
  sportGlass: alpha(palette.white, 0.14),
  sportGlassStrong: alpha(palette.white, 0.22),
  sportGlassBorder: alpha(palette.white, 0.24),
  /** Sport fonidagi kichik pill'lar uchun to'qroq qatlam — oq matn kontrasti oshadi (oqartirmaydi). */
  sportShade: alpha(palette.ink, 0.22),
  sportTexture: palette.white,

  // QR maydoni — doim oq, to'q modullar (skaner ishonchli o'qishi uchun)
  qrSurface: palette.white,
  qrInk: palette.ink,

  // Provayder belgilari
  payme: '#33CCCC',
  click: '#0073FF',
  /** Rahmat (Multicard) */
  multicard: '#531EDC',
  wallet: palette.navy,
} as const;

/** Social login brend belgilarining rasmiy ranglari (brend qoidalari bo'yicha o'zgartirilmaydi). */
export const brandColors = {
  telegram: '#229ED9',
  googleBlue: '#4285F4',
  googleRed: '#EA4335',
  googleYellow: '#FBBC05',
  googleGreen: '#34A853',
} as const;

export interface SportColors {
  /** To'yingan fon rangi (karta, detal ekrani). */
  base: string;
  /** Pastki gradient uchun to'qroq ton. */
  deep: string;
  /** Ikkinchi darajali matn (yorliq) — kontrast AA'dan past tushmaydi. */
  muted: string;
  /** Och fonda kichik belgi/tekst uchun. */
  tint: string;
}

/** Bitta sport — bitta rang, ilovaning hamma joyida bir xil. */
const SPORTS: Record<string, SportColors> = {
  football: { base: '#1F4FD8', deep: '#1838A8', muted: alpha(palette.white, 0.8), tint: alpha('#1F4FD8', 0.1) },
  // Yorqin to'q sariq (#F2622E) oq matn bilan 3.2 — AA emas; shuning uchun chuqurroq ton
  basketball: { base: '#C2410C', deep: '#9A3412', muted: palette.white, tint: alpha('#C2410C', 0.1) },
  volleyball: { base: '#6D28D9', deep: '#5B21B6', muted: alpha(palette.white, 0.8), tint: alpha('#6D28D9', 0.1) },
};
const DEFAULT_SPORT: SportColors = { base: '#0F766E', deep: '#115E59', muted: palette.white, tint: alpha('#0F766E', 0.1) };

export const sportColors = (sport: string | undefined | null): SportColors => (sport && SPORTS[sport]) || DEFAULT_SPORT;

export const gradients = {
  /** Ekran tepasidagi yumshoq rangli "nur". */
  screenTop: [alpha('#8EA2FF', 0.22), alpha('#FFC6A8', 0.12), alpha(palette.bg, 0)] as const,
  /** Login hero — to'q. */
  hero: ['#0E1430', '#1B1F4D', '#2A1F5C'] as const,
  /** Profil "hamyon" banneri. */
  promo: [palette.navy, '#26205A'] as const,
};

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 20, xl: 28, pill: 999 } as const;

/**
 * Display — Oswald (siqilgan, lotin + kirill), faqat UPPERCASE sarlavha/vaqt/summa uchun.
 * Matn — Inter (lotin + kirill).
 * Nomlar `@expo-google-fonts` eksportlari bilan bir xil (mobil); web'da `fontStacks` ishlatiladi.
 */
export const fontFamily = {
  display: 'Oswald_700Bold',
  displaySemi: 'Oswald_600SemiBold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/** Web (CSS) uchun shrift oilalari va og'irliklari — `fontFamily` kalitlari bilan mos. */
export const fontStacks = {
  display: { family: "'Oswald', 'Arial Narrow', sans-serif", weight: 700 },
  displaySemi: { family: "'Oswald', 'Arial Narrow', sans-serif", weight: 600 },
  regular: { family: "'Inter', system-ui, sans-serif", weight: 400 },
  medium: { family: "'Inter', system-ui, sans-serif", weight: 500 },
  semibold: { family: "'Inter', system-ui, sans-serif", weight: 600 },
  bold: { family: "'Inter', system-ui, sans-serif", weight: 700 },
} as const satisfies Record<keyof typeof fontFamily, { family: string; weight: number }>;

/** Platformaga bog'lanmagan matn uslubi (RN `TextStyle` bilan mos keladi). */
export interface TextToken {
  fontFamily: string;
  fontSize: number;
  lineHeight?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  color?: string;
}

export const type = {
  display: { fontFamily: fontFamily.display, fontSize: 34, lineHeight: 40, textTransform: 'uppercase', color: colors.text },
  displayL: { fontFamily: fontFamily.display, fontSize: 44, lineHeight: 50, textTransform: 'uppercase', color: colors.text },
  /** Detal ekranidagi katta vaqt. */
  clock: { fontFamily: fontFamily.display, fontSize: 76, lineHeight: 84, color: colors.onSport },
  title: { fontFamily: fontFamily.bold, fontSize: 20, lineHeight: 26, color: colors.text },
  h3: { fontFamily: fontFamily.semibold, fontSize: 17, lineHeight: 22, color: colors.text },
  section: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 22, color: colors.text },
  body: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 22, color: colors.text },
  bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 15, lineHeight: 22, color: colors.text },
  small: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, color: colors.textMuted },
  smallStrong: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 18, color: colors.text },
  caption: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: colors.textMuted },
  button: { fontFamily: fontFamily.semibold, fontSize: 16 },
} satisfies Record<string, TextToken>;

/** Interaktiv holatlar — barcha tugma, chip va kartalar uchun bir xil. */
export const states = {
  pressedOpacity: 0.85,
  pressedScale: 0.98,
  disabledOpacity: 0.4,
  focusBorder: colors.primary,
} as const;

/** Soya darajalari (och mavzu): suzuvchi tab bar, faol segment, bottom sheet. */
export const shadows = {
  1: { opacity: 0.06, radius: 6, offsetY: 2, elevation: 2 },
  2: { opacity: 0.1, radius: 14, offsetY: 6, elevation: 6 },
  3: { opacity: 0.16, radius: 24, offsetY: 10, elevation: 12 },
} as const;
export type ShadowLevel = keyof typeof shadows;
/** Soya rangi. */
export const shadowColor = palette.navy;

/** Navigatsiya (header, ekran foni) ranglari — React Navigation `Theme.colors` bilan mos. */
export const navigationColors = {
  primary: colors.primary,
  background: colors.bg,
  card: colors.bg,
  text: colors.text,
  border: colors.border,
  notification: colors.danger,
} as const;

/** Jamoa formasi (bib) ranglari uchun zaxira — server `bib_color` bermasa. */
export const bibFallback = ['#FF7A00', '#1F6FEB', '#15803D', '#B91C1C'] as const;

/** WCAG nisbiy yorqinlik (`#RRGGBB`). */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** Ixtiyoriy fon rangi (masalan, server bergan bib rangi) ustida o'qiladigan matn rangi: oq yoki to'q. */
export function readableOn(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}/.test(hex)) return palette.ink;
  const l = luminance(hex);
  const onWhite = 1.05 / (l + 0.05);
  const onInk = (l + 0.05) / (luminance(palette.ink) + 0.05);
  return onWhite >= onInk ? palette.white : palette.ink;
}
