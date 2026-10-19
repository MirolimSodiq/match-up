import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, colors, fontFamily, radius, space, SportBlock, SportPill } from '@matchup/ui';
import type { components } from '@matchup/contracts';
import { currentLocale } from '@/i18n';
import { formatSlot, formatTime } from '@/lib/datetime';
import { money } from '@/lib/money';
import { formatRemaining, useNow } from '@/lib/time';
import type { HostMatch } from '@/offline/store';

type HostOffer = components['schemas']['HostOffer'];

/** Tayinlangan o'yin bloki: vaqt, host haqi, holat va kelganlar soni. */
export function HostMatchBlock({ item, onPress }: { item: HostMatch; onPress: () => void }) {
  const { t } = useTranslation();
  const m = item.match;
  if (!m) return null;
  const status = item.assignment_status ?? 'accepted';
  const statusIcon = status === 'arrived' ? 'location' : status === 'completed' ? 'checkmark-circle' : status === 'cancelled' ? 'close-circle' : 'time';
  return (
    <SportBlock
      testID={`host-match-${m.public_code}`}
      sport={m.sport}
      onPress={onPress}
      time={`${formatTime(m.starts_at, m.timezone)} – ${formatTime(m.ends_at, m.timezone)}`}
      badge={money(item.fee)}
      title={m.title || m.venue.name}
      meta={m.venue.name}
      footer={
        <View style={styles.pills}>
          <SportPill icon={statusIcon} label={t(`matches.status.${status}`)} />
          <SportPill icon="people" label={t('matches.checkedIn', { checked: item.checked_in_count ?? 0, total: m.slots.taken })} />
        </View>
      }
      code={m.public_code}
    />
  );
}

/** Taklif: sport rangidagi blok, javob berish taymeri va qabul/rad tugmalari. */
export function OfferCard({
  offer,
  onAccept,
  onDecline,
  accepting,
}: {
  offer: HostOffer;
  onAccept: () => void;
  onDecline: () => void;
  accepting?: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow(1000);
  const m = offer.match;
  if (!m) return null;
  const left = new Date(offer.offer_expires_at ?? 0).getTime() - now;
  const expired = left <= 0;
  const urgent = !expired && left < 2 * 60_000;
  return (
    <View style={styles.offer} testID={`offer-${m.public_code}`}>
      <SportBlock
        sport={m.sport}
        time={formatSlot(m.starts_at, m.ends_at, m.timezone, currentLocale())}
        badge={money(offer.fee)}
        title={m.title || m.venue.name}
        meta={m.venue.address ? `${m.venue.name} · ${m.venue.address}` : m.venue.name}
        footer={
          <View style={styles.pills}>
            {offer.distance_m != null ? <SportPill icon="navigate" label={t('offers.distance', { km: (offer.distance_m / 1000).toFixed(1) })} /> : null}
            <SportPill icon="people" label={`${m.slots.taken}/${m.slots.max} · ${m.format}`} />
          </View>
        }
        code={m.public_code}
      />
      {offer.kit_required ? (
        <View style={styles.kit}>
          <Ionicons name="shirt-outline" size={15} color={colors.textMuted} />
          <Text style={styles.kitText}>{t('offers.kit')}</Text>
        </View>
      ) : null}
      <View style={[styles.timer, urgent && styles.timerUrgent, expired && styles.timerExpired]} accessibilityLiveRegion="polite">
        <Ionicons name={expired ? 'alert-circle' : 'timer-outline'} size={16} color={expired ? colors.danger : urgent ? colors.warning : colors.text} />
        <Text style={[styles.timerText, urgent && styles.timerTextUrgent, expired && styles.timerTextAlert]}>
          {expired ? t('offers.expired') : t('offers.expiresIn', { time: formatRemaining(left) })}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button title={t('offers.decline')} variant="secondary" onPress={onDecline} disabled={expired || accepting} style={styles.flex} />
        <Button testID="accept-offer" title={t('offers.accept')} icon="checkmark" onPress={onAccept} loading={accepting} disabled={expired} style={styles.flex2} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', gap: space.xs, flexShrink: 1, flexWrap: 'wrap' },
  offer: { gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.lg + 4, padding: space.sm, borderWidth: 1, borderColor: colors.border },
  kit: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm },
  kitText: { fontFamily: fontFamily.medium, fontSize: 13, color: colors.textMuted },
  timer: { flexDirection: 'row', gap: space.xs, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  timerUrgent: { backgroundColor: colors.warningSoft },
  timerExpired: { backgroundColor: colors.dangerSoft },
  timerText: { fontFamily: fontFamily.semibold, fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  timerTextUrgent: { color: colors.warning },
  timerTextAlert: { color: colors.danger },
  actions: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1, paddingHorizontal: space.md },
  flex2: { flex: 1.4, paddingHorizontal: space.md },
});
