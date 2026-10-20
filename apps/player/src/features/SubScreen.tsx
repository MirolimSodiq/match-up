import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, IconButton, ScreenGlow, space, type } from '@matchup/ui';

/**
 * Profil ichidagi sahifa (tab bar'siz): orqaga tugmasi, katta UPPERCASE sarlavha va scroll kontent.
 * Deep link'dan to'g'ridan-to'g'ri ochilsa "orqaga" profilga olib boradi.
 */
export function SubScreen({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle?: string }>) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  return (
    <View style={styles.root}>
      <ScreenGlow />
      <View style={[styles.bar, { paddingTop: insets.top + space.sm }]}>
        <IconButton icon="chevron-back" label={t('common.back')} variant="muted" onPress={back} />
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.head}>
          <Text style={type.display} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={type.small}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  bar: { paddingHorizontal: space.lg, paddingBottom: space.sm, alignItems: 'flex-start' },
  content: { flexGrow: 1, paddingHorizontal: space.lg, gap: space.md },
  head: { gap: space.xs, marginBottom: space.xs },
});
