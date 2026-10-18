import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MatchSummary } from '@matchup/contracts';
import { colors, font, radius, space } from '@/components/theme';
import { Badge, Card, Muted } from '@/components/ui';
import { currentLocale } from '@/i18n';
import { formatSlot } from '@/lib/datetime';
import { money } from '@/lib/money';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
const SPORT_ICONS: Record<string, IconName> = { football: 'soccer', basketball: 'basketball', volleyball: 'volleyball' };

export function SportIcon({ sport, size = 22, color = colors.primary }: { sport: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={SPORT_ICONS[sport] ?? 'whistle'} size={size} color={color} />;
}

export function SlotsBadge({ match }: { match: MatchSummary }) {
  const { t } = useTranslation();
  const left = match.slots.available;
  if (left <= 0 || match.status === 'full') return <Badge label={t('discover.full')} tone="danger" />;
  return <Badge label={t('discover.slotsLeft', { count: left })} tone={left <= 3 ? 'warning' : 'success'} />;
}

export function MatchCard({ match, sportName, onPress }: { match: MatchSummary; sportName?: string; onPress: () => void }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const distance = match.venue.distance_m;
  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.top}>
        <View style={styles.sport}>
          <View style={styles.iconWrap}>
            <SportIcon sport={match.sport} size={18} />
          </View>
          <Muted>
            {sportName ?? match.sport} · {match.format}
          </Muted>
        </View>
        <Text style={styles.price}>{money(match.price)}</Text>
      </View>
      <Text style={font.h3} numberOfLines={1}>
        {match.title || match.venue.name}
      </Text>
      <Text style={styles.time}>{formatSlot(match.starts_at, match.ends_at, match.timezone, locale)}</Text>
      <Muted numberOfLines={1}>
        {match.venue.name}
        {distance != null ? ` · ${t('discover.km', { km: (distance / 1000).toFixed(1) })}` : ''}
      </Muted>
      <View style={styles.bottom}>
        <SlotsBadge match={match} />
        {match.public_code ? <Text style={styles.code}>{match.public_code}</Text> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sport: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  price: { fontSize: 16, fontWeight: '700', color: colors.text },
  time: { fontSize: 15, fontWeight: '600', color: colors.primaryDark },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xs },
  code: { fontSize: 12, color: colors.faint, fontWeight: '600', letterSpacing: 0.5 },
});
