import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { colors, FloatingTabBar, type IconName } from '@matchup/ui';
import { useOffers } from '@/api/queries';
import { useSession } from '@/auth/session';
import { useOfflineStore } from '@/offline/store';

const ICONS: Record<string, [IconName, IconName]> = {
  index: ['flash-outline', 'flash'],
  matches: ['calendar-outline', 'calendar'],
  profile: ['person-outline', 'person'],
};

export default function TabsLayout() {
  const { t } = useTranslation();
  const { user } = useSession();
  const offers = useOffers();
  const pending = useOfflineStore((s) => s.pendingCount(user?.id), [user?.id]);
  const badges = { index: offers.data?.length || undefined, profile: pending || undefined };
  return (
    <>
      <StatusBar style="dark" />
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} icons={ICONS} badges={badges} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      >
        <Tabs.Screen name="index" options={{ title: t('tabs.offers') }} />
        <Tabs.Screen name="matches" options={{ title: t('tabs.matches') }} />
        <Tabs.Screen name="profile" options={{ title: t('tabs.profile') }} />
      </Tabs>
    </>
  );
}
