import Ionicons from '@expo/vector-icons/Ionicons';
import { type PropsWithChildren, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { createEventInCalendarAsync } from 'expo-calendar/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { MatchDetail } from '@matchup/contracts';
import { Avatar, Button, colors, EmptyState, ErrorView, fontFamily, IconButton, Loading, radius, space, type SportColors, sportColors, SportIcon, SportTexture, type } from '@matchup/ui';
import { isApiError } from '@/api/errors';
import { useMatch, useSports } from '@/api/queries';
import { currentLocale } from '@/i18n';
import { formatDay, formatTime, zonedParts } from '@/lib/datetime';
import { money } from '@/lib/money';
import { errorMessage } from '@/i18n/errors';

/** Gridda ko'rsatiladigan o'rinlar chegarasi (katta match'larda ro'yxat cho'zilib ketmasin). */
const MAX_SLOTS_SHOWN = 16;

export default function MatchScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const match = useMatch(id);
  const sports = useSports();

  if (match.isPending || match.error) {
    return (
      <View style={styles.plain}>
        <View style={styles.plainClose}>
          <IconButton icon="close" label={t('common.close')} variant="muted" onPress={() => router.back()} />
        </View>
        {match.isPending ? (
          <Loading />
        ) : isApiError(match.error, 'NOT_FOUND') ? (
          <EmptyState icon="help-circle-outline" title={t('match.notFound')} />
        ) : (
          <ErrorView error={match.error} onRetry={() => void match.refetch()} />
        )}
      </View>
    );
  }

  const m = match.data;
  const sc = sportColors(m.sport);
  const sportName = sports.data?.find((s) => s.code === m.sport)?.name ?? m.sport;
  return <MatchView match={m} sc={sc} sportName={sportName} />;
}

