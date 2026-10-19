import Ionicons from '@expo/vector-icons/Ionicons';
import { type ReactElement, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { MatchSummary } from '@matchup/contracts';
import { Chip, colors, EmptyState, ErrorView, fontFamily, Loading, Notice, PageTitle, radius, ScreenGlow, shadow, space, SportIcon, states, TAB_BAR_SPACE, type } from '@matchup/ui';
import { type MatchSearch, useCities, useMatchSearch, useMe, useSports } from '@/api/queries';
import { type DayBucket, DayGroup, groupByDay, MatchBlock } from '@/features/MatchCard';
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
  const days = useMemo(() => {
    const items = search.data?.pages.flatMap((p) => p.items) ?? [];
    return groupByDay(items, (m) => ({ startsAt: m.starts_at, timeZone: m.timezone }));
  }, [search.data]);

  const dateStrip = useMemo(() => {
    const now = new Date();
    return Array.from({ length: DAYS_AHEAD }, (_, i) => {
      const { date } = dayRange(tz, i, now);
      return { offset: i, weekday: shortWeekday(date, tz, locale), num: zonedParts(date, tz).day };
    });
  }, [tz, locale]);

  const openCode = () => {
    const c = code.trim().toUpperCase();
    if (c) router.push({ pathname: '/match/[id]', params: { id: c } });
  };

  const locationLabel = mode === 'near' ? t('discover.nearMe') : t('discover.cityCenter', { city: city?.name ?? '' });

  const header = (
    <View style={styles.header}>
      <View style={[styles.search, shadow(1)]}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={code}
          onChangeText={setCode}
          placeholder={t('discover.codePlaceholder')}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={openCode}
        />
        {code ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('discover.find')}
            onPress={openCode}
            style={({ pressed }) => [styles.findButton, pressed && { opacity: states.pressedOpacity }]}
          >
            <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        <Chip
          icon={<SportIcon sport="all" size={16} color={!sport ? colors.onPrimary : colors.text} />}
          label={t('discover.allSports')}
          selected={!sport}
          onPress={() => setSport(undefined)}
        />
        {sports.data?.map((s) => (
          <Chip
            key={s.code}
            icon={<SportIcon sport={s.code ?? ''} size={16} color={sport === s.code ? colors.onPrimary : colors.text} />}
            label={s.name ?? s.code ?? ''}
            selected={sport === s.code}
            onPress={() => setSport(s.code)}
          />
        ))}
      </ScrollView>

      {/* Sana qatori: hafta kuni + sana doirada; tanlangani — to'q doira */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        <DateItem label={t('discover.allDays')} a11y={t('discover.anyDate')} active={day === undefined} onPress={() => setDay(undefined)}>
          <Ionicons name="infinite" size={18} color={day === undefined ? colors.onPrimary : colors.text} />
        </DateItem>
        {dateStrip.map((d) => (
          <DateItem
            key={d.offset}
            label={d.offset === 0 ? t('discover.today') : d.weekday}
            active={day === d.offset}
            onPress={() => setDay(d.offset)}
          >
            <Text style={[styles.dateNum, day === d.offset && { color: colors.onPrimary }]}>{d.num}</Text>
          </DateItem>
        ))}
      </ScrollView>

      {origin?.fallback && city ? (
        <Notice tone="warning" icon="location-outline">
          {origin.fallback === 'far' ? t('discover.farFromCity', { city: city.name }) : t('discover.locationDenied')}
        </Notice>
      ) : null}
    </View>
  );

  const renderDay = ({ item }: { item: DayBucket<MatchSummary> }) => (
    <DayGroup date={item.date} timeZone={item.timeZone} today={item.today}>
      {item.items.map((m) => (
        <MatchBlock key={m.id} match={m} onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.id } })} />
      ))}
    </DayGroup>
  );

  let empty: ReactElement;
  if (!query || search.isPending) empty = <Loading />;
  else if (search.error) empty = <ErrorView error={search.error} onRetry={() => void search.refetch()} />;
  else empty = <EmptyState icon="calendar-clear-outline" title={t('discover.empty')} hint={t('discover.emptyHint')} />;

  return (
    <View style={styles.root}>
      <ScreenGlow />
      <PageTitle
        title={t('discover.title')}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityHint={mode === 'near' ? t('discover.cityCenter', { city: city?.name ?? '' }) : t('discover.nearMe')}
            onPress={() => setMode(mode === 'near' ? 'city' : 'near')}
            style={({ pressed }) => [styles.location, shadow(1), pressed && { opacity: states.pressedOpacity }]}
          >
            <Ionicons name={mode === 'near' ? 'navigate' : 'business'} size={14} color={colors.text} />
            <Text style={styles.locationText} numberOfLines={1}>
              {locationLabel}
            </Text>
            <Ionicons name="swap-horizontal" size={14} color={colors.textMuted} />
          </Pressable>
        }
      />
      {cities.error ? (
        <ErrorView error={cities.error} onRetry={() => void cities.refetch()} />
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={days}
          keyExtractor={(d) => d.key}
          renderItem={renderDay}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          ListFooterComponent={search.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: space.lg }} /> : undefined}
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
          keyboardDismissMode="on-drag"
        />
      )}
    </View>
  );
}

function DateItem({
  label,
  a11y,
  active,
  onPress,
  children,
}: {
  label: string;
  a11y?: string;
  active: boolean;
  onPress: () => void;
  children: ReactElement;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.dateItem, pressed && { opacity: states.pressedOpacity }]}
    >
      <Text style={[styles.dateWeekday, active && { color: colors.text }]}>{label}</Text>
      <View style={[styles.dateCircle, active && styles.dateCircleActive]}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.lg, paddingBottom: TAB_BAR_SPACE + space.lg, gap: space.xl },
  header: { gap: space.lg },
  location: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 180,
    paddingHorizontal: space.md,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginBottom: 6,
  },
  locationText: { fontFamily: fontFamily.medium, fontSize: 13, color: colors.text, flexShrink: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingLeft: space.lg,
    paddingRight: 5,
    minHeight: 50,
  },
  searchInput: { flex: 1, fontFamily: fontFamily.regular, fontSize: 15, color: colors.text, paddingVertical: 12 },
  findButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: { gap: space.sm, paddingRight: space.lg },
  dateItem: { alignItems: 'center', gap: 6, minWidth: 44 },
  dateWeekday: { ...type.caption, fontFamily: fontFamily.semibold, textTransform: 'uppercase' },
  dateCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCircleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateNum: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.text },
});
