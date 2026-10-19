import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button, colors, ErrorText, gradients, radius, shadow, space, type } from '@matchup/ui';
import { useSession } from '@/auth/session';
import { LanguagePicker } from '@/features/LanguagePicker';
import { prettyPhone } from '@/lib/phone';

/** Kirdi, lekin `GET /v1/me` rollarida `host` yo'q — tushunarli xabar, qayta tekshirish va boshqa raqam. */
export default function NotHostScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user, signOut, recheck } = useSession();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>();

  const onRecheck = async () => {
    setChecking(true);
    setError(undefined);
    try {
      await recheck();
    } catch (err) {
      setError(err);
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <LanguagePicker variant="hero" />
      </View>
      <View style={styles.hero}>
        <View style={styles.icon}>
          <Ionicons name="shield-half-outline" size={44} color={colors.onPrimary} />
        </View>
        <Text style={styles.heroTitle} accessibilityRole="header">
          {t('notHost.title')}
        </Text>
      </View>
      <View style={[styles.sheet, shadow(3), { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <Text style={type.body}>{t('notHost.body', { phone: prettyPhone(user?.phone) })}</Text>
        <Text style={type.small}>{t('notHost.playerHint')}</Text>
        <ErrorText error={error} />
        <Button testID="recheck-role" title={t('notHost.recheck')} icon="refresh" onPress={() => void onRecheck()} loading={checking} />
        <Button title={t('notHost.otherNumber')} variant="ghost" onPress={() => void signOut()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  top: { alignItems: 'flex-end', paddingHorizontal: space.lg },
  hero: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.lg },
  icon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.heroGlass,
    borderWidth: 1,
    borderColor: colors.heroGlassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { ...type.displayL, color: colors.onPrimary },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    gap: space.md,
  },
});
