import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Booking, BookingStatus } from '@matchup/contracts';
import { type BookingScope, useMyBookings } from '@/api/queries';
import { colors, font, radius, space } from '@/components/theme';
import { Badge, Button, Card, Chip, EmptyState, ErrorView, Loading, Muted } from '@/components/ui';
import { SportIcon } from '@/features/MatchCard';
import { currentLocale } from '@/i18n';
import { formatSlot } from '@/lib/datetime';
import { money } from '@/lib/money';

const TONE: Record<BookingStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending_payment: 'warning',
  confirmed: 'success',
  cancelled: 'danger',
  expired: 'neutral',
  completed: 'neutral',
};

export default function BookingsScreen() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<BookingScope>('upcoming');
  const list = useMyBookings(scope);
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);

  let empty;
  if (list.isPending) empty = <Loading />;
  else if (list.error) empty = <ErrorView error={list.error} onRetry={() => void list.refetch()} />;
  else
    empty = (
      <EmptyState
        title={scope === 'upcoming' ? t('bookings.empty') : t('bookings.emptyPast')}
        action={scope === 'upcoming' ? <Button title={t('bookings.findGame')} onPress={() => router.navigate('/')} /> : undefined}
      />
    );

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(b) => b.id}
      renderItem={({ item }) => <BookingRow booking={item} />}
      ListHeaderComponent={
        <View style={styles.tabs}>
          <Chip label={t('bookings.upcoming')} selected={scope === 'upcoming'} onPress={() => setScope('upcoming')} />
          <Chip label={t('bookings.past')} selected={scope === 'past'} onPress={() => setScope('past')} />
        </View>
      }
      ListEmptyComponent={empty}
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={{ margin: space.lg }} /> : undefined}
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
  );
}

function BookingRow({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const m = b.match;
  return (
    <Card onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <SportIcon sport={m?.sport ?? ''} size={20} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={font.h3} numberOfLines={1}>
            {m?.title || m?.venue.name}
          </Text>
          {m ? <Text style={styles.time}>{formatSlot(m.starts_at, m.ends_at, m.timezone, currentLocale())}</Text> : null}
          <Muted numberOfLines={1}>{m?.venue.name}</Muted>
        </View>
      </View>
      <View style={styles.row}>
        <Badge label={t(`booking.status.${b.status}`)} tone={TONE[b.status]} />
        <Text style={styles.amount}>{money((b.wallet_applied?.amount ?? 0) > 0 ? b.wallet_applied : b.total)}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  tabs: { flexDirection: 'row', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: { fontSize: 14, fontWeight: '600', color: colors.primaryDark },
  amount: { fontSize: 15, fontWeight: '700', color: colors.text },
});
