import { type ReactElement, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Booking, BookingStatus, MatchSummary } from '@matchup/contracts';
import { type BookingScope, useMyBookings } from '@/api/queries';
import { colors, space } from '@/components/theme';
import { Badge, Button, EmptyState, ErrorView, type IconName, ListRow, Loading, PageTitle, ScreenGlow, SegmentedControl, TAB_BAR_SPACE } from '@/components/ui';
import { type DayBucket, DayGroup, groupByDay, MatchBlock } from '@/features/MatchCard';
import { money } from '@/lib/money';

type BookingWithMatch = Booking & { match: MatchSummary };

const STATUS_ICON: Record<BookingStatus, IconName> = {
  pending_payment: 'hourglass',
  confirmed: 'checkmark-circle',
  cancelled: 'close-circle',
  expired: 'time',
  completed: 'flag',
};

export default function BookingsScreen() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<BookingScope>('upcoming');
  const list = useMyBookings(scope);

  const { days, orphans } = useMemo(() => {
    const items = list.data?.pages.flatMap((p) => p.items) ?? [];
    const withMatch = items.filter((b): b is BookingWithMatch => !!b.match);
    return {
      days: groupByDay(withMatch, (b) => ({ startsAt: b.match.starts_at, timeZone: b.match.timezone })),
      // Match ma'lumoti kelmagan (kutilmagan) bandlar — oddiy qator bo'lib pastda
      orphans: items.filter((b) => !b.match),
    };
  }, [list.data]);

  let empty: ReactElement;
  if (list.isPending) empty = <Loading />;
  else if (list.error) empty = <ErrorView error={list.error} onRetry={() => void list.refetch()} />;
  else
    empty = (
      <EmptyState
        icon="ticket-outline"
        title={scope === 'upcoming' ? t('bookings.empty') : t('bookings.emptyPast')}
        action={scope === 'upcoming' ? <Button title={t('bookings.findGame')} icon="search" onPress={() => router.navigate('/')} /> : undefined}
      />
    );

  const open = (b: Booking) => router.push({ pathname: '/booking/[id]', params: { id: b.id } });

  const renderDay = ({ item }: { item: DayBucket<BookingWithMatch> }) => (
    <DayGroup date={item.date} timeZone={item.timeZone} today={item.today}>
      {item.items.map((b) => (
        <MatchBlock
          key={b.id}
          testID={`booking-${b.id}`}
          match={b.match}
          onPress={() => open(b)}
          footer={<Badge tone="sport" icon={STATUS_ICON[b.status]} label={t(`booking.status.${b.status}`)} />}
        />
      ))}
    </DayGroup>
  );

  const footer = (
    <>
      {orphans.map((b) => (
        <ListRow
          key={b.id}
          icon="ticket-outline"
          title={t(`booking.status.${b.status}`)}
          value={money(b.total)}
          accessory="chevron"
          onPress={() => open(b)}
        />
      ))}
      {list.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: space.lg }} /> : null}
    </>
  );

  return (
    <View style={styles.root}>
      <ScreenGlow />
      <PageTitle title={t('tabs.bookings')} />
      <View style={styles.tabs}>
        <SegmentedControl
          value={scope}
          onChange={setScope}
          options={[
            { value: 'upcoming', label: t('bookings.upcoming') },
            { value: 'past', label: t('bookings.past') },
          ]}
        />
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={days}
        keyExtractor={(d) => d.key}
        renderItem={renderDay}
        ListEmptyComponent={orphans.length ? undefined : empty}
        ListFooterComponent={footer}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => void list.refetch()}
            tintColor={colors.primary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  tabs: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  list: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingBottom: TAB_BAR_SPACE + space.lg, gap: space.xl },
});
