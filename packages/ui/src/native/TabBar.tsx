import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontFamily, radius, space } from '../tokens';
import type { IconName } from './primitives';
import { shadow } from './theme';

/**
 * expo-router `Tabs` ning `tabBar` props'idan kerakli qism (expo-router'ga runtime bog'liqlik yo'q,
 * shuning uchun paket bitta navigatsiya nusxasini ishlatadi).
 */
export interface FloatingTabBarProps {
  state: { index: number; routes: readonly { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string } }>;
  emitter: { emit(event: { type: 'tabPress'; target: string; canPreventDefault: true }): { defaultPrevented: boolean } };
  navigateToTab(routeKey: string): void;
}

/** Pastda suzuvchi "shisha" pill: faqat ikonalar, faol ikona to'q doirada. `badges` — ikona ustidagi raqam. */
export function FloatingTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  icons,
  badges,
}: FloatingTabBarProps & {
  /** route nomi -> [oddiy, faol] ikona */
  icons: Record<string, [IconName, IconName]>;
  badges?: Record<string, number | undefined>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom - space.xs, space.md) }]} pointerEvents="box-none">
      <View style={[styles.shadow, shadow(2)]}>
        <BlurView intensity={50} tint="light" style={styles.bar}>
          <View style={styles.tint} pointerEvents="none" />
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const { options } = descriptors[route.key]!;
            const [icon, activeIcon] = icons[route.name] ?? ['ellipse-outline', 'ellipse'];
            const badge = badges?.[route.name];
            const onPress = () => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            };
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={badge ? `${options.title ?? route.name} (${badge})` : (options.title ?? route.name)}
                accessibilityState={{ selected: focused }}
                onPress={onPress}
                style={styles.item}
              >
                <View style={[styles.icon, focused && styles.iconActive]}>
                  <Ionicons name={focused ? activeIcon : icon} size={22} color={focused ? colors.onPrimary : colors.text} />
                  {badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  shadow: { borderRadius: radius.pill },
  bar: {
    flexDirection: 'row',
    gap: space.xs,
    padding: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  tint: { ...StyleSheet.absoluteFill, backgroundColor: colors.glass },
  item: { paddingHorizontal: space.xs },
  icon: { width: 64, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  iconActive: { backgroundColor: colors.primary },
  badge: {
    position: 'absolute',
    top: 6,
    right: 14,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fontFamily.bold, fontSize: 11, color: colors.onPrimary },
});
