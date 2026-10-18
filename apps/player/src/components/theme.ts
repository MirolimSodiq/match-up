export const colors = {
  primary: '#0E7C66',
  primaryDark: '#0A5E4E',
  primarySoft: '#E3F3EF',
  accent: '#FF7A00',
  accentSoft: '#FFF1E5',
  danger: '#D93025',
  dangerSoft: '#FDECEA',
  warning: '#B26A00',
  warningSoft: '#FFF6E0',
  info: '#1F6FEB',
  infoSoft: '#E8F0FE',
  bg: '#F5F6F8',
  card: '#FFFFFF',
  border: '#E3E6EA',
  text: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  white: '#FFFFFF',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const font = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  h3: { fontSize: 16, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  small: { fontSize: 13, color: colors.muted, lineHeight: 18 },
};
