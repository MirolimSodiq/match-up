import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { colors, FloatingTabBar, type IconName } from '@matchup/ui';

const ICONS: Record<string, [IconName, IconName]> = {
  index: ['albums-outline', 'albums'],
  bookings: ['ticket-outline', 'ticket'],
  profile: ['person-outline', 'person'],
};

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <>
      {/* Tab ekranlari och fonda — login hero yoki sport rangidagi sahifadan qaytganda ham to'q status bar */}
      <StatusBar style="dark" />
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} icons={ICONS} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      >
        <Tabs.Screen name="index" options={{ title: t('tabs.discover') }} />
        <Tabs.Screen name="bookings" options={{ title: t('tabs.bookings') }} />
        <Tabs.Screen name="profile" options={{ title: t('tabs.profile') }} />
      </Tabs>
    </>
  );
}
