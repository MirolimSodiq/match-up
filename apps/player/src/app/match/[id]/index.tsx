import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { MatchDetail } from '@matchup/contracts';
import { isApiError } from '@/api/errors';
import { useMatch, useSports } from '@/api/queries';
import { colors, font, radius, space } from '@/components/theme';
import { Body, Button, Card, EmptyState, ErrorView, Footer, H2, Loading, Muted, Notice, Screen } from '@/components/ui';
import { SlotsBadge, SportIcon } from '@/features/MatchCard';
import { currentLocale } from '@/i18n';
import { formatDay, formatTime } from '@/lib/datetime';
import { money } from '@/lib/money';

export default function MatchScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const match = useMatch(id);
  const sports = useSports();

  if (match.isPending) return <Loading />;
  if (match.error) {
    if (isApiError(match.error, 'NOT_FOUND')) return <EmptyState title={t('match.notFound')} />;
    return <ErrorView error={match.error} onRetry={() => void match.refetch()} />;
  }
  const m = match.data;
  const sportName = sports.data?.find((s) => s.code === m.sport)?.name ?? m.sport;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: m.public_code ?? '' }} />
      <Screen>
        <MatchHero match={m} sportName={sportName} />
        <PlayersCard match={m} />
        <InfoCard match={m} />
        {m.description ? (
          <Card>
            <Text style={font.h3}>{t('match.about')}</Text>
            <Body>{m.description}</Body>
          </Card>
        ) : null}
      </Screen>
      <Footer>
        <BookingCta match={m} />
      </Footer>
    </View>
  );
}

function MatchHero({ match: m, sportName }: { match: MatchDetail; sportName: string }) {
  const locale = currentLocale();
  return (
    <Card style={{ gap: space.md }}>
      <View style={styles.row}>
        <View style={styles.sportPill}>
          <SportIcon sport={m.sport} size={16} color={colors.primaryDark} />
          <Text style={styles.sportPillText}>
            {sportName} · {m.format}
          </Text>
        </View>
        <SlotsBadge match={m} />
      </View>
      <H2>{m.title || m.venue.name}</H2>
      <View style={styles.iconLine}>
        <Ionicons name="calendar-outline" size={18} color={colors.muted} />
        <Body>
          {formatDay(m.starts_at, m.timezone, locale)}, {formatTime(m.starts_at, m.timezone)}–{formatTime(m.ends_at, m.timezone)}
        </Body>
      </View>
      <View style={styles.iconLine}>
        <Ionicons name="location-outline" size={18} color={colors.muted} />
        <View style={{ flex: 1 }}>
          <Body>{m.venue.name}</Body>
          {m.venue.address ? <Muted>{m.venue.address}</Muted> : null}
        </View>
      </View>
      <View style={styles.iconLine}>
        <Ionicons name="cash-outline" size={18} color={colors.muted} />
        <Text style={styles.price}>{money(m.price)}</Text>
      </View>
    </Card>
  );
}

function PlayersCard({ match: m }: { match: MatchDetail }) {
  const { t } = useTranslation();
  const pct = Math.min(100, Math.round((m.slots.taken / Math.max(m.slots.max, 1)) * 100));
  const players = m.participants_preview ?? [];
  return (
    <Card>
      <View style={styles.row}>
        <Text style={font.h3}>{t('match.players')}</Text>
        <Text style={font.h3}>
          {m.slots.taken} / {m.slots.max}
        </Text>
      </View>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      {m.slots.min_to_play ? <Muted>{t('match.minToPlay', { count: m.slots.min_to_play })}</Muted> : null}
      {players.length === 0 ? (
        <Muted>{t('match.noPlayersYet')}</Muted>
      ) : (
        <View style={styles.players}>
          {players.map((p, i) => (
            <View key={i} style={styles.player}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(p.display_name ?? '?').slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={styles.playerName} numberOfLines={1}>
                {p.display_name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

function InfoCard({ match: m }: { match: MatchDetail }) {
  const { t } = useTranslation();
  const min = m.level?.min;
  const max = m.level?.max;
  const level =
    min || max ? [min && t(`levels.${min}`), max && t(`levels.${max}`)].filter(Boolean).join(' – ') : t('match.anyLevel');
  return (
    <Card style={{ gap: space.md }}>
      <InfoLine icon="podium-outline" label={t('match.level')} value={level} />
      <InfoLine
        icon="person-outline"
        label={t('match.host')}
        value={m.host_assigned ? t('match.hostAssigned') : t('match.hostPending')}
      />
      {m.cancellation_policy?.summary ? (
        <InfoLine icon="refresh-outline" label={t('match.cancellationPolicy')} value={m.cancellation_policy.summary} />
      ) : null}
      {m.booking_closes_at ? (
        <Muted>{t('match.bookingCloses', { time: formatTime(m.booking_closes_at, m.timezone) })}</Muted>
      ) : null}
    </Card>
  );
}

function InfoLine({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.iconLine}>
      <Ionicons name={icon} size={18} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <Muted>{label}</Muted>
        <Body>{value}</Body>
      </View>
    </View>
  );
}

function BookingCta({ match: m }: { match: MatchDetail }) {
  const { t } = useTranslation();
  const mine = m.my_booking;
  if (mine) {
    const confirmed = mine.status === 'confirmed';
    return (
      <>
        <Notice tone={confirmed ? 'success' : 'warning'}>{confirmed ? t('match.youAreIn') : t('match.pendingPayment')}</Notice>
        <Button
          title={t('match.openBooking')}
          variant="secondary"
          onPress={() => router.push({ pathname: '/booking/[id]', params: { id: mine.id } })}
        />
      </>
    );
  }
  const closed = m.status !== 'open' && m.status !== 'full';
  const pastDeadline = m.booking_closes_at ? new Date(m.booking_closes_at).getTime() <= Date.now() : false;
  if (m.status === 'full' || m.slots.available <= 0) return <Button title={t('match.full')} disabled />;
  if (closed || pastDeadline) return <Button title={t('match.closed')} disabled />;

  const next = m.waiver?.signed ? '/match/[id]/checkout' : '/match/[id]/waiver';
  return (
    <Button
      testID="book"
      title={t('match.book', { price: money(m.price) })}
      onPress={() => router.push({ pathname: next, params: { id: m.id } })}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  sportPillText: { color: colors.primaryDark, fontWeight: '600', fontSize: 13 },
  iconLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  price: { fontSize: 17, fontWeight: '700', color: colors.text },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.primary },
  players: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.xs },
  player: { alignItems: 'center', width: 64, gap: 4 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontWeight: '700', fontSize: 18 },
  playerName: { fontSize: 12, color: colors.text },
});
