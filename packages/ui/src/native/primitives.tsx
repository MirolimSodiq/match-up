import Ionicons from '@expo/vector-icons/Ionicons';
import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  StyleSheet,
  Switch,
  Text,
  type TextProps,
  View,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { colors, fontFamily, gradients, radius, space, states, type } from '../tokens';
import { shadow } from './theme';
import { useUI } from './UIProvider';

export type IconName = keyof typeof Ionicons.glyphMap;

/** Suzuvchi tab bar balandligi — ro'yxatlar pastidan shuncha joy qoldiriladi. */
export const TAB_BAR_SPACE = 104;

/** Ekran tepasidagi yumshoq rangli gradient (och mavzu "nur"i). */
export function ScreenGlow() {
  return <LinearGradient colors={gradients.screenTop} style={styles.glow} pointerEvents="none" />;
}

export function Screen({
  children,
  style,
  glow = true,
  ...rest
}: PropsWithChildren<ScrollViewProps & { style?: StyleProp<ViewStyle>; glow?: boolean }>) {
  return (
    <View style={styles.screen}>
      {glow ? <ScreenGlow /> : null}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.screenContent, style]}
        keyboardShouldPersistTaps="handled"
        // iOS 26 native header shaffof: kontent uning ostidan boshlanmasligi uchun inset'ni UIKit hisoblaydi
        contentInsetAdjustmentBehavior="automatic"
        {...rest}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** Ekran pastiga qadalgan tugmalar paneli (safe area bilan). */
export function Footer({ children, transparent }: PropsWithChildren<{ transparent?: boolean }>) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, transparent && styles.footerTransparent, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      {children}
    </View>
  );
}

/** Tab ekranlari: katta UPPERCASE sarlavha (+ o'ng tomonda ixtiyoriy element). */
export function PageTitle({ title, right, subtitle }: { title: string; right?: ReactNode; subtitle?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.pageTitle, { paddingTop: insets.top + space.md }]}>
      <View style={styles.flex}>
        <Text style={type.displayL} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={type.small}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** Bottom sheet sarlavhasi: katta UPPERCASE matn va dumaloq "yopish". */
export function SheetHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose?: () => void }) {
  const { closeLabel } = useUI();
  return (
    <View style={styles.sheetHeader}>
      <View style={styles.flex}>
        <Text style={type.display} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={[type.small, { marginTop: space.xs }]}>{subtitle}</Text> : null}
      </View>
      {onClose ? <IconButton icon="close" label={closeLabel} onPress={onClose} variant="muted" /> : null}
    </View>
  );
}

/**
 * Oq bottom sheet ekrani (native modal ichida): tutqich, katta sarlavha va dumaloq "yopish".
 * Sarlavha berilmasa (yuklanish/xato) — faqat yopish tugmasi.
 */
export function SheetScreen({
  title,
  subtitle,
  onClose,
  children,
}: PropsWithChildren<{ title?: string; subtitle?: string; onClose: () => void }>) {
  const { closeLabel } = useUI();
  return (
    <View style={styles.sheetScreen}>
      <View style={styles.grabber} />
      <View style={styles.sheetScreenHeader}>
        {title ? (
          <SheetHeader title={title} subtitle={subtitle} onClose={onClose} />
        ) : (
          <View style={styles.sheetCloseOnly}>
            <IconButton icon="close" label={closeLabel} variant="muted" onPress={onClose} />
          </View>
        )}
      </View>
      {children}
    </View>
  );
}

