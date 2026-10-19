import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type LanguageOption, LanguageSwitch, type LanguageSwitchVariant, useToast } from '@matchup/ui';
import { api, call } from '@/api/client';
import { useSession } from '@/auth/session';
import i18n, { type AppLocale, currentLocale, LOCALE_NAMES, LOCALES, setLocale } from '@/i18n';

const SHORT: Record<AppLocale, string> = { 'uz-Latn': 'UZ', ru: 'RU', en: 'EN' };
const OPTIONS: LanguageOption<AppLocale>[] = LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l], short: SHORT[l] }));

/**
 * Til almashtirish: UI darhol, server profili (push/SMS tili) va barcha keshlangan kontent qayta olinadi.
 * `chips` — oq pill'lar, `hero` — to'q fondagi ixcham kodlar (UZ/RU/EN), `rows` — sozlamalar ro'yxati.
 */
export function LanguagePicker({ variant = 'chips' }: { variant?: LanguageSwitchVariant }) {
  useTranslation(); // til o'zgarganda qayta render
  const queryClient = useQueryClient();
  const toast = useToast();
  const { status } = useSession();
  const active = currentLocale();

  const change = async (locale: AppLocale) => {
    if (locale === active) return;
    await setLocale(locale);
    if (variant === 'rows') toast({ message: i18n.t('profile.languageChanged'), icon: 'language' });
    if (status === 'signedIn' || status === 'notHost') {
      try {
        await call(api.PATCH('/v1/me', { body: { locale } }));
      } catch {
        // Lokal tanlov baribir saqlangan; keyingi muvaffaqiyatli PATCH'da sinxronlanadi
      }
    }
    // Server matnlari (formatted summa, nomlar, waiver) Accept-Language bo'yicha keladi
    await queryClient.invalidateQueries();
  };

  return <LanguageSwitch options={OPTIONS} value={active} onChange={(l) => void change(l)} variant={variant} />;
}
