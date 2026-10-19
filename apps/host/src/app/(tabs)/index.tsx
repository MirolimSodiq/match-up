import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { colors, EmptyState, ErrorView, ListRow, Divider, Loading, PageTitle, ScreenGlow, space, TAB_BAR_SPACE, useToast, useUI, BottomSheet } from '@matchup/ui';
import { api, call } from '@/api/client';
import { ApiError } from '@/api/errors';
import { qk, useOffers } from '@/api/queries';
import { OfferCard } from '@/features/MatchBlocks';
import { usePullRefresh } from '@/lib/usePullRefresh';

type DeclineReason = 'busy' | 'too_far' | 'other';
const REASONS: DeclineReason[] = ['busy', 'too_far', 'other'];

export default function OffersScreen() {
  const { t } = useTranslation();
  const { formatError } = useUI();
  const toast = useToast();
  const queryClient = useQueryClient();
  const offers = useOffers();
  const pull = usePullRefresh(offers.refetch);
  const [declining, setDeclining] = useState<string>();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.offers });
    void queryClient.invalidateQueries({ queryKey: ['host-matches'] });
  };

  const accept = useMutation({
    mutationFn: (assignmentId: string) => call(api.POST('/v1/host/offers/{assignmentId}/accept', { params: { path: { assignmentId } } })),
    onSuccess: (hm) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast({ message: t('offers.accepted'), icon: 'checkmark-circle' });
      refresh();
      if (hm.match?.id) router.push({ pathname: '/match/[id]', params: { id: hm.match.id } });
    },
    onError: (err) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast({ message: formatError(err), icon: 'alert-circle' });
      // OFFER_TAKEN / OFFER_EXPIRED — kartani ro'yxatdan olib tashlash uchun
      if (err instanceof ApiError && err.status === 409) refresh();
    },
  });

  const decline = useMutation({
    mutationFn: (v: { id: string; reason: DeclineReason }) =>
      call(api.POST('/v1/host/offers/{assignmentId}/decline', { params: { path: { assignmentId: v.id } }, body: { reason: v.reason } })),
    onSuccess: () => {
      setDeclining(undefined);
      toast({ message: t('offers.declined'), icon: 'close-circle' });
      refresh();
    },
    onError: (err) => {
      setDeclining(undefined);
      toast({ message: formatError(err), icon: 'alert-circle' });
      refresh();
    },
  });

  const list = offers.data ?? [];
  return (
    <View style={styles.root}>
      <ScreenGlow />
      <PageTitle title={t('offers.title')} subtitle={t('offers.subtitle')} />
      <FlatList
        data={list}
        keyExtractor={(o) => o.assignment_id ?? ''}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.primary} />}
        ItemSeparatorComponent={() => <View style={{ height: space.lg }} />}
        renderItem={({ item }) => (
          <View>
            <OfferCard
              offer={item}
              accepting={accept.isPending && accept.variables === item.assignment_id}
              onAccept={() => item.assignment_id && accept.mutate(item.assignment_id)}
              onDecline={() => setDeclining(item.assignment_id)}
            />
          </View>
        )}
        ListEmptyComponent={
          offers.isLoading ? (
            <Loading />
          ) : offers.error ? (
            <ErrorView error={offers.error} onRetry={() => void offers.refetch()} />
          ) : (
            <EmptyState icon="flash-outline" title={t('offers.empty')} hint={t('offers.emptyHint')} />
          )
        }
      />

      <BottomSheet visible={!!declining} onClose={() => setDeclining(undefined)} title={t('offers.declineTitle')} subtitle={t('offers.declineHint')}>
        <View>
          {REASONS.map((r, i) => (
            <View key={r}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                title={t(`offers.reasons.${r}`)}
                icon={r === 'busy' ? 'calendar-outline' : r === 'too_far' ? 'navigate-outline' : 'ellipsis-horizontal-circle-outline'}
                accessory="chevron"
                onPress={() => declining && !decline.isPending && decline.mutate({ id: declining, reason: r })}
              />
            </View>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: TAB_BAR_SPACE + space.lg },
});
