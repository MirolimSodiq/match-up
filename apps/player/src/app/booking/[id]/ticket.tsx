import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';
import { Chip, colors, EmptyState, ErrorView, fontFamily, Loading, Perforation, radius, SheetScreen, space, type SportColors, sportColors, SportIcon, SportTexture, type } from '@matchup/ui';
import { isApiError } from '@/api/errors';
import { useBooking, useTicket } from '@/api/queries';
import { currentLocale } from '@/i18n';
import { formatDateTime, formatDay, formatTime } from '@/lib/datetime';

/** QR atrofidagi oq "tinch zona" (quiet zone) — skaner ishonchli o'qishi uchun kamida 4 modul. */
const QR_PADDING = space.lg;

export default function TicketScreen() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useBooking(id);
  const ticket = useTicket(id, booking.data?.status === 'confirmed');
  const [index, setIndex] = useState(0);
  const close = () => router.back();

  if (booking.isPending || (booking.data?.status === 'confirmed' && ticket.isPending)) {
    return (
      <SheetScreen onClose={close}>
        <Loading />
      </SheetScreen>
    );
  }
  if (booking.error) {
    return (
      <SheetScreen onClose={close}>
        <ErrorView error={booking.error} onRetry={() => void booking.refetch()} />
      </SheetScreen>
    );
  }
  if (booking.data.status !== 'confirmed' || isApiError(ticket.error, 'INVALID_STATE')) {
    return (
      <SheetScreen onClose={close}>
        <EmptyState icon="qr-code-outline" title={t('ticket.notAvailable')} />
      </SheetScreen>
    );
  }
  if (ticket.error) {
    return (
      <SheetScreen onClose={close}>
        <ErrorView error={ticket.error} onRetry={() => void ticket.refetch()} />
      </SheetScreen>
    );
  }

  const list = ticket.data?.tickets ?? [];
  const current = list[Math.min(index, list.length - 1)];
  const m = booking.data.match;
  const sc = sportColors(m?.sport);
  const qrSize = Math.min(width - space.lg * 2 - space.lg * 2 - QR_PADDING * 2, 230);

  return (
    <SheetScreen title={t('ticket.title')} onClose={close}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <View style={[styles.ticket, { backgroundColor: sc.base }]}>
          {/* Sarlavha qismi (tekstura faqat shu yerda — QR atrofi toza qoladi) */}
          <View style={styles.head}>
            <SportTexture sport={m?.sport ?? ''} opacity={0.1} />
            <View style={styles.headRow}>
              <Text style={styles.pass}>{t('ticket.pass')}</Text>
              {m?.public_code ? <Text style={[styles.code, { color: sc.muted }]}>{m.public_code}</Text> : null}
            </View>
            {m ? (
              <View style={styles.titleRow}>
                <SportIcon sport={m.sport} size={22} color={colors.onSport} />
                <Text style={styles.title} numberOfLines={2}>
                  {m.title || m.venue.name}
                </Text>
              </View>
            ) : null}
            {m ? (
              <View style={styles.cols}>
                <Field sc={sc} label={t('ticket.date')} value={formatDay(m.starts_at, m.timezone, locale)} />
                <Field sc={sc} label={t('ticket.time')} value={formatTime(m.starts_at, m.timezone)} narrow />
              </View>
            ) : null}
            {m ? <Field sc={sc} label={t('ticket.venue')} value={m.venue.name ?? ''} /> : null}
          </View>

          <Perforation inset={0} notchColor={colors.surface} edgeColor={colors.surface} lineColor={colors.sportGlassBorder} />

          {/* QR — doim oq quti ichida, atrofida yetarli tinch zona */}
          <View style={styles.qrWrap}>
            {current?.qr_payload ? (
              <View testID="ticket-qr" style={styles.qr}>
                <QRCode value={current.qr_payload} size={qrSize} ecl="M" color={colors.qrInk} backgroundColor={colors.qrSurface} quietZone={4} />
              </View>
            ) : null}
            <View style={styles.holder}>
              <Text style={[styles.label, { color: sc.muted }]}>{t('ticket.holder')}</Text>
              <Text style={styles.holderName}>{current?.holder_name}</Text>
            </View>
            {current?.expires_at && m ? (
              <Text style={[styles.valid, { color: sc.muted }]}>
                {t('ticket.validUntil', { time: formatDateTime(current.expires_at, m.timezone, locale) })}
              </Text>
            ) : null}
          </View>
        </View>

        {list.length > 1 ? (
          <View style={styles.holders}>
            {list.map((tk, i) => (
              <Chip key={tk.participant_id} label={tk.holder_name ?? `#${i + 1}`} selected={i === index} onPress={() => setIndex(i)} />
            ))}
          </View>
        ) : null}
        <Text style={[type.small, styles.hint]}>{t('ticket.hint')}</Text>
      </ScrollView>
    </SheetScreen>
  );
}

function Field({ sc, label, value, narrow }: { sc: SportColors; label: string; value: string; narrow?: boolean }) {
  return (
    <View style={[styles.field, narrow && styles.fieldNarrow]}>
      <Text style={[styles.label, { color: sc.muted }]}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.lg },
  ticket: { borderRadius: radius.lg, overflow: 'hidden' },
  head: { padding: space.lg, gap: space.md },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pass: { fontFamily: fontFamily.display, fontSize: 18, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.onSport },
  code: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: 0.8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { fontFamily: fontFamily.bold, fontSize: 21, lineHeight: 27, color: colors.onSport, flex: 1 },
  cols: { flexDirection: 'row', gap: space.lg },
  field: { flex: 1, gap: 2 },
  fieldNarrow: { flex: 0 },
  label: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16 },
  fieldValue: { fontFamily: fontFamily.semibold, fontSize: 15, lineHeight: 21, color: colors.onSport },
  qrWrap: { padding: space.lg, paddingTop: space.sm, gap: space.md, alignItems: 'center' },
  qr: { padding: QR_PADDING, borderRadius: radius.md, backgroundColor: colors.qrSurface },
  holder: { alignItems: 'center', gap: 2 },
  holderName: { fontFamily: fontFamily.display, fontSize: 24, lineHeight: 30, textTransform: 'uppercase', color: colors.onSport },
  valid: { fontFamily: fontFamily.medium, fontSize: 12 },
  holders: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
  hint: { textAlign: 'center', paddingHorizontal: space.lg },
});
