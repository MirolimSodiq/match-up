import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, Card, colors, Divider, Group, ListRow, PageTitle, ScreenGlow, space, TAB_BAR_SPACE, type } from '@matchup/ui';
import { useSession } from '@/auth/session';
import { LanguagePicker } from '@/features/LanguagePicker';
import { APP_VERSION } from '@/lib/device';
import { prettyPhone } from '@/lib/phone';
import { network, useNetwork } from '@/offline/network';
import { useOfflineStore } from '@/offline/store';
import { syncAll } from '@/offline/sync';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user, signOut, offlineProfile } = useSession();
  const { forcedOffline } = useNetwork();
  const pending = useOfflineStore((s) => s.pendingCount(user?.id), [user?.id]);

  const logout = () => {
    if (pending > 0) {
      // Navbatdagi check-in'lar yo'qolmaydi (diskda qoladi), lekin ogohlantiramiz
      Alert.alert(t('profile.logout'), t('profile.logoutBlocked', { count: pending }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('profile.logout'), style: 'destructive', onPress: () => void signOut() },
      ]);
      return;
    }
    void signOut();
  };

  return (
    <View style={styles.root}>
      <ScreenGlow />
      <PageTitle title={t('profile.title')} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card tone="white" style={styles.user}>
          <Avatar name={user?.display_name} size={56} />
          <View style={styles.flex}>
            <Text style={type.title}>{user?.display_name}</Text>
            <Text style={type.small}>{prettyPhone(user?.phone)}</Text>
            <View style={styles.badges}>
              <Badge tone="success" icon="shield-checkmark" label={t('profile.role')} />
              {offlineProfile ? <Badge tone="warning" icon="cloud-offline-outline" label={t('matches.cachedOffline')} /> : null}
            </View>
          </View>
        </Card>

        <Group title={t('profile.queue')}>
          <Card tone="white">
            <ListRow
              icon={pending ? 'cloud-upload-outline' : 'cloud-done-outline'}
              title={pending ? t('sync.queued', { count: pending }) : t('sync.synced')}
              accessory={pending ? 'chevron' : 'none'}
              onPress={pending ? syncAll : undefined}
            />
          </Card>
        </Group>

        <Group title={t('profile.language')}>
          <Card tone="white">
            <LanguagePicker variant="rows" />
          </Card>
        </Group>

        {__DEV__ ? (
          <Group title={t('profile.dev')}>
            <Card tone="white">
              <ListRow
                icon="airplane-outline"
                title={t('profile.devOffline')}
                subtitle={t('profile.devOfflineHint')}
                toggle={{ value: forcedOffline, onChange: (v) => void network.setForcedOffline(v) }}
              />
            </Card>
          </Group>
        ) : null}

        <Group title={t('profile.app')}>
          <Card tone="white">
            <ListRow icon="log-out-outline" title={t('profile.logout')} destructive onPress={logout} />
          </Card>
        </Group>
        <Divider />
        <Text style={[type.caption, styles.version]}>{t('profile.version', { version: APP_VERSION })}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, gap: 2 },
  content: { paddingHorizontal: space.lg, paddingBottom: TAB_BAR_SPACE + space.lg, gap: space.md },
  user: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  version: { textAlign: 'center' },
});
