import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  colors,
  EmptyState,
  ErrorView,
  Loading,
  Notice,
  PageTitle,
  ScreenGlow,
  SegmentedControl,
  space,
  TAB_BAR_SPACE,
  TimelineDay,
} from '@matchup/ui';
import { fetchRoster, qk, useHostMatches } from '@/api/queries';
import { HostMatchBlock } from '@/features/MatchBlocks';
import { currentLocale } from '@/i18n';
import { shortWeekday, zonedParts } from '@/lib/datetime';
import { type DayBucket, groupByDay } from '@/lib/timeline';
import { usePullRefresh } from '@/lib/usePullRefresh';
import type { HostMatch, MatchScope } from '@/offline/store';

/** Shu vaqt ichida boshlanadigan o'yinlarning roster'i oldindan diskka yuklanadi (maydonda internet bo'lmasa ham). */
const PREFETCH_WINDOW_MS = 24 * 3600_000;

export default function MatchesScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<MatchScope>('today');
  const list = useHostMatches(scope);
  const pull = usePullRefresh(list.refetch);
  const items = useMemo(() => list.data?.items ?? [], [list.data]);

  // Bugungi/yaqin o'yinlar roster'ini (QR public key bilan) oldindan keshlash
  useEffect(() => {
    if (scope === 'past' || list.data?.fromCache) return;
    const now = Date.now();
    for (const hm of items) {
      const id = hm.match?.id;
      if (!id || !hm.match || (hm.assignment_status !== 'accepted' && hm.assignment_status !== 'arrived')) continue;
      if (new Date(hm.match.starts_at).getTime() - now > PREFETCH_WINDOW_MS) continue;
      void queryClient.prefetchQuery({ queryKey: qk.roster(id), queryFn: () => fetchRoster(id), staleTime: 60_000 });
    }
  }, [items, scope, list.data?.fromCache, queryClient]);

  const days = useMemo(
    () => groupByDay(items.filter((m) => m.match), (m) => ({ startsAt: m.match!.starts_at, timeZone: m.match!.timezone })),
    [items],
  );

  const renderDay = ({ item }: { item: DayBucket<HostMatch> }) => (
    <TimelineDay
      weekday={shortWeekday(item.date, item.timeZone, currentLocale())}
      day={zonedParts(item.date, item.timeZone).day}
      today={item.today}
    >
      {item.items.map((hm) => (
        <HostMatchBlock
          key={hm.assignment_id}
          item={hm}
          onPress={() => router.push({ pathname: '/match/[id]', params: { id: hm.match!.id } })}
        />
      ))}
    </TimelineDay>
  );

  return (
    <View style={styles.root}>
      <ScreenGlow />
      <PageTitle title={t('matches.title')} />
      <View style={styles.tabs}>
        <SegmentedControl
          value={scope}
          onChange={setScope}
          options={[
            { value: 'today', label: t('matches.today') },
            { value: 'upcoming', label: t('matches.upcoming') },
            { value: 'past', label: t('matches.past') },
          ]}
        />
        {list.data?.fromCache ? (
          <Notice tone="warning" icon="cloud-offline-outline">
            {t('matches.cachedOffline')}
          </Notice>
        ) : null}
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={days}
        keyExtractor={(d) => d.key}
        renderItem={renderDay}
        ListEmptyComponent={
          list.isPending ? (
            <Loading />
          ) : list.error ? (
            <ErrorView error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            <EmptyState icon="calendar-outline" title={scope === 'today' ? t('matches.emptyToday') : t('matches.empty')} hint={t('matches.emptyHint')} />
          )
        }
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.primary} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  tabs: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  list: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingBottom: TAB_BAR_SPACE + space.lg, gap: space.xl },
});
