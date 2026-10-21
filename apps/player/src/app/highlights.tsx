import { useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorView, IconButton, Loading, PageTitle, SegmentedControl, space } from '@matchup/ui';
import { useMyHighlights } from '@/features/highlights/api';
import { HighlightTile } from '@/features/highlights/HighlightTile';

/** Profil feed'i: men o'ynagan match'lar yoki men belgilangan kliplar (cursor pagination). */
export default function MyHighlightsScreen() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'all' | 'tagged'>('all');
  const q = useMyHighlights(scope);
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - space.lg * 2 - space.md) / 2);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View style={styles.root}>
      <PageTitle title={t('highlights.mine')} right={<IconButton icon="close" label={t('common.close')} variant="muted" onPress={() => router.back()} />} />
      <View style={styles.head}>
        <SegmentedControl
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: t('highlights.scopeAll') },
            { value: 'tagged', label: t('highlights.scopeTagged') },
          ]}
        />
      </View>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorView error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(h) => h.id}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <HighlightTile h={item} width={tile} />}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
          onRefresh={() => void q.refetch()}
          refreshing={q.isRefetching && !q.isFetchingNextPage}
          ListEmptyComponent={<EmptyState icon="videocam-outline" title={t(scope === 'tagged' ? 'highlights.emptyTagged' : 'highlights.emptyMine')} hint={t('highlights.emptyHint')} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.md },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl * 2, gap: space.lg },
  column: { gap: space.md },
});
