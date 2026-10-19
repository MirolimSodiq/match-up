import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, call } from '@/api/client';
import { useSession } from '@/auth/session';
import { colors, fontFamily, radius, space, states } from '@/components/theme';
import { Chip, Divider, ListRow, useToast } from '@/components/ui';
import i18n, { type AppLocale, currentLocale, LOCALE_NAMES, LOCALES, setLocale } from '@/i18n';

const SHORT: Record<AppLocale, string> = { 'uz-Latn': 'UZ', ru: 'RU', en: 'EN' };

type Variant = 'chips' | 'hero' | 'rows';

/**
 * Til almashtirish: UI darhol, server profili (push/SMS tili) va barcha keshlangan kontent qayta olinadi.
 * `chips` — oq pill'lar, `hero` — to'q fondagi ixcham kodlar (UZ/RU/EN), `rows` — sozlamalar ro'yxati.
 */
export function LanguagePicker({ variant = 'chips' }: { variant?: Variant }) {
  useTranslation(); // til o'zgarganda qayta render
  const queryClient = useQueryClient();
  const toast = useToast();
  const { status } = useSession();
  const active = currentLocale();

  const change = async (locale: AppLocale) => {
    if (locale === active) return;
    await setLocale(locale);
    if (variant === 'rows') toast({ message: i18n.t('profile.languageChanged'), icon: 'language' });
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

  if (variant === 'rows') {
    return (
      <View>
        {LOCALES.map((l, i) => (
          <View key={l}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              left={<Text style={styles.code}>{SHORT[l]}</Text>}
              title={LOCALE_NAMES[l]}
              accessory={l === active ? 'check' : 'radio'}
              onPress={() => void change(l)}
            />
          </View>
        ))}
      </View>
    );
  }

  if (variant === 'hero') {
    return (
      <View style={[styles.row, styles.heroTrack]}>
        <Ionicons name="globe-outline" size={15} color={colors.onPrimaryMuted} style={styles.globe} />
        {LOCALES.map((l) => {
          const selected = l === active;
          return (
            <Pressable
              key={l}
              accessibilityRole="button"
              accessibilityLabel={LOCALE_NAMES[l]}
              accessibilityState={{ selected }}
              onPress={() => void change(l)}
              style={({ pressed }) => [styles.heroItem, selected && styles.heroItemActive, pressed && { opacity: states.pressedOpacity }]}
            >
              <Text style={[styles.heroText, selected && styles.heroTextActive]}>{SHORT[l]}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={[styles.row, styles.wrap]}>
      {LOCALES.map((l) => (
        <Chip key={l} label={LOCALE_NAMES[l]} selected={l === active} onPress={() => void change(l)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  code: { width: 28, fontFamily: fontFamily.bold, fontSize: 13, color: colors.textMuted },
  heroTrack: {
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.heroGlass,
    borderWidth: 1,
    borderColor: colors.heroGlassBorder,
  },
  globe: { marginHorizontal: 6 },
  heroItem: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  heroItemActive: { backgroundColor: colors.surface },
  heroText: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.onPrimary },
  heroTextActive: { color: colors.text },
});