export function Display({ style, ...rest }: TextProps) {
  return <Text style={[type.display, style]} {...rest} />;
}
export function Title({ style, ...rest }: TextProps) {
  return <Text style={[type.title, style]} {...rest} />;
}
export function H3({ style, ...rest }: TextProps) {
  return <Text style={[type.h3, style]} {...rest} />;
}
export function Body({ style, ...rest }: TextProps) {
  return <Text style={[type.body, style]} {...rest} />;
}
export function Muted({ style, ...rest }: TextProps) {
  return <Text style={[type.small, style]} {...rest} />;
}
export function Caption({ style, ...rest }: TextProps) {
  return <Text style={[type.caption, style]} {...rest} />;
}
export function Section({ style, ...rest }: TextProps) {
  return <Text style={[type.section, style]} {...rest} />;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light' | 'glass';

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
  secondary: { bg: colors.surface, fg: colors.text, border: colors.borderStrong },
  ghost: { bg: 'transparent', fg: colors.text, border: 'transparent' },
  danger: { bg: colors.surface, fg: colors.danger, border: colors.border },
  // Sport rangidagi ekranlarda
  light: { bg: colors.surface, fg: colors.text, border: colors.surface },
  glass: { bg: colors.sportGlassStrong, fg: colors.onSport, border: colors.sportGlassBorder },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  leading,
  disabled,
  loading,
  style,
  testID,
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  /** Ikonka o'rniga ixtiyoriy element (masalan, brend belgisi `BrandMark`). */
  leading?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const inactive = disabled || loading;
  const v = buttonVariants[variant];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && !inactive && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.row}>
          {leading ?? (icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null)}
          {/* Uzun matn (narx bilan) qisqartirilmaydi — biroz kichrayadi */}
          <Text style={[type.button, styles.buttonText, { color: v.fg }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

type IconButtonVariant = 'light' | 'muted' | 'dark' | 'glass';

const iconButtonVariants: Record<IconButtonVariant, { bg: string; fg: string; border: string }> = {
  light: { bg: colors.surface, fg: colors.text, border: colors.border },
  muted: { bg: colors.surfaceMuted, fg: colors.text, border: colors.surfaceMuted },
  dark: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
  glass: { bg: colors.sportGlassStrong, fg: colors.onSport, border: colors.sportGlassBorder },
};

/** Dumaloq ikonali tugma (yopish, ulashish, kalendar, "+"). */
export function IconButton({
  icon,
  label,
  onPress,
  variant = 'light',
  size = 40,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  variant?: IconButtonVariant;
  size?: number;
}) {
  const v = iconButtonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: v.bg, borderColor: v.border },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={size * 0.48} color={v.fg} />
    </Pressable>
  );
}

export function Card({
  children,
  style,
  onPress,
  tone = 'muted',
}: PropsWithChildren<{ style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: 'muted' | 'white' }>) {
  const toneStyle = tone === 'white' ? styles.cardWhite : null;
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, toneStyle, pressed && styles.pressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, toneStyle, style]}>{children}</View>;
}

/** Sport ikonali filtr chip'i: oq pill, tanlangani — to'q navy. */
export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      {icon}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'sport';

