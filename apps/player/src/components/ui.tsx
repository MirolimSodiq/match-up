import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  StyleSheet,
  Text,
  type TextProps,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';
import { colors, font, radius, space } from './theme';

export function Screen({ children, style, ...rest }: PropsWithChildren<ScrollViewProps & { style?: StyleProp<ViewStyle> }>) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, style]}
      keyboardShouldPersistTaps="handled"
      // iOS 26 native header shaffof: kontent uning ostidan boshlanmasligi uchun inset'ni UIKit hisoblaydi
      contentInsetAdjustmentBehavior="automatic"
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

/** Ekran pastidagi yopishqoq tugmalar paneli (safe area bilan). */
export function Footer({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>{children}</View>;
}

export function H1({ style, ...rest }: TextProps) {
  return <Text style={[font.h1, style]} {...rest} />;
}

export function H2({ style, ...rest }: TextProps) {
  return <Text style={[font.h2, style]} {...rest} />;
}

export function H3({ style, ...rest }: TextProps) {
  return <Text style={[font.h3, style]} {...rest} />;
}

export function Body({ style, ...rest }: TextProps) {
  return <Text style={[font.body, style]} {...rest} />;
}

export function Muted({ style, ...rest }: TextProps) {
  return <Text style={[font.small, style]} {...rest} />;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  testID,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const inactive = disabled || loading;
  const v = buttonVariants[variant];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && !inactive && { opacity: 0.85 },
        inactive && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : <Text style={[styles.buttonText, { color: v.fg }]}>{title}</Text>}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.white, border: colors.primary },
  secondary: { bg: colors.card, fg: colors.primary, border: colors.primary },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  danger: { bg: colors.card, fg: colors.danger, border: colors.danger },
};

export function Card({ children, style, onPress }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; onPress?: () => void }>) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const tones: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: colors.primarySoft, fg: colors.primaryDark },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  neutral: { bg: '#EEF0F3', fg: colors.muted },
  info: { bg: colors.infoSoft, fg: colors.info },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Notice({ children, tone = 'info' }: PropsWithChildren<{ tone?: Tone }>) {
  const t = tones[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg }]}>
      <Text style={[font.small, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

export function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={font.small}>{label}</Text>
      {typeof value === 'string' ? <Text style={[font.body, strong && { fontWeight: '700' }]}>{value}</Text> : value}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

/** Xato matni (`code` bo'yicha lokal) va ixtiyoriy "Qayta urinish". */
export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.center}>
      <Text style={[font.body, styles.centerText]}>{errorMessage(t, error)}</Text>
      {onRetry ? <Button title={t('common.retry')} variant="secondary" onPress={onRetry} style={{ marginTop: space.lg }} /> : null}
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <Text accessibilityRole="alert" style={styles.errorText}>
      {errorMessage(t, error)}
    </Text>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <View style={styles.center}>
      <Text style={[font.h3, styles.centerText]}>{title}</Text>
      {hint ? <Text style={[font.small, styles.centerText, { marginTop: space.xs }]}>{hint}</Text> : null}
      {action ? <View style={{ marginTop: space.lg }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: space.lg, gap: space.md },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: space.sm,
  },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: space.sm,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text, fontWeight: '500' },
  chipTextSelected: { color: colors.white },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: 12, fontWeight: '700' },
  notice: { borderRadius: radius.md, padding: space.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.xs },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, minHeight: 200 },
  centerText: { textAlign: 'center' },
  errorText: { color: colors.danger, fontSize: 14, marginTop: space.xs },
});
