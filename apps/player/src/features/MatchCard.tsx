import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MatchSummary } from '@matchup/contracts';
import { colors, fontFamily, radius, space, sportColors, states, type } from '@/components/theme';
import { currentLocale } from '@/i18n';
import { formatTime, shortWeekday, zonedParts } from '@/lib/datetime';
import { money } from '@/lib/money';
import { SportTexture } from './SportTexture';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
const SPORT_ICONS: Record<string, IconName> = { football: 'soccer', basketball: 'basketball', volleyball: 'volleyball' };

export function SportIcon({ sport, size = 20, color = colors.text }: { sport: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={sport === 'all' ? 'view-grid' : (SPORT_ICONS[sport] ?? 'whistle')} size={size} color={color} />;
}

/** Bo'sh joylar — sport rangidagi fonda shisha pill. */
export function SlotsPill({ match }: { match: MatchSummary }) {
  const { t } = useTranslation();
  const left = match.slots.available;
  const full = left <= 0 || match.status === 'full';
  return (
    <View style={styles.glassPill}>
      <Ionicons name={full ? 'close-circle' : 'people'} size={13} color={colors.onSport} />
      <Text style={styles.glassPillText}>{full ? t('discover.full') : t('discover.slotsLeft', { count: left })}</Text>
    </View>
  );
}

/** Timeline'dagi sport rangidagi o'yin bloki. */
export function MatchBlock({
  match,
  onPress,
  footer,
  testID,
}: {
  match: MatchSummary;
  onPress: () => void;
  /** Pastki o'ng burchak (masalan, booking holati); bo'lmasa — bo'sh joylar. */
  footer?: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  const sc = sportColors(match.sport);
  const distance = match.venue.distance_m;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.block, { backgroundColor: sc.base }, pressed && styles.pressed]}
    >
      <SportTexture sport={match.sport} />
      <View style={styles.blockTop}>
        <Text style={styles.time}>
          {formatTime(match.starts_at, match.timezone)} – {formatTime(match.ends_at, match.timezone)}
        </Text>
        <View style={styles.glassPill}>
          <Text style={styles.glassPillText}>{money(match.price)}</Text>
        </View>
      </View>
      <View style={styles.titleRow}>
        <SportIcon sport={match.sport} size={18} color={colors.onSport} />
        <Text style={styles.title} numberOfLines={2}>
          {match.title || match.venue.name}
        </Text>
      </View>
      <Text style={[styles.meta, { color: sc.muted }]} numberOfLines={1}>
        {match.venue.name}
        {distance != null ? `  ·  ${t('discover.km', { km: (distance / 1000).toFixed(1) })}` : ''}
      </Text>
      <View style={styles.blockBottom}>
        {footer ?? <SlotsPill match={match} />}
        {match.public_code ? <Text style={[styles.code, { color: sc.muted }]}>{match.public_code}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Timeline chap ustuni: hafta kuni (UPPERCASE) va sana doirada; bugun — to'q doira. */
export function DayColumn({ date, timeZone, today }: { date: Date; timeZone: string; today?: boolean }) {
  return (
    <View style={styles.day}>
      <Text style={styles.dayName}>{shortWeekday(date, timeZone, currentLocale())}</Text>
      <View style={[styles.dayCircle, today && styles.dayCircleToday]}>
        <Text style={[styles.dayNum, today && { color: colors.onPrimary }]}>{zonedParts(date, timeZone).day}</Text>
      </View>
    </View>
  );
}

export function DayGroup({ date, timeZone, today, children }: PropsWithChildren<{ date: Date; timeZone: string; today?: boolean }>) {
  return (
    <View style={styles.group}>
      <DayColumn date={date} timeZone={timeZone} today={today} />
      <View style={styles.groupItems}>{children}</View>
    </View>
  );
}

export interface DayBucket<T> {
  key: string;
  date: Date;
  timeZone: string;
  today: boolean;
  items: T[];
}

/** Ro'yxatni o'yin vaqt zonasidagi kun bo'yicha guruhlaydi (tartib saqlanadi). */
export function groupByDay<T>(items: T[], pick: (item: T) => { startsAt: string; timeZone: string }, now = new Date()): DayBucket<T>[] {
  const buckets: DayBucket<T>[] = [];
  for (const item of items) {
    const { startsAt, timeZone } = pick(item);
    const date = new Date(startsAt);
    const p = zonedParts(date, timeZone);
    const key = `${p.year}-${p.month}-${p.day}`;
    const last = buckets[buckets.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }
    const n = zonedParts(now, timeZone);
    buckets.push({ key, date, timeZone, today: n.year === p.year && n.month === p.month && n.day === p.day, items: [item] });
  }
  return buckets;
}

const styles = StyleSheet.create({
  pressed: { opacity: states.pressedOpacity, transform: [{ scale: states.pressedScale }] },
  block: { borderRadius: radius.lg, padding: space.lg, gap: 6, overflow: 'hidden', minHeight: 150 },
  blockTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { fontFamily: fontFamily.semibold, fontSize: 14, color: colors.onSport },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  title: { fontFamily: fontFamily.bold, fontSize: 19, lineHeight: 24, color: colors.onSport, flex: 1 },
  meta: { fontFamily: fontFamily.medium, fontSize: 13 },
  blockBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: space.sm },
  code: { fontFamily: fontFamily.semibold, fontSize: 12, letterSpacing: 0.6 },
  glassPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.sportShade,
  },
  glassPillText: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.onSport },
  group: { flexDirection: 'row', gap: space.md },
  groupItems: { flex: 1, gap: space.md },
  day: { width: 40, alignItems: 'center', gap: 4, paddingTop: 2 },
  dayName: { ...type.caption, textTransform: 'uppercase', fontFamily: fontFamily.semibold },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleToday: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayNum: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.text },
});
