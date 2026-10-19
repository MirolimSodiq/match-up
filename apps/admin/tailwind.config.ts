import type { Config } from 'tailwindcss';
import { colors, radius, shadows, space, SPORTS, DEFAULT_SPORT } from './src/lib/tokens';

const px = (v: number) => `${v}px`;

const sport = Object.fromEntries(
  [...Object.entries(SPORTS), ['default', DEFAULT_SPORT] as const].map(([code, c]) => [
    code,
    { DEFAULT: c.base, deep: c.deep, muted: c.muted, tint: c.tint },
  ]),
);

/** Tokenlar src/lib/tokens.ts dan (player theme.ts nusxasi) — globals.css `@config` orqali ulanadi. */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { ...colors, sport },
      borderRadius: Object.fromEntries(Object.entries(radius).map(([k, v]) => [k, px(v)])),
      spacing: Object.fromEntries(Object.entries(space).map(([k, v]) => [`t-${k}`, px(v)])),
      boxShadow: { soft: shadows[1], card: shadows[2], float: shadows[3] },
      fontFamily: {
        display: ['var(--font-oswald)', 'Oswald', 'sans-serif'],
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
} satisfies Config;