function MatchView({ match: m, sc, sportName }: { match: MatchDetail; sc: SportColors; sportName: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Modal native qatlamda: root'dagi toast uning ostida qoladi — natijani tugma ikonasida ko'rsatamiz
  const [inCalendar, setInCalendar] = useState(false);
  const locale = currentLocale();
  const start = formatTime(m.starts_at, m.timezone);
  const end = formatTime(m.ends_at, m.timezone);
  const title = m.title || m.venue.name || m.format;

  const share = () => {
    const when = `${formatDay(m.starts_at, m.timezone, locale)}, ${start}`;
    void Share.share({ message: t('match.shareText', { title, when, code: m.public_code ?? '' }) });
  };

  const addToCalendar = async () => {
    try {
      const res = await createEventInCalendarAsync({
        title,
        startDate: new Date(m.starts_at),
        endDate: new Date(m.ends_at),
        timeZone: m.timezone,
        location: [m.venue.name, m.venue.address].filter(Boolean).join(', '),
        notes: m.public_code ? `Match Up · ${m.public_code}` : undefined,
      });
      if (res.action === 'saved' || res.action === 'done') {
        setInCalendar(true);
        AccessibilityInfo.announceForAccessibility(t('match.calendarAdded'));
      }
    } catch (e) {
      Alert.alert(t('match.addToCalendar'), errorMessage(t, e));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: sc.base }]}>
      <LinearGradient colors={[sc.base, sc.deep]} style={StyleSheet.absoluteFill} />
      <View style={styles.texture} pointerEvents="none">
        <SportTexture sport={m.sport} opacity={0.12} strokeWidth={2.5} fadeBottom />
      </View>

      <View style={[styles.topBar, { paddingTop: Platform.OS === 'ios' ? space.lg : insets.top + space.md }]}>
        <View style={styles.formatPill}>
          <SportIcon sport={m.sport} size={15} color={colors.onSport} />
          <Text style={styles.formatPillText} numberOfLines={1}>
            {sportName} · {m.format}
          </Text>
        </View>
        <IconButton icon="close" label={t('common.close')} variant="glass" onPress={() => router.back()} />
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>

        <View style={styles.clockBlock} accessible accessibilityLabel={`${relativeDay(m, t, locale)}, ${start}–${end}`}>
          <Text style={[styles.relDay, { color: sc.muted }]}>{relativeDay(m, t, locale)}</Text>
          <Text style={type.clock}>{start}</Text>
          <Text style={[styles.range, { color: sc.muted }]}>
            {start} – {end}
          </Text>
        </View>

        <Glass>
          <InfoRow sc={sc} label={t('match.venue')} value={m.venue.name ?? '—'} />
          {m.venue.address ? <InfoRow sc={sc} label={t('match.address')} value={m.venue.address} /> : null}
          <InfoRow sc={sc} label={t('match.price')} value={money(m.price)} />
          <InfoRow
            sc={sc}
            label={t('match.slots')}
            value={t('match.slotsValue', { left: Math.max(0, m.slots.available), max: m.slots.max })}
          />
          <InfoRow sc={sc} label={t('match.level')} value={levelLabel(m, t)} />
          <InfoRow sc={sc} label={t('match.host')} value={m.host_assigned ? t('match.hostAssigned') : t('match.hostPending')} last />
        </Glass>

        <Players match={m} sc={sc} />

        {m.cancellation_policy?.summary || m.booking_closes_at ? (
          <Glass>
            <Text style={[styles.blockLabel, { color: sc.muted }]}>{t('match.cancellationPolicy')}</Text>
            {m.cancellation_policy?.summary ? <Text style={styles.blockText}>{m.cancellation_policy.summary}</Text> : null}
            {m.booking_closes_at ? (
              <Text style={[styles.blockNote, { color: sc.muted }]}>
                {t('match.bookingCloses', { time: formatTime(m.booking_closes_at, m.timezone) })}
              </Text>
            ) : null}
          </Glass>
        ) : null}

        {m.description ? (
          <Glass>
            <Text style={[styles.blockLabel, { color: sc.muted }]}>{t('match.about')}</Text>
            <Text style={styles.blockText}>{m.description}</Text>
          </Glass>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <MyBookingNote match={m} />
        <View style={styles.footerRow}>
          <IconButton icon="share-outline" label={t('match.share')} variant="glass" size={52} onPress={share} />
          <View style={styles.flex}>
            <BookingCta match={m} />
          </View>
          {Platform.OS === 'web' ? null : (
            <IconButton
              icon={inCalendar ? 'checkmark-done' : 'calendar-outline'}
              label={inCalendar ? t('match.calendarAdded') : t('match.addToCalendar')}
              variant="glass"
              size={52}
              onPress={() => void addToCalendar()}
            />
          )}
        </View>
      </View>
    </View>
  );
}

/** "Bugun" / "Ertaga" / "21-oktabr, Chorshanba" — match vaqt zonasida. */
function relativeDay(m: MatchDetail, t: (k: string) => string, locale: ReturnType<typeof currentLocale>): string {
  const p = zonedParts(new Date(m.starts_at), m.timezone);
  const now = zonedParts(new Date(), m.timezone);
  const dayIndex = (x: { year: number; month: number; day: number }) => Date.UTC(x.year, x.month - 1, x.day) / 86_400_000;
  const diff = dayIndex(p) - dayIndex(now);
  if (diff === 0) return t('discover.today');
  if (diff === 1) return t('discover.tomorrow');
  return formatDay(m.starts_at, m.timezone, locale);
}

function levelLabel(m: MatchDetail, t: (k: string) => string): string {
  const { min, max } = m.level ?? {};
  if (!min && !max) return t('match.anyLevel');
  return [min && t(`levels.${min}`), max && max !== min && t(`levels.${max}`)].filter(Boolean).join(' – ');
}

function Glass({ children }: PropsWithChildren) {
  return <View style={styles.glass}>{children}</View>;
}

function InfoRow({ sc, label, value, last }: { sc: SportColors; label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text style={[styles.infoLabel, { color: sc.muted }]}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function Players({ match: m, sc }: { match: MatchDetail; sc: SportColors }) {
  const { t } = useTranslation();
  const players = m.participants_preview ?? [];
  const empty = Math.max(0, Math.min(m.slots.max, MAX_SLOTS_SHOWN) - players.length);
  return (
    <View style={styles.players}>
      <View style={styles.playersHead}>
        <Text style={styles.sectionTitle}>{t('match.players')}</Text>
        <Text style={styles.playersCount}>
          {m.slots.taken} / {m.slots.max}
        </Text>
      </View>
      {m.slots.min_to_play ? (
        <Text style={[styles.blockNote, { color: sc.muted }]}>{t('match.minToPlay', { count: m.slots.min_to_play })}</Text>
      ) : null}
      <View style={styles.grid}>
        {players.map((p, i) => (
          <View key={`p${i}`} style={styles.player}>
            <Avatar name={p.display_name} onSport size={48} highlight={p.level === 'advanced' || p.level === 'pro'} />
            <Text style={styles.playerName} numberOfLines={1}>
              {p.display_name}
            </Text>
          </View>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <View key={`e${i}`} style={styles.player}>
            <Avatar onSport empty size={48} />
          </View>
        ))}
      </View>
      {players.length === 0 ? <Text style={[styles.blockNote, { color: sc.muted }]}>{t('match.noPlayersYet')}</Text> : null}
    </View>
  );
}

function MyBookingNote({ match: m }: { match: MatchDetail }) {
  const { t } = useTranslation();
  const mine = m.my_booking;
  if (!mine) return null;
  const confirmed = mine.status === 'confirmed';
  return (
    <View style={styles.mine}>
      <Ionicons name={confirmed ? 'checkmark-circle' : 'time'} size={16} color={colors.onSport} />
      <Text style={styles.mineText}>{confirmed ? t('match.youAreIn') : t('match.pendingPayment')}</Text>
    </View>
  );
}

function BookingCta({ match: m }: { match: MatchDetail }) {
  const { t } = useTranslation();
  const mine = m.my_booking;
  if (mine) {
    return (
      <Button
        title={t('match.openBooking')}
        variant="light"
        icon="ticket-outline"
        onPress={() => {
          // Band sahifasi sheet ichida emas, tab'lar ustida ochilsin
          router.dismissAll();
          router.push({ pathname: '/booking/[id]', params: { id: mine.id } });
        }}
      />
    );
  }
  const closed = m.status !== 'open' && m.status !== 'full';
  const pastDeadline = m.booking_closes_at ? new Date(m.booking_closes_at).getTime() <= Date.now() : false;
  if (m.status === 'full' || m.slots.available <= 0) return <Button title={t('match.full')} variant="light" disabled />;
  if (closed || pastDeadline) return <Button title={t('match.closed')} variant="light" disabled />;

  const next = m.waiver?.signed ? '/match/[id]/checkout' : '/match/[id]/waiver';
  return (
    <Button
      testID="book"
      variant="light"
      style={styles.cta}
      title={t('match.book', { price: money(m.price) })}
      onPress={() => router.push({ pathname: next, params: { id: m.id } })}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  plain: { flex: 1, backgroundColor: colors.bg },
  plainClose: { alignItems: 'flex-end', padding: space.lg },
  root: { flex: 1 },
  texture: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingHorizontal: space.lg },
  formatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.sportShade,
  },
  formatPillText: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.onSport, flexShrink: 1 },
  content: { padding: space.lg, paddingTop: space.xl, gap: space.lg, paddingBottom: space.xxl },
  title: { ...type.display, color: colors.onSport, textAlign: 'center' },
  clockBlock: { alignItems: 'center', marginVertical: space.sm },
  relDay: { fontFamily: fontFamily.displaySemi, fontSize: 20, lineHeight: 26, textTransform: 'uppercase', letterSpacing: 1 },
  range: { fontFamily: fontFamily.medium, fontSize: 14 },
  glass: {
    backgroundColor: colors.sportGlass,
    borderColor: colors.sportGlassBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  infoRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.sportGlassBorder },
  infoLabel: { fontFamily: fontFamily.medium, fontSize: 14 },
  infoValue: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.onSport, flexShrink: 1, textAlign: 'right' },
  blockLabel: { fontFamily: fontFamily.semibold, fontSize: 13, marginTop: space.sm },
  blockText: { ...type.body, color: colors.onSport, marginTop: space.xs, marginBottom: space.sm },
  blockNote: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, marginBottom: space.sm },
  players: { gap: space.sm, marginTop: space.sm },
  playersHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: { fontFamily: fontFamily.display, fontSize: 22, lineHeight: 28, textTransform: 'uppercase', color: colors.onSport },
  playersCount: { fontFamily: fontFamily.display, fontSize: 22, color: colors.onSport },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.xs },
  player: { alignItems: 'center', width: 56, gap: 4 },
  playerName: { fontFamily: fontFamily.medium, fontSize: 11, color: colors.onSport },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cta: { paddingHorizontal: space.md },
  mine: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.sportShade,
  },
  mineText: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.onSport },
});
