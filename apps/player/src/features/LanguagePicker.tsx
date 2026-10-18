import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, call } from '@/api/client';
import { useSession } from '@/auth/session';
import { space } from '@/components/theme';
import { Chip } from '@/components/ui';
import { type AppLocale, currentLocale, LOCALE_NAMES, LOCALES, setLocale } from '@/i18n';

const SHORT: Record<AppLocale, string> = { 'uz-Latn': 'UZ', ru: 'RU', en: 'EN' };

/** Til almashtirish: UI darhol, server profili (push/SMS tili) va barcha keshlangan kontent qayta olinadi. */
export function LanguagePicker({ compact }: { compact?: boolean }) {
  useTranslation(); // til o'zgarganda qayta render
  const queryClient = useQueryClient();
  const { status } = useSession();
  const active = currentLocale();

  const change = async (locale: AppLocale) => {
    if (locale === active) return;
    await setLocale(locale);
    if (status === 'signedIn' || status === 'onboarding') {
      try {
        await call(api.PATCH('/v1/me', { body: { locale } }));
      } catch {
        // Lokal tanlov baribir saqlangan; keyingi muvaffaqiyatli PATCH'da sinxronlanadi
      }
    }
    // Server matnlari (formatted summa, nomlar, waiver) Accept-Language bo'yicha keladi
    await queryClient.invalidateQueries();
  };

  return (
    <View style={styles.row}>
      {LOCALES.map((l) => (
        <Chip key={l} label={compact ? SHORT[l] : LOCALE_NAMES[l]} selected={l === active} onPress={() => void change(l)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
