export const LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'uz-Latn';

/** `Accept-Language: ru-RU,ru;q=0.9,en;q=0.8` -> 'ru'. 'uz' -> 'uz-Latn'. */
export function parseAcceptLanguage(header: string | undefined): Locale | undefined {
  if (!header) return undefined;
  const tags = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((t) => t.tag && !Number.isNaN(t.q))
    .sort((a, b) => b.q - a.q);
  for (const { tag } of tags) {
    if (tag === 'uz-cyrl' || tag.startsWith('uz-cyrl')) return 'uz-Cyrl';
    if (tag.startsWith('uz')) return 'uz-Latn';
    if (tag.startsWith('ru')) return 'ru';
    if (tag.startsWith('en')) return 'en';
  }
  return undefined;
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** jsonb tarjimalardan kerakli tilni olish: locale -> uz-Latn -> birinchi mavjud. */
export function tr(value: unknown, locale: Locale): string {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : '';
  const map = value as Record<string, string>;
  return map[locale] ?? (locale === 'uz-Cyrl' ? map['uz-Latn'] : undefined) ?? map['uz-Latn'] ?? Object.values(map)[0] ?? '';
}
