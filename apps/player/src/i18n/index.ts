import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { KEYS, storage } from '@/lib/storage';
import en from './locales/en';
import ru from './locales/ru';
import uzLatn from './locales/uz-Latn';

export const LOCALES = ['uz-Latn', 'ru', 'en'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'uz-Latn';

export const LOCALE_NAMES: Record<AppLocale, string> = {
  'uz-Latn': "O'zbekcha",
  ru: 'Русский',
  en: 'English',
};

export function toAppLocale(tag: string | null | undefined): AppLocale | undefined {
  if (!tag) return undefined;
  const t = tag.toLowerCase();
  if (t.startsWith('uz')) return 'uz-Latn';
  if (t.startsWith('ru')) return 'ru';
  if (t.startsWith('en')) return 'en';
  return undefined;
}

function deviceLocale(): AppLocale {
  for (const l of getLocales()) {
    const found = toAppLocale(l.languageTag);
    if (found) return found;
  }
  return DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources: {
    'uz-Latn': { translation: uzLatn },
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: deviceLocale(),
  fallbackLng: DEFAULT_LOCALE,
  load: 'currentOnly',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** Har API so'rovidagi `Accept-Language` qiymati. */
export function currentLocale(): AppLocale {
  return toAppLocale(i18n.language) ?? DEFAULT_LOCALE;
}

/** Saqlangan tanlovni tiklaydi (birinchi ishga tushishda qurilma tili). */
export async function restoreLocale(): Promise<void> {
  const saved = toAppLocale(await storage.get(KEYS.locale));
  if (saved && saved !== i18n.language) await i18n.changeLanguage(saved);
}

export async function setLocale(locale: AppLocale): Promise<void> {
  await storage.set(KEYS.locale, locale);
  await i18n.changeLanguage(locale);
}

export default i18n;