const tones: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  neutral: { bg: colors.surfaceMuted, fg: colors.text },
  sport: { bg: colors.sportShade, fg: colors.onSport },
};

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Notice({ children, tone = 'neutral', icon }: PropsWithChildren<{ tone?: Tone; icon?: IconName }>) {
  const t = tones[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={18} color={t.fg} /> : null}
      <Text style={[type.small, styles.flex, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

/** Yorliq — qiymat qatori (info konteynerlari uchun). */
export function Row({ label, value, strong, inverse }: { label: string; value: ReactNode; strong?: boolean; inverse?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[type.small, inverse && { color: colors.onSport }]}>{label}</Text>
      {typeof value === 'string' ? (
        <Text style={[strong ? type.title : type.bodyStrong, styles.infoValue, inverse && { color: colors.onSport }]} numberOfLines={2}>
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

/** `check` — tanlangan (to'q doirada ✓), `radio` — tanlanmagan bo'sh doira. */
type Accessory = 'chevron' | 'plus' | 'check' | 'radio' | 'none';

/** Ro'yxat qatori: chapda ikona/avatar, o'ngda strelka, dumaloq "+" yoki ✓, yoki toggle. */
export function ListRow({
  title,
  subtitle,
  left,
  icon,
  accessory = 'none',
  toggle,
  onPress,
  destructive,
  value,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  icon?: IconName;
  accessory?: Accessory;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  onPress?: () => void;
  destructive?: boolean;
  value?: string;
}) {
  const content = (
    <>
      {left ?? (icon ? <Ionicons name={icon} size={20} color={destructive ? colors.danger : colors.text} /> : null)}
      <View style={styles.flex}>
        <Text style={[type.body, destructive && { color: colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={type.small}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={type.small}>{value}</Text> : null}
      {toggle ? <Toggle value={toggle.value} onChange={toggle.onChange} /> : null}
      {accessory === 'chevron' ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
      {accessory === 'plus' ? (
        <View style={[styles.roundAccessory, styles.roundAccessoryDark]}>
          <Ionicons name="add" size={16} color={colors.onPrimary} />
        </View>
      ) : null}
      {accessory === 'check' ? (
        <View style={[styles.roundAccessory, styles.roundAccessoryDark]}>
          <Ionicons name="checkmark" size={16} color={colors.onPrimary} />
        </View>
      ) : null}
      {accessory === 'radio' ? <View style={styles.roundAccessory} /> : null}
    </>
  );
  const selectable = accessory === 'check' || accessory === 'radio';
  const pressHandler = onPress ?? (toggle ? () => toggle.onChange(!toggle.value) : undefined);
  if (pressHandler) {
    return (
      <Pressable
        accessibilityRole={toggle ? 'switch' : selectable ? 'radio' : 'button'}
        accessibilityState={toggle ? { checked: toggle.value } : selectable ? { checked: accessory === 'check' } : undefined}
        onPress={pressHandler}
        style={({ pressed }) => [styles.listRow, pressed && { opacity: states.pressedOpacity }]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={styles.listRow}>{content}</View>;
}

/** Sozlamalar uslubidagi guruh: kichik sarlavha va qatorlar. */
export function Group({ title, children }: PropsWithChildren<{ title?: string }>) {
  return (
    <View>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ true: colors.primary, false: colors.surfaceSunken }}
      thumbColor={colors.surface}
      ios_backgroundColor={colors.surfaceSunken}
    />
  );
}

export function Divider({ dashed, inverse }: { dashed?: boolean; inverse?: boolean }) {
  if (dashed) {
    return (
      <View style={styles.dashed}>
        <DashedLine color={inverse ? colors.sportGlassBorder : colors.borderStrong} />
      </View>
    );
  }
  return <View style={[styles.divider, inverse && { backgroundColor: colors.sportGlassBorder }]} />;
}

/** Punktir chiziq (SVG): iOS'da bir tomonlama `borderStyle: 'dashed'` ishonchli chizilmaydi. */
export function DashedLine({ color = colors.borderStrong }: { color?: string }) {
  return (
    <Svg width="100%" height={2} accessibilityElementsHidden importantForAccessibility="no">
      <Line x1="0" y1="1" x2="100%" y2="1" stroke={color} strokeWidth={1.5} strokeDasharray="6 5" />
    </Svg>
  );
}

/** Dumaloq avatar (bosh harf). `onSport` — sport rangidagi fonda. */
export function Avatar({
  name,
  size = 44,
  onSport,
  empty,
  highlight,
}: {
  name?: string | null;
  size?: number;
  onSport?: boolean;
  empty?: boolean;
  highlight?: boolean;
}) {
  const base = onSport
    ? { backgroundColor: empty ? 'transparent' : colors.sportGlassStrong, borderColor: highlight ? colors.onSport : colors.sportGlassBorder }
    : { backgroundColor: empty ? 'transparent' : colors.surfaceMuted, borderColor: highlight ? colors.primary : colors.border };
  const fg = onSport ? colors.onSport : colors.text;
  return (
    <View
      style={[
        styles.avatar,
        base,
        { width: size, height: size, borderRadius: size / 2, borderWidth: highlight ? 2 : 1.5 },
        empty && styles.avatarEmpty,
      ]}
    >
      {empty ? (
        <Ionicons name="add" size={size * 0.42} color={onSport ? colors.onSport : colors.textMuted} />
      ) : (
        <Text style={[styles.avatarText, { fontSize: size * 0.4, color: fg }]}>{(name ?? '?').slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  );
}

/** Segmented control: kulrang trek, faol segment — oq (soya bilan), silliq siljiydi. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [layouts, setLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  const ready = useRef(false);

  useEffect(() => {
    const l = layouts[value];
    if (!l) return;
    if (!ready.current) {
      x.setValue(l.x);
      width.setValue(l.width);
      ready.current = true;
      return;
    }
    Animated.parallel([
      Animated.spring(x, { toValue: l.x, useNativeDriver: false, speed: 20, bounciness: 4 }),
      Animated.spring(width, { toValue: l.width, useNativeDriver: false, speed: 20, bounciness: 4 }),
    ]).start();
  }, [value, layouts, x, width]);

  const onLayout = (key: string) => (e: LayoutChangeEvent) => {
    const { x: lx, width: lw } = e.nativeEvent.layout;
    setLayouts((prev) => (prev[key]?.x === lx && prev[key]?.width === lw ? prev : { ...prev, [key]: { x: lx, width: lw } }));
  };

  return (
    <View style={styles.segments} accessibilityRole="tablist">
      <Animated.View style={[styles.segmentThumb, shadow(1), { left: x, width }]} />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onLayout={onLayout(o.value)}
            onPress={() => onChange(o.value)}
            style={styles.segment}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface ToastOptions {
  message: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}

const ToastContext = createContext<(t: ToastOptions) => void>(() => undefined);

export const useToast = () => use(ToastContext);

/** Toast — to'q pill, ixtiyoriy amal tugmasi ("Bekor qilish") bilan. */
export function ToastProvider({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const hide = useCallback(() => {
    Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setToast(null));
  }, [opacity]);

  const show = useCallback(
    (t: ToastOptions) => {
      clearTimeout(timer.current);
      setToast(t);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, 3200);
    },
    [opacity, hide],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext value={value}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="box-none" style={[styles.toastWrap, { bottom: insets.bottom + TAB_BAR_SPACE - space.lg, opacity }]}>
          <View style={[styles.toast, shadow(3)]} accessibilityRole="alert">
            {toast.icon ? <Ionicons name={toast.icon} size={18} color={colors.onPrimary} /> : null}
            <Text style={[type.smallStrong, styles.flex, { color: colors.onPrimary }]}>{toast.message}</Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  toast.action?.onPress();
                  hide();
                }}
              >
                <Text style={[type.smallStrong, { color: colors.onPrimary, textDecorationLine: 'underline' }]}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </ToastContext>
  );
}

export function Loading({ color = colors.primary }: { color?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={color} />
    </View>
  );
}

/** Xato matni (`code` bo'yicha lokal) va ixtiyoriy "Qayta urinish". */
export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { retryLabel, formatError } = useUI();
  return (
    <View style={styles.center}>
      <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
      <Text style={[type.body, styles.centerText, { marginTop: space.md }]}>{formatError(error)}</Text>
      {onRetry ? <Button title={retryLabel} variant="secondary" onPress={onRetry} style={{ marginTop: space.lg }} /> : null}
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const { formatError } = useUI();
  if (!error) return null;
  return (
    <Text accessibilityRole="alert" style={styles.errorText}>
      {formatError(error)}
    </Text>
  );
}

export function EmptyState({ title, hint, action, icon = 'search-outline' }: { title: string; hint?: string; action?: ReactNode; icon?: IconName }) {
  return (
    <View style={styles.center}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.textMuted} />
      </View>
      <Text style={[type.h3, styles.centerText, { marginTop: space.md }]}>{title}</Text>
      {hint ? <Text style={[type.small, styles.centerText, { marginTop: space.xs }]}>{hint}</Text> : null}
      {action ? <View style={{ marginTop: space.lg }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  screen: { flex: 1, backgroundColor: colors.bg },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 320 },
  screenContent: { padding: space.lg, gap: space.md },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: colors.bg, gap: space.sm },
  footerTransparent: { backgroundColor: 'transparent' },
  pageTitle: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  sheetScreen: { flex: 1, backgroundColor: colors.surface },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: radius.pill, backgroundColor: colors.borderStrong, marginTop: space.sm },
  sheetScreenHeader: { paddingHorizontal: space.lg, paddingVertical: space.md },
  sheetCloseOnly: { alignItems: 'flex-end' },
  pressed: { opacity: states.pressedOpacity, transform: [{ scale: states.pressedScale }] },
  disabled: { opacity: states.disabledOpacity },
  button: {
    minHeight: 54,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  buttonText: { flexShrink: 1 },
  iconButton: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  cardWhite: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fontFamily.medium, fontSize: 14, color: colors.text },
  chipTextSelected: { color: colors.onPrimary },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontFamily: fontFamily.semibold, fontSize: 12 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, padding: space.md },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  infoValue: { flexShrink: 1, textAlign: 'right' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 13, minHeight: 50 },
  roundAccessory: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundAccessoryDark: { backgroundColor: colors.primary, borderColor: colors.primary },
  groupTitle: { ...type.small, color: colors.text, fontFamily: fontFamily.medium, marginTop: space.md, marginBottom: space.xs },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dashed: { marginVertical: space.xs },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarEmpty: { borderStyle: 'dashed' },
  avatarText: { fontFamily: fontFamily.display },
  segments: { flexDirection: 'row', backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, padding: 4 },
  segmentThumb: { position: 'absolute', top: 4, bottom: 4, borderRadius: radius.pill, backgroundColor: colors.surface },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  segmentText: { fontFamily: fontFamily.medium, fontSize: 14, color: colors.textMuted },
  segmentTextActive: { fontFamily: fontFamily.semibold, color: colors.text },
  toastWrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, minHeight: 220 },
  centerText: { textAlign: 'center' },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: fontFamily.medium, color: colors.danger, fontSize: 14, marginTop: space.xs },
});
