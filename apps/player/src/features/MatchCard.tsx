import type { PropsWithChildren, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchSummary } from '@matchup/contracts';
import { SportBlock, SportPill, TimelineDay } from '@matchup/ui';
import { currentLocale } from '@/i18n';
import { formatTime, shortWeekday, zonedParts } from '@/lib/datetime';
import { money } from '@/lib/money';

/** Bo'sh joylar — sport rangidagi fonda shisha pill. */
export function SlotsPill({ match }: { match: MatchSummary }) {
  const { t } = useTranslation();
  const left = match.slots.available;
  const full = left <= 0 || match.status === 'full';
  return <SportPill icon={full ? 'close-circle' : 'people'} label={full ? t('discover.full') : t('discover.slotsLeft', { count: left })} />;
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
  const distance = match.venue.distance_m;
  return (
    <SportBlock
      testID={testID}
      sport={match.sport}
      onPress={onPress}
      time={`${formatTime(match.starts_at, match.timezone)} – ${formatTime(match.ends_at, match.timezone)}`}
      badge={money(match.price)}
      title={match.title || match.venue.name}
      meta={`${match.venue.name}${distance != null ? `  ·  ${t('discover.km', { km: (distance / 1000).toFixed(1) })}` : ''}`}
      footer={footer ?? <SlotsPill match={match} />}
      code={match.public_code}
    />
  );
}

/** Timeline guruhi: chapda hafta kuni (UPPERCASE) va sana doirada; bugun — to'q doira. */
export function DayGroup({ date, timeZone, today, children }: PropsWithChildren<{ date: Date; timeZone: string; today?: boolean }>) {
  return (
    <TimelineDay weekday={shortWeekday(date, timeZone, currentLocale())} day={zonedParts(date, timeZone).day} today={today}>
      {children}
    </TimelineDay>
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
