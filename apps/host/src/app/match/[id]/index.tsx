import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  BottomSheet,
  Button,
  Card,
  colors,
  Divider,
  EmptyState,
  ErrorView,
  fontFamily,
  IconButton,
  Loading,
  Notice,
  radius,
  space,
  type SportColors,
  sportColors,
  SportIcon,
  SportTexture,
  type,
  useToast,
  useUI,
} from '@matchup/ui';
import { api, call } from '@/api/client';
import { ApiError } from '@/api/errors';
import { currentLocale } from '@/i18n';
import { formatDay, formatTime } from '@/lib/datetime';
import { money } from '@/lib/money';
import { formatDistance, useNow } from '@/lib/time';
import { HighlightsSection } from '@/features/Highlights';
import { RecordingSection } from '@/features/Recording';
import { BibEditor, CheckinProgress, ParticipantRow, SyncBanner } from '@/features/Roster';
import { useMatchControl } from '@/features/useMatchControl';
import { type CheckinAction, distanceFromDetail, distanceMeters, type ParticipantView } from '@/offline/core';
import { enqueueCheckin, syncMatch } from '@/offline/sync';

/** Server bilan bir xil (apps/api env GEOFENCE_METERS, standart 200 m). */
const GEOFENCE_M = 200;

export default function MatchControlScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const ctl = useMatchControl(id);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ParticipantView>();
  // Check-in paytida ekran o'chib qolmasin
  useKeepAwake();

  const m = ctl.summary;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? ctl.participants.filter((p) => p.display_name.toLowerCase().includes(q)) : ctl.participants;
    // Kutilayotganlar tepada — maydonda kimni kutayotganimiz ko'rinsin
    const order = { confirmed: 0, checked_in: 1, no_show: 2 } as const;
    return [...list].sort((a, b) => order[a.status] - order[b.status] || a.display_name.localeCompare(b.display_name));
  }, [ctl.participants, query]);

  if (!m) {
    return (
      <View style={[styles.plain, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.plainBar}>
          <IconButton icon="chevron-back" label={t('common.close')} onPress={() => router.back()} />
        </View>
        {ctl.roster.isPending ? (
          <Loading />
        ) : ctl.roster.error instanceof ApiError && ctl.roster.error.code === 'NETWORK' ? (
          <EmptyState icon="cloud-offline-outline" title={t('match.noCache')} action={<Button title={t('common.retry')} onPress={() => void ctl.roster.refetch()} />} />
        ) : (
          <ErrorView error={ctl.roster.error} onRetry={() => void ctl.roster.refetch()} />
        )}
      </View>
    );
  }

  const sc = sportColors(m.sport);
  const status = ctl.hostMatch?.assignment_status ?? 'accepted';
  const active = status === 'accepted' || status === 'arrived';
  const sideByNo = new Map(ctl.sides.map((s) => [s.side_no, s]));

  const act = (p: ParticipantView, action: CheckinAction) => {
    enqueueCheckin({ matchId: id, action, method: 'manual', participantId: p.participant_id, displayName: p.display_name });
    void Haptics.notificationAsync(action === 'check_in' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    setSelected(undefined);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={[styles.overscroll, { backgroundColor: sc.base }]} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.hero, { backgroundColor: sc.base, paddingTop: insets.top + space.sm }]}>
          <View style={styles.texture} pointerEvents="none">
            <SportTexture sport={m.sport} opacity={0.12} strokeWidth={2.5} fadeBottom />
          </View>
          <View style={styles.bar}>
            <IconButton icon="chevron-back" label={t('common.close')} variant="glass" onPress={() => router.back()} />
            {m.public_code ? <Text style={[styles.code, { color: sc.muted }]}>{m.public_code}</Text> : null}
          </View>
          <View style={styles.titleBlock}>
            <View style={styles.pill}>
              <SportIcon sport={m.sport} size={14} color={colors.onSport} />
              <Text style={styles.pillText}>
                {m.format} · {t(`matches.status.${status}`)}
              </Text>
            </View>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
              {m.title || m.venue.name}
            </Text>
            <Text style={styles.time}>
              {formatTime(m.starts_at, m.timezone)}–{formatTime(m.ends_at, m.timezone)}
            </Text>
            <Text style={[styles.day, { color: sc.muted }]}>{formatDay(m.starts_at, m.timezone, currentLocale())}</Text>
          </View>
          <InfoGlass sc={sc} rows={[
            [t('match.venue'), m.venue.name ?? ''],
            [t('match.address'), m.venue.address ?? '—'],
            ...(ctl.hostMatch?.venue_contact ? [[t('match.contact'), ctl.hostMatch.venue_contact] as [string, string]] : []),
            [t('match.fee'), money(ctl.hostMatch?.fee)],
          ]} />
          {active ? <ArriveSection matchId={id} arrived={status === 'arrived'} venue={m.venue.location} timeZone={m.timezone} /> : null}
        </View>

        <View style={styles.body}>
          <SyncBanner
            sync={ctl.sync}
            pending={ctl.pendingCount}
            onPress={() => router.push({ pathname: '/match/[id]/sync', params: { id } })}
            onSyncNow={() => void syncMatch(id)}
          />
          {ctl.rosterData?.fromCache ? (
            <Notice tone="warning" icon="cloud-offline-outline">
              {t('match.cachedAt', { time: formatTime(new Date(ctl.rosterData.fetchedAt).toISOString(), m.timezone) })}
            </Notice>
          ) : null}

          {active ? (
            <>
              <Button
                testID="open-scanner"
                title={t('match.scan')}
                icon="qr-code-outline"
                onPress={() => router.push({ pathname: '/match/[id]/scan', params: { id } })}
              />
              <View style={styles.actions}>
                <Button
                  title={t('match.teams')}
                  icon="shirt-outline"
                  variant="secondary"
                  style={styles.flex}
                  onPress={() => router.push({ pathname: '/match/[id]/teams', params: { id } })}
                />
                <CompleteButton startsAt={m.starts_at} timeZone={m.timezone} onPress={() => router.push({ pathname: '/match/[id]/complete', params: { id } })} />
              </View>
            </>
          ) : status === 'completed' ? (
            <Notice tone="success" icon="flag">
              {t('match.completed')}
            </Notice>
          ) : null}

          <View style={styles.sectionHead}>
            <Text style={type.section}>{t('match.roster')}</Text>
            <Text style={styles.big}>
              {ctl.counts.checked}/{ctl.counts.total}
            </Text>
          </View>
          <CheckinProgress checked={ctl.counts.checked} total={ctl.counts.total} />
          <Text style={type.small}>{t('match.counts', ctl.counts)}</Text>

          <View style={styles.search}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              testID="roster-search"
              value={query}
              onChangeText={setQuery}
              placeholder={t('match.search')}
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
          </View>

          <Card tone="white" style={styles.list}>
            {filtered.length === 0 ? (
              <Text style={[type.small, styles.emptyList]}>{ctl.participants.length ? t('match.noResults') : t('match.rosterEmpty')}</Text>
            ) : (
              filtered.map((p, i) => (
                <View key={p.participant_id}>
                  {i > 0 ? <Divider /> : null}
                  <ParticipantRow p={p} side={p.side_no ? sideByNo.get(p.side_no) : undefined} onPress={() => active && setSelected(p)} />
                </View>
              ))
            )}
          </Card>

          <RecordingSection matchId={id} canRecord={active || status === 'completed'} />
          <HighlightsSection matchId={id} canUpload={active || status === 'completed'} />
        </View>
      </ScrollView>
      <View style={[styles.statusStrip, { height: insets.top, backgroundColor: sc.base }]} />

      <BottomSheet
        visible={!!selected}
        onClose={() => setSelected(undefined)}
        title={selected?.display_name}
        subtitle={selected ? t(`match.participant.${selected.status}`) : undefined}
      >
        {selected ? (
          <View style={styles.sheetActions}>
            {selected.status !== 'checked_in' ? (
              <Button testID="manual-checkin" title={t('match.checkIn')} icon="checkmark-circle" onPress={() => act(selected, 'check_in')} />
            ) : null}
            {selected.status !== 'confirmed' ? <Button title={t('match.undo')} icon="arrow-undo" variant="secondary" onPress={() => act(selected, 'undo')} /> : null}
            {selected.status === 'confirmed' ? <Button title={t('match.noShow')} icon="close-circle-outline" variant="danger" onPress={() => act(selected, 'no_show')} /> : null}
            {selected.status !== 'no_show' ? <BibEditor key={selected.participant_id} matchId={id} p={selected} /> : null}
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

function InfoGlass({ sc, rows }: { sc: SportColors; rows: [string, string][] }) {
  return (
    <View style={styles.glass}>
      {rows.map(([label, value], i) => (
        <View key={label} style={[styles.infoRow, i < rows.length - 1 && styles.infoRowBorder]}>
          <Text style={[styles.infoLabel, { color: sc.muted }]}>{label}</Text>
          <Text style={styles.infoValue} numberOfLines={2}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** "Maydondaman": joylashuv -> POST arrive; geofence'dan tashqarida — masofa. */
function ArriveSection({
  matchId,
  arrived,
  venue,
  timeZone,
}: {
  matchId: string;
  arrived: boolean;
  venue?: { lat: number; lng: number };
  timeZone: string;
}) {
  const { t } = useTranslation();
  const { formatError } = useUI();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [outside, setOutside] = useState<number | null>();

  const arrive = useMutation({
    mutationFn: async () => {
      setOutside(undefined);
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== Location.PermissionStatus.GRANTED) throw new LocationError('denied');
      const pos =
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null)) ??
        (await Location.getLastKnownPositionAsync({ maxAge: 60_000 }));
      if (!pos) throw new LocationError('unavailable');
      const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      try {
        return await call(
          api.POST('/v1/host/matches/{matchId}/arrive', {
            params: { path: { matchId } },
            body: { location, accuracy_m: pos.coords.accuracy ?? undefined },
          }),
        );
      } catch (err) {
        if (err instanceof ApiError && err.code === 'OUTSIDE_GEOFENCE') {
          // Masofa server javobida (detail), bo'lmasa — o'zimiz hisoblaymiz
          throw new OutsideError(distanceFromDetail(err.problem?.detail) ?? (venue ? Math.round(distanceMeters(location, venue)) : null));
        }
        throw err;
      }
    },
    onSuccess: (r) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast({ message: t('match.arrivedToast', { m: r.distance_m ?? 0 }), icon: 'location' });
      void queryClient.invalidateQueries({ queryKey: ['host-matches'] });
    },
    onError: (err) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (err instanceof OutsideError) setOutside(err.distance);
      else if (err instanceof LocationError) toast({ message: t(err.kind === 'denied' ? 'match.locationDenied' : 'match.locationUnavailable'), icon: 'location-outline' });
      else if (err instanceof ApiError && err.code === 'NETWORK') toast({ message: t('match.needsInternet'), icon: 'cloud-offline-outline' });
      else toast({ message: formatError(err), icon: 'alert-circle' });
    },
  });

  if (arrived) {
    const at = arrive.data?.arrived_at;
    return (
      <View style={[styles.pill, styles.arrivedPill]}>
        <Ionicons name="location" size={14} color={colors.onSport} />
        <Text style={styles.pillText}>{at ? t('match.arrivedAt', { time: formatTime(at, timeZone) }) : t('matches.status.arrived')}</Text>
      </View>
    );
  }

  const units = { m: (v: number) => t('common.meters', { m: v }), km: (v: string) => t('common.km', { km: v }) };
  return (
    <View style={styles.arrive}>
      <Button
        testID="arrive"
        title={arrive.isPending ? t('match.locating') : t('match.arrive')}
        icon="location-outline"
        variant="light"
        loading={arrive.isPending}
        onPress={() => arrive.mutate()}
      />
      {outside !== undefined ? (
        <View style={styles.outside} accessibilityRole="alert">
          <Ionicons name="navigate-circle" size={28} color={colors.danger} />
          <View style={styles.flex}>
            <Text style={[type.bodyStrong, { color: colors.danger }]}>{t('match.outsideTitle')}</Text>
            <Text style={type.small}>
              {t('match.outsideBody', { distance: outside != null ? formatDistance(outside, units) : '—', limit: GEOFENCE_M })}
            </Text>
          </View>
        </View>
      ) : (
        <Text style={styles.arriveHint}>{t('match.arriveHint', { limit: GEOFENCE_M })}</Text>
      )}
    </View>
  );
}

class LocationError extends Error {
  constructor(readonly kind: 'denied' | 'unavailable') {
    super(kind);
  }
}
class OutsideError extends Error {
  constructor(readonly distance: number | null) {
    super('OUTSIDE_GEOFENCE');
  }
}

/** Yakunlash faqat o'yin boshlangandan keyin (server `INVALID_STATE` qaytaradi). */
function CompleteButton({ startsAt, timeZone, onPress }: { startsAt: string; timeZone: string; onPress: () => void }) {
  const { t } = useTranslation();
  const now = useNow(15_000);
  const started = new Date(startsAt).getTime() <= now;
  return (
    <View style={styles.flex}>
      <Button testID="open-complete" title={t('match.complete')} icon="flag-outline" variant="secondary" disabled={!started} onPress={onPress} />
      {!started ? <Text style={[type.caption, styles.lockHint]}>{t('match.completeLocked', { time: formatTime(startsAt, timeZone) })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: colors.bg },
  plain: { flex: 1, backgroundColor: colors.bg },
  plainBar: { paddingHorizontal: space.lg },
  overscroll: { position: 'absolute', top: 0, left: 0, right: 0, height: 400 },
  statusStrip: { position: 'absolute', top: 0, left: 0, right: 0 },
  scroll: { flexGrow: 1, backgroundColor: colors.bg },
  hero: {
    overflow: 'hidden',
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    gap: space.lg,
  },
  texture: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: 0.8 },
  titleBlock: { alignItems: 'center', gap: space.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.sportShade,
  },
  pillText: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.onSport },
  title: { ...type.display, color: colors.onSport, textAlign: 'center', marginTop: space.xs },
  time: { fontFamily: fontFamily.display, fontSize: 52, lineHeight: 60, color: colors.onSport },
  day: { fontFamily: fontFamily.medium, fontSize: 14 },
  glass: {
    backgroundColor: colors.sportGlass,
    borderColor: colors.sportGlassBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  infoRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.sportGlassBorder },
  infoLabel: { fontFamily: fontFamily.medium, fontSize: 14 },
  infoValue: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.onSport, flexShrink: 1, textAlign: 'right' },
  arrive: { gap: space.sm },
  arriveHint: { fontFamily: fontFamily.medium, fontSize: 13, color: colors.onPrimaryMuted, textAlign: 'center' },
  arrivedPill: { paddingVertical: space.sm },
  outside: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
  },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl * 2 },
  actions: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  lockHint: { textAlign: 'center', marginTop: space.xs },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: space.md },
  big: { fontFamily: fontFamily.display, fontSize: 28, lineHeight: 32, color: colors.text },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
  },
  searchInput: { flex: 1, fontFamily: fontFamily.regular, fontSize: 15, color: colors.text, paddingVertical: 12 },
  list: { paddingVertical: space.xs, gap: 0 },
  emptyList: { textAlign: 'center', paddingVertical: space.lg },
  sheetActions: { gap: space.sm },
});

