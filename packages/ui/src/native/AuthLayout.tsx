import { type PropsWithChildren, type ReactNode, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontFamily, gradients, radius, space, sportColors, type } from '../tokens';
import { SportIcon } from './SportIcon';
import { SportTexture } from './SportTexture';
import { shadow } from './theme';

/** Bezak kartalari shu balandlikdan past joyda ko'rsatilmaydi (masalan, klaviatura ochiq). */
const MIN_CARDS_HEIGHT = 150;

/**
 * Kirish ekranlari: to'q gradient hero (katta sarlavha, bezak kartalar) va pastda oq bottom sheet.
 * `topRight` — odatda til tanlash, `decor` — hero bezagi (standart: qiyshaygan o'yin kartalari).
 */
export function AuthLayout({
  heroTitle,
  heroSubtitle,
  sheetTitle,
  sheetSubtitle,
  topLeft,
  topRight,
  decor,
  children,
}: PropsWithChildren<{
  heroTitle: string;
  heroSubtitle?: string;
  sheetTitle: string;
  sheetSubtitle?: string;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  decor?: ReactNode;
}>) {
  const insets = useSafeAreaInsets();
  const [cardsHeight, setCardsHeight] = useState(0);
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.hero, { paddingTop: insets.top + space.sm }]}>
          <View style={styles.topRow}>
            <View>{topLeft}</View>
            {topRight}
          </View>
          <View style={styles.cards} onLayout={(e) => setCardsHeight(e.nativeEvent.layout.height)}>
            {cardsHeight >= MIN_CARDS_HEIGHT ? (decor ?? <HeroCards />) : null}
          </View>
          <Text style={styles.heroTitle} accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>
            {heroTitle}
          </Text>
          {heroSubtitle ? <Text style={styles.heroSubtitle}>{heroSubtitle}</Text> : null}
        </View>

        <View style={[styles.sheet, shadow(3), { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <View>
            <Text style={type.display}>{sheetTitle}</Text>
            {sheetSubtitle ? <Text style={[type.small, styles.sheetSubtitle]}>{sheetSubtitle}</Text> : null}
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const DECOR_CARDS = [
  { sport: 'football', time: '19:00', format: '7v7', style: { left: '4%', top: '18%', transform: [{ rotate: '-9deg' }] } },
  { sport: 'basketball', time: '20:30', format: '3x3', style: { right: '3%', top: '6%', transform: [{ rotate: '8deg' }] } },
  { sport: 'volleyball', time: '18:00', format: '6v6', style: { left: '24%', bottom: '4%', transform: [{ rotate: '-2deg' }] } },
] as const;

/** Bezak: qiyshaygan sport rangidagi o'yin kartalari (ekran o'quvchidan yashirilgan). */
function HeroCards() {
  return (
    <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      {DECOR_CARDS.map((d) => (
        <View key={d.sport} style={[styles.card, { backgroundColor: sportColors(d.sport).base }, d.style]}>
          <SportTexture sport={d.sport} opacity={0.14} />
          <View style={styles.cardTop}>
            <SportIcon sport={d.sport} size={18} color={colors.onSport} />
            <View style={styles.cardPill}>
              <Text style={styles.cardPillText}>{d.format}</Text>
            </View>
          </View>
          <Text style={styles.cardTime}>{d.time}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  flex: { flex: 1 },
  hero: { flex: 1, paddingHorizontal: space.lg, paddingBottom: space.xl },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 },
  cards: { flex: 1, minHeight: 0, marginVertical: space.md },
  heroTitle: { ...type.displayL, fontSize: 48, lineHeight: 54, color: colors.onPrimary },
  heroSubtitle: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 22, color: colors.onPrimaryMuted, marginTop: space.sm },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    gap: space.md,
  },
  sheetSubtitle: { marginTop: space.xs },
  card: {
    position: 'absolute',
    width: 164,
    height: 104,
    borderRadius: radius.lg,
    padding: space.md,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.sportShade },
  cardPillText: { fontFamily: fontFamily.semibold, fontSize: 11, color: colors.onSport },
  cardTime: { fontFamily: fontFamily.display, fontSize: 34, lineHeight: 40, color: colors.onSport },
});
