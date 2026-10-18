import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import { useBooking, useTicket } from '@/api/queries';
import { colors, font, radius, space } from '@/components/theme';
import { Chip, EmptyState, ErrorView, H2, Loading, Muted } from '@/components/ui';
import { currentLocale } from '@/i18n';
import { formatDateTime, formatDay, formatTime } from '@/lib/datetime';

export default function TicketScreen() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useBooking(id);
  const ticket = useTicket(id, booking.data?.status === 'confirmed');
  const [index, setIndex] = useState(0);

  if (booking.isPending || (booking.data?.status === 'confirmed' && ticket.isPending)) return <Loading />;
  if (booking.error) return <ErrorView error={booking.error} onRetry={() => void booking.refetch()} />;
  if (booking.data.status !== 'confirmed' || isApiError(ticket.error, 'INVALID_STATE')) {
    return <EmptyState title={t('ticket.notAvailable')} />;
  }
  if (ticket.error) return <ErrorView error={ticket.error} onRetry={() => void ticket.refetch()} />;

  const list = ticket.data?.tickets ?? [];
  const current = list[Math.min(index, list.length - 1)];
  const m = booking.data.match;
  const size = Math.min(width - space.xl * 4, 300);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen
        options={{
          headerTitleStyle: { color: colors.white },
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Text style={styles.close}>{t('common.close')}</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.ticket}>
        {m ? (
          <View style={styles.head}>
            <H2 style={styles.center}>{m.title || m.venue.name}</H2>
            <Text style={styles.when}>
              {formatDay(m.starts_at, m.timezone, locale)} · {formatTime(m.starts_at, m.timezone)}
            </Text>
            <Muted style={styles.center}>{m.venue.name}</Muted>
          </View>
        ) : null}

        <View style={styles.cut} />

        {current?.qr_payload ? (
          <View testID="ticket-qr" style={styles.qr}>
            <QRCode value={current.qr_payload} size={size} ecl="M" color={colors.text} backgroundColor={colors.white} />
          </View>
        ) : null}
        <Text style={[font.h3, styles.center]}>{current?.holder_name}</Text>
        {m?.public_code ? <Text style={styles.code}>{m.public_code}</Text> : null}
        {current?.expires_at && m ? (
          <Muted style={styles.center}>{t('ticket.validUntil', { time: formatDateTime(current.expires_at, m.timezone, locale) })}</Muted>
        ) : null}
      </View>

      {list.length > 1 ? (
        <View style={styles.holders}>
          {list.map((tk, i) => (
            <Chip key={tk.participant_id} label={tk.holder_name ?? `#${i + 1}`} selected={i === index} onPress={() => setIndex(i)} />
          ))}
        </View>
      ) : null}
      <Text style={styles.hint}>{t('ticket.hint')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.primary },
  content: { padding: space.xl, gap: space.lg, alignItems: 'stretch' },
  ticket: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.md,
    alignItems: 'center',
  },
  head: { alignItems: 'center', gap: space.xs },
  when: { fontSize: 15, fontWeight: '600', color: colors.primaryDark, textAlign: 'center' },
  center: { textAlign: 'center' },
  cut: {
    alignSelf: 'stretch',
    borderBottomWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    marginVertical: space.sm,
  },
  qr: { padding: space.md, backgroundColor: colors.white, borderRadius: radius.md },
  code: { fontSize: 13, fontWeight: '700', letterSpacing: 1, color: colors.muted },
  close: { color: colors.white, fontSize: 16, fontWeight: '600' },
  hint: { color: colors.white, textAlign: 'center', fontSize: 14, opacity: 0.9 },
  holders: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
});
