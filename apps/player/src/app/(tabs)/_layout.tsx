import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, radius, shadow, space } from '@/components/theme';
import type { IconName } from '@/components/ui';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, [IconName, IconName]> = {
  index: ['albums-outline', 'albums'],
  bookings: ['ticket-outline', 'ticket'],
  profile: ['person-outline', 'person'],
};

/** Pastda suzuvchi "shisha" pill: faqat ikonalar, faol ikona to'q doirada. */
function FloatingTabBar({ state, descriptors, emitter, navigateToTab }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom - space.xs, space.md) }]} pointerEvents="box-none">
      <View style={[styles.shadow, shadow(2)]}>
        <BlurView intensity={50} tint="light" style={styles.bar}>
          <View style={styles.tint} pointerEvents="none" />
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const { options } = descriptors[route.key]!;
            const [icon, activeIcon] = ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];
            const onPress = () => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            };
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={options.title ?? route.name}
                accessibilityState={{ selected: focused }}
                onPress={onPress}
                style={styles.item}
              >
                <View style={[styles.icon, focused && styles.iconActive]}>
                  <Ionicons name={focused ? activeIcon : icon} size={22} color={focused ? colors.onPrimary : colors.text} />
                </View>
              </Pressable>
            );
          })}
        </BlurView>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <>
      {/* Tab ekranlari och fonda — login hero yoki sport rangidagi sahifadan qaytganda ham to'q status bar */}
      <StatusBar style="dark" />
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      >
        <Tabs.Screen name="index" options={{ title: t('tabs.discover') }} />
        <Tabs.Screen name="bookings" options={{ title: t('tabs.bookings') }} />
        <Tabs.Screen name="profile" options={{ title: t('tabs.profile') }} />
      </Tabs>
    </>
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
});
