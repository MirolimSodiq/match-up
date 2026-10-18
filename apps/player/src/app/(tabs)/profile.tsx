import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useCities, useMatchSearch, useMe, useSports, useWalletBalance } from '@/api/queries';
import { useSession } from '@/auth/session';
import { colors, font, radius, space } from '@/components/theme';
import { Body, Button, Card, Divider, ErrorView, H2, Loading, Muted, Row, Screen } from '@/components/ui';
import { LanguagePicker } from '@/features/LanguagePicker';
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

  // Hamyon balansi payment-methods orqali keladi: o'z booking'imiz bo'lmasa — shahardagi istalgan match
  const nearby = useMatchSearch(city?.center ? { lat: city.center.lat, lng: city.center.lng, radius_km: 50, limit: 1 } : undefined);
  const fallbackMatchId = nearby.data?.pages[0]?.items[0]?.id;
  const wallet = useWalletBalance(fallbackMatchId);

  if (me.isPending) return <Loading />;
  if (me.error) return <ErrorView error={me.error} onRetry={() => void me.refetch()} />;
  const u = me.data;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{u.display_name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <H2>{u.display_name}</H2>
        <Muted>{prettyPhone(u.phone)}</Muted>
      </View>

      <Card style={styles.wallet}>
        <View style={styles.walletHead}>
          <Ionicons name="wallet-outline" size={22} color={colors.white} />
          <Text style={styles.walletLabel}>{t('profile.wallet')}</Text>
        </View>
        <Text testID="wallet-balance" style={styles.walletAmount}>
          {wallet.isPending ? '…' : money(wallet.data)}
        </Text>
        <Text style={styles.walletHint}>{t('profile.walletHint')}</Text>
      </Card>

      <Card>
        <Row label={t('profile.city')} value={city?.name ?? '—'} />
        <Divider />
        <Row label={t('profile.gamesPlayed')} value={String(u.stats?.games_played ?? 0)} />
        <Divider />
        <Row label={t('profile.noShows')} value={String(u.stats?.no_show_count ?? 0)} />
        {u.sports?.length ? <Divider /> : null}
        {u.sports?.map((s) => (
          <Row key={s.sport} label={sports.data?.find((x) => x.code === s.sport)?.name ?? s.sport ?? ''} value={s.self_level ? t(`levels.${s.self_level}`) : '—'} />
        ))}
      </Card>

      <Card>
        <Text style={font.h3}>{t('profile.language')}</Text>
        <LanguagePicker />
      </Card>

      <Button testID="logout" title={t('profile.logout')} variant="danger" onPress={() => void signOut()} />
      <Body style={styles.version}>{t('profile.version', { version: APP_VERSION })}</Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: space.xs, marginVertical: space.md },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  avatarText: { fontSize: 32, fontWeight: '700', color: colors.accent },
  wallet: { backgroundColor: colors.primary, borderColor: colors.primary, gap: space.xs, borderRadius: radius.lg },
  walletHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  walletLabel: { color: colors.white, fontSize: 15, fontWeight: '600' },
  walletAmount: { color: colors.white, fontSize: 30, fontWeight: '800', marginVertical: space.xs },
  walletHint: { color: colors.white, opacity: 0.85, fontSize: 13, lineHeight: 18 },
  version: { textAlign: 'center', color: colors.faint, fontSize: 12 },
});
