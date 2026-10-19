import { zonedParts } from './datetime';

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
