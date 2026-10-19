import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useCities, useMe, useSports, useWallet } from '@/api/queries';
import { useSession } from '@/auth/session';
import { colors, fontFamily, gradients, radius, space, sportColors, type } from '@/components/theme';
import { Avatar, Card, Divider, ErrorView, Group, ListRow, Loading, PageTitle, ScreenGlow, TAB_BAR_SPACE } from '@/components/ui';
import { LanguagePicker } from '@/features/LanguagePicker';
import { SportIcon } from '@/features/MatchCard';
import { prettyPhone } from '@/features/phone';
import { APP_VERSION } from '@/lib/device';
import { money } from '@/lib/money';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { signOut } = useSession();
  const me = useMe();
  const cities = useCities();
  const sports = useSports();
  const city = cities.data?.find((c) => c.id === me.data?.home_city_id);
  const wallet = useWallet();

  const body = () => {
    if (me.isPending) return <Loading />;
    if (me.error) return <ErrorView error={me.error} onRetry={() => void me.refetch()} />;
    const u = me.data;
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {/* Hisob kartasi */}
        <Card tone="white" style={styles.account}>
          <Avatar name={u.display_name} size={60} />
          <View style={styles.flex}>
            <Text style={type.title} numberOfLines={1}>
              {u.display_name}
            </Text>
            <Text style={type.small}>{prettyPhone(u.phone)}</Text>
          </View>
        </Card>

        {/* Hamyon banneri */}
        <View style={styles.wallet}>
          <LinearGradient colors={gradients.promo} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={styles.walletHead}>
            <View style={styles.walletIcon}>
              <Ionicons name="wallet" size={18} color={colors.primary} />
            </View>
            <Text style={styles.walletLabel}>{t('profile.wallet')}</Text>
          </View>
          <Text testID="wallet-balance" style={styles.walletAmount}>
            {wallet.isPending ? '…' : money(wallet.data?.balance)}
          </Text>
          <Text style={styles.walletHint}>{t('profile.walletHint')}</Text>
        </View>

        {/* Statistika */}
        <View style={styles.stats}>
          <Stat label={t('profile.gamesPlayed')} value={u.stats?.games_played ?? 0} />
          <Stat label={t('profile.noShows')} value={u.stats?.no_show_count ?? 0} />
        </View>

        <Group title={t('profile.account')}>
          <Card tone="white" style={styles.list}>
            <ListRow icon="call-outline" title={t('profile.phone')} value={prettyPhone(u.phone)} />
            <Divider />
            <ListRow icon="business-outline" title={t('profile.city')} value={city?.name ?? '—'} />
            {u.sports?.map((s) => (
              <View key={s.sport}>
                <Divider />
                <ListRow
                  left={<SportIcon sport={s.sport ?? ''} size={20} color={sportColors(s.sport).base} />}
                  title={sports.data?.find((x) => x.code === s.sport)?.name ?? s.sport ?? ''}
                  value={s.self_level ? t(`levels.${s.self_level}`) : '—'}
                />
              </View>
            ))}
          </Card>
        </Group>

        <Group title={t('profile.language')}>
          <Card tone="white" style={styles.list}>
            <LanguagePicker variant="rows" />
          </Card>
        </Group>

        <Group title={t('profile.app')}>
          <Card tone="white" style={styles.list}>
            <ListRow icon="log-out-outline" title={t('profile.logout')} destructive onPress={() => void signOut()} />
          </Card>
        </Group>

        <Text style={[type.caption, styles.version]}>{t('profile.version', { version: APP_VERSION })}</Text>
      </ScrollView>
    );
  };

  return (
    <View style={styles.root}>
      <ScreenGlow />
      <PageTitle title={t('tabs.profile')} />
      {body()}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card tone="white" style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={type.small}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: TAB_BAR_SPACE + space.lg, gap: space.md },
  account: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  wallet: { borderRadius: radius.lg, padding: space.lg, gap: space.xs, overflow: 'hidden' },
  walletHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  walletIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletLabel: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.onPrimary },
  walletAmount: { ...type.display, fontSize: 40, lineHeight: 48, color: colors.onPrimary, marginTop: space.sm },
  walletHint: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, color: colors.onPrimaryMuted },
  stats: { flexDirection: 'row', gap: space.md },
  stat: { flex: 1, gap: 0 },
  statValue: { fontFamily: fontFamily.display, fontSize: 34, lineHeight: 40, color: colors.text },
  list: { paddingVertical: space.xs, gap: 0 },
  version: { textAlign: 'center', marginTop: space.sm },
});
