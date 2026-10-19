import Ionicons from '@expo/vector-icons/Ionicons';
import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, radius, space, sportColors, states, type } from '../tokens';
import type { IconName } from './primitives';
import { SportIcon } from './SportIcon';
import { SportTexture } from './SportTexture';

/** Sport rangidagi fonda kichik pill (to'qroq qatlam, oq matn). */
export function SportPill({ label, icon }: { label: string; icon?: IconName }) {
  return (
    <View style={styles.glassPill}>
      {icon ? <Ionicons name={icon} size={13} color={colors.onSport} /> : null}
      <Text style={styles.glassPillText}>{label}</Text>
    </View>
  );
}

/**
 * Timeline'dagi sport rangidagi o'yin bloki. Matnlar tayyor (formatlangan) holda beriladi —
 * komponent faqat ko'rinish uchun javob beradi.
 */
export function SportBlock({
  sport,
  time,
  badge,
  title,
  meta,
  footer,
  code,
  onPress,
  testID,
}: {
  sport: string;
  /** Yuqori chap: "19:00 – 20:30". */
  time: string;
  /** Yuqori o'ng pill (narx, host to'lovi). */
  badge?: string;
  title?: string;
  /** Sarlavha ostidagi xira qator (maydon, masofa). */
  meta?: string;
  /** Pastki chap burchak (bo'sh joylar, holat). */
  footer?: ReactNode;
  /** Pastki o'ng: o'yin kodi (MU-RACE). */
  code?: string;
  /** Bo'lmasa — oddiy (bosilmaydigan) blok. */
  onPress?: () => void;
  testID?: string;
}) {
  const sc = sportColors(sport);
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.block, { backgroundColor: sc.base }, pressed && styles.pressed]}
    >
      <SportTexture sport={sport} />
      <View style={styles.blockTop}>
        <Text style={styles.time}>{time}</Text>
        {badge ? (
          <View style={styles.glassPill}>
            <Text style={styles.glassPillText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.titleRow}>
        <SportIcon sport={sport} size={18} color={colors.onSport} />
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      </View>
      {meta ? (
        <Text style={[styles.meta, { color: sc.muted }]} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
      <View style={styles.blockBottom}>
        {footer}
        {code ? <Text style={[styles.code, { color: sc.muted }]}>{code}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Timeline chap ustuni: hafta kuni (UPPERCASE) va sana doirada; bugun — to'q doira. */
export function DayColumn({ weekday, day, today }: { weekday: string; day: number; today?: boolean }) {
  return (
    <View style={styles.day}>
      <Text style={styles.dayName}>{weekday}</Text>
      <View style={[styles.dayCircle, today && styles.dayCircleToday]}>
        <Text style={[styles.dayNum, today && { color: colors.onPrimary }]}>{day}</Text>
      </View>
    </View>
  );
}

/** Bir kunlik timeline guruhi: chapda sana, o'ngda bloklar. */
export function TimelineDay({ weekday, day, today, children }: PropsWithChildren<{ weekday: string; day: number; today?: boolean }>) {
  return (
    <View style={styles.group}>
      <DayColumn weekday={weekday} day={day} today={today} />
      <View style={styles.groupItems}>{children}</View>
    </View>
  );
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
