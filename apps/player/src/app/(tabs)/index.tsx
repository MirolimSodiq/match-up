import Ionicons from '@expo/vector-icons/Ionicons';
import { type ReactElement, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { MatchSummary } from '@matchup/contracts';
import { type MatchSearch, useCities, useMatchSearch, useMe, useSports } from '@/api/queries';
import { colors, radius, space } from '@/components/theme';
import { Button, Chip, EmptyState, ErrorView, Loading, Notice } from '@/components/ui';
import { MatchCard } from '@/features/MatchCard';
import { type OriginMode, useDiscoveryOrigin } from '@/features/useDiscoveryOrigin';
import { currentLocale } from '@/i18n';
import { dayRange, shortWeekday, zonedParts } from '@/lib/datetime';

const RADIUS_KM = 20;
const DAYS_AHEAD = 7;

export default function DiscoverScreen() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const me = useMe();
  const cities = useCities();
  const sports = useSports();

  const [mode, setMode] = useState<OriginMode>('near');
  const [sport, setSport] = useState<string>();
  const [day, setDay] = useState<number>(); // undefined = istalgan kun (server: keyingi 14 kun)
  const [code, setCode] = useState('');

  const city = useMemo(
    () => cities.data?.find((c) => c.id === me.data?.home_city_id) ?? cities.data?.[0],
    [cities.data, me.data?.home_city_id],
  );
  const tz = city?.timezone ?? 'Asia/Tashkent';
  const origin = useDiscoveryOrigin(city, mode);

  const query = useMemo<Omit<MatchSearch, 'cursor'> | undefined>(() => {
    if (!origin) return undefined;
    const range = day === undefined ? undefined : dayRange(tz, day);
    return {
      lat: Number(origin.point.lat.toFixed(5)),
      lng: Number(origin.point.lng.toFixed(5)),
      radius_km: RADIUS_KM,
      sport,
      date_from: range?.from,
      date_to: range?.to,
      sort: 'starts_at',
      limit: 20,
    };
  }, [origin, sport, day, tz]);

  const search = useMatchSearch(query);
  const items = useMemo(() => search.data?.pages.flatMap((p) => p.items) ?? [], [search.data]);
  const sportNames = useMemo(() => new Map(sports.data?.map((s) => [s.code ?? '', s.name ?? ''])), [sports.data]);

  const days = useMemo(() => {
    const now = new Date();
    return Array.from({ length: DAYS_AHEAD }, (_, i) => {
      const { date } = dayRange(tz, i, now);
      const label =
        i === 0 ? t('discover.today') : i === 1 ? t('discover.tomorrow') : `${shortWeekday(date, tz, locale)} ${zonedParts(date, tz).day}`;
      return { offset: i, label };
    });
  }, [tz, t, locale]);

  const openCode = () => {
    const c = code.trim().toUpperCase();
    if (c) router.push({ pathname: '/match/[id]', params: { id: c } });
  };

  const header = (
    <View style={styles.header}>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={code}
          onChangeText={setCode}
          placeholder={t('discover.codePlaceholder')}
          placeholderTextColor={colors.faint}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={openCode}
        />
        {code ? <Button title={t('discover.find')} variant="ghost" onPress={openCode} style={styles.findButton} /> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={`📍 ${t('discover.nearMe')}`} selected={mode === 'near'} onPress={() => setMode('near')} />
        {city ? (
          <Chip label={t('discover.cityCenter', { city: city.name })} selected={mode === 'city'} onPress={() => setMode('city')} />
        ) : null}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={t('discover.allSports')} selected={!sport} onPress={() => setSport(undefined)} />
        {sports.data?.map((s) => (
          <Chip key={s.code} label={s.name ?? s.code ?? ''} selected={sport === s.code} onPress={() => setSport(s.code)} />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={t('discover.anyDate')} selected={day === undefined} onPress={() => setDay(undefined)} />
        {days.map((d) => (
          <Chip key={d.offset} label={d.label} selected={day === d.offset} onPress={() => setDay(d.offset)} />
        ))}
      </ScrollView>

      {origin?.fallback && city ? (
        <Notice tone="warning">
          {origin.fallback === 'far' ? t('discover.farFromCity', { city: city.name }) : t('discover.locationDenied')}
        </Notice>
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: MatchSummary }) => (
    <MatchCard
      match={item}
      sportName={sportNames.get(item.sport)}
      onPress={() => router.push({ pathname: '/match/[id]', params: { id: item.id } })}
    />
  );

  let empty: ReactElement;
  if (!query || search.isPending) empty = <Loading />;
  else if (search.error) empty = <ErrorView error={search.error} onRetry={() => void search.refetch()} />;
  else empty = <EmptyState title={t('discover.empty')} hint={t('discover.emptyHint')} />;

  if (cities.error) return <ErrorView error={cities.error} onRetry={() => void cities.refetch()} />;

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={items}
      keyExtractor={(m) => m.id}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={search.isFetchingNextPage ? <ActivityIndicator style={{ margin: space.lg }} /> : undefined}
      onEndReached={() => {
        if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={search.isRefetching && !search.isFetchingNextPage}
          onRefresh={() => void search.refetch()}
          tintColor={colors.primary}
        />
      }
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: space.lg, gap: space.md },
  header: { gap: space.md, marginBottom: space.xs },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: space.md,
    minHeight: 46,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 },
  findButton: { minHeight: 40, paddingHorizontal: space.md },
  chips: { gap: space.sm, paddingRight: space.lg },
});
