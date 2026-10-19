import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { Booking, BookingStatus, Refund } from '@matchup/contracts';
import { Button, Card, colors, Divider, ErrorText, ErrorView, fontFamily, IconButton, ListRow, Loading, radius, Row, space, type SportColors, sportColors, SportIcon, SportTexture, type } from '@matchup/ui';
import { api, call } from '@/api/client';
import { qk, useBooking, useMatch } from '@/api/queries';
import { checkoutUrlFor, closeCheckout, startPayment } from '@/features/payment';
import { currentLocale } from '@/i18n';
import { formatDay, formatTime } from '@/lib/datetime';
import { uuid } from '@/lib/device';
import { money } from '@/lib/money';

export default function BookingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id, pay } = useLocalSearchParams<{ id: string; pay?: string }>();
  const queryClient = useQueryClient();
  const booking = useBooking(id);
  const status = booking.data?.status;

  // Checkout'dan kelganda to'lov sahifasini bir marta avtomatik ochamiz (native — WebView ekrani, web — yangi oyna)
  const autoOpened = useRef(false);
  useEffect(() => {
    if (pay !== '1' || autoOpened.current || !checkoutUrlFor(id)) return;
    autoOpened.current = true;
    startPayment(id);
  }, [pay, id]);

  // To'lov tasdiqlanganda: brauzerni yopamiz, ro'yxatlar va balansni yangilaymiz
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === 'pending_payment' && status && status !== 'pending_payment') {
      closeCheckout();
      void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['match'] });
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
    }
    prevStatus.current = status;
  }, [status, queryClient]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/bookings'));

  if (booking.isPending || booking.error) {
    return (
      <View style={[styles.plain, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.plainBar}>
          <IconButton icon="chevron-back" label={t('common.back')} variant="muted" onPress={back} />
        </View>
        {booking.isPending ? <Loading /> : <ErrorView error={booking.error} onRetry={() => void booking.refetch()} />}
      </View>
    );
  }
  const b = booking.data;
  const sc = sportColors(b.match?.sport);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* Yuqoriga tortilganda ham fon sport rangida qolsin */}
      <View style={[styles.overscroll, { backgroundColor: sc.base }]} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, { backgroundColor: sc.base, paddingTop: insets.top + space.sm }]}>
          <View style={styles.texture} pointerEvents="none">
            <SportTexture sport={b.match?.sport ?? ''} opacity={0.12} strokeWidth={2.5} fadeBottom />
          </View>
          <View style={styles.bar}>
            <IconButton icon="chevron-back" label={t('common.back')} variant="glass" onPress={back} />
            {b.match?.public_code ? <Text style={[styles.code, { color: sc.muted }]}>{b.match.public_code}</Text> : null}
          </View>
          <StatusHero booking={b} sc={sc} />
          {b.match ? <MatchInfo booking={b} sc={sc} /> : null}
        </View>

        <View style={styles.body}>
          <PaymentCard booking={b} />
          <CancelSection booking={b} />
        </View>
      </ScrollView>
      {/* Status bar ostidagi qat'iy chiziq: skroll qilingan kontent soat/batareya ostiga kirmasin */}
      <View style={[styles.statusStrip, { height: insets.top, backgroundColor: sc.base }]} />
    </View>
  );
}

const STATUS_ICON: Record<BookingStatus, keyof typeof Ionicons.glyphMap> = {
  pending_payment: 'hourglass',
  confirmed: 'checkmark',
  cancelled: 'close',
  expired: 'time',
  completed: 'flag',
};

/** Holat: oq doirada katta belgi (sport rangida) va UPPERCASE sarlavha. */
function StatusHero({ booking: b, sc }: { booking: Booking; sc: SportColors }) {
  const { t } = useTranslation();
  const tz = b.match?.timezone ?? 'Asia/Tashkent';
  const pending = b.status === 'pending_payment';
  return (
    <View style={styles.status}>
      <View style={styles.mark}>
        {pending ? <ActivityIndicator size="large" color={sc.base} /> : <Ionicons name={STATUS_ICON[b.status]} size={46} color={sc.base} />}
      </View>
      <Text style={styles.statusTitle} accessibilityRole="header">
        {t(`booking.status.${b.status}`)}
      </Text>
      {b.status === 'confirmed' ? <Text style={[styles.statusNote, { color: sc.muted }]}>{t('booking.confirmedNote')}</Text> : null}
      {pending ? (
        <>
          <Text style={[styles.statusNote, { color: sc.muted }]}>{t('booking.awaitingPayment')}</Text>
          {b.expires_at ? (
            <View style={styles.pill}>
              <Ionicons name="lock-closed" size={12} color={colors.onSport} />
              <Text style={styles.pillText}>{t('booking.holdUntil', { time: formatTime(b.expires_at, tz) })}</Text>
            </View>
          ) : null}
          {checkoutUrlFor(b.id) ? (
            <Button
              testID="open-checkout"
              icon="card-outline"
              title={t('booking.openCheckout')}
              variant="light"
              onPress={() => startPayment(b.id)}
              style={styles.stretch}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** Match ma'lumoti (shisha konteyner) + QR chipta tugmasi. */
function MatchInfo({ booking: b, sc }: { booking: Booking; sc: SportColors }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const m = b.match!;
  return (
    <View style={styles.infoWrap}>
      <View style={styles.glass}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.id } })}
          style={({ pressed }) => [styles.matchRow, pressed && { opacity: 0.8 }]}
        >
          <SportIcon sport={m.sport} size={18} color={colors.onSport} />
          <Text style={styles.matchTitle} numberOfLines={2}>
            {m.title || m.venue.name}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={sc.muted} />
        </Pressable>
        <InfoRow sc={sc} label={t('ticket.date')} value={formatDay(m.starts_at, m.timezone, locale)} />
        <InfoRow sc={sc} label={t('ticket.time')} value={`${formatTime(m.starts_at, m.timezone)} – ${formatTime(m.ends_at, m.timezone)}`} />
        <InfoRow sc={sc} label={t('ticket.venue')} value={m.venue.name ?? ''} last />
      </View>
      {b.status === 'confirmed' ? (
        <Button
          testID="open-ticket"
          icon="qr-code-outline"
          title={t('booking.ticket')}
          variant="light"
          onPress={() => router.push({ pathname: '/booking/[id]/ticket', params: { id: b.id } })}
        />
      ) : null}
    </View>
  );
}

function InfoRow({ sc, label, value, last }: { sc: SportColors; label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text style={[styles.infoLabel, { color: sc.muted }]}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function PaymentCard({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const walletUsed = (b.wallet_applied?.amount ?? 0) > 0;
  const paid = b.status === 'confirmed' || b.status === 'completed';
  return (
    <Card style={styles.payCard}>
      <Row label={t('common.seats', { count: b.seats })} value={money(b.unit_price)} />
      {walletUsed ? <Row label={t('booking.walletApplied')} value={money(b.wallet_applied)} /> : null}
      <Divider dashed />
      <Row label={paid ? t('booking.paid') : t('checkout.total')} value={money(walletUsed ? b.wallet_applied : b.total)} strong />
    </Card>
  );
}

function CancelSection({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const match = useMatch(b.match_id);
  const [open, setOpen] = useState(false);
  const [toWallet, setToWallet] = useState(false);
  const [result, setResult] = useState<{ refund: Refund | null; wasPaid: boolean }>();

  const cancel = useMutation({
    mutationFn: (idempotencyKey: string) =>
      call(
        api.POST('/v1/bookings/{bookingId}/cancel', {
          params: { path: { bookingId: b.id }, header: { 'Idempotency-Key': idempotencyKey } },
          body: { reason: 'user_cancel', ...(toWallet ? { refund_destination: 'wallet' as const } : {}) },
        }),
      ),
    retry: false,
    onSuccess: (res) => {
      setResult({ refund: res.refund ?? null, wasPaid: b.status === 'confirmed' });
      setOpen(false);
      if (res.booking) queryClient.setQueryData(qk.booking(b.id), res.booking);
      void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['match'] });
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
    },
  });

  if (result) return <RefundResult refund={result.refund} wasPaid={result.wasPaid} />;

  const started = b.match ? new Date(b.match.starts_at).getTime() <= Date.now() : false;
  const cancellable = (b.status === 'pending_payment' || b.status === 'confirmed') && !started;
  if (!cancellable) return null;

  if (!open) {
    return <Button testID="cancel-booking" icon="close-circle-outline" title={t('booking.cancel')} variant="danger" onPress={() => setOpen(true)} />;
  }

  const paidByCard = b.status === 'confirmed' && (b.total?.amount ?? 0) > 0;
  const policy = match.data?.cancellation_policy?.summary;
  return (
    <Card tone="white" style={styles.cancelCard}>
      <Text style={type.title}>{t('booking.cancelTitle')}</Text>
      {policy ? (
        <View style={styles.policy}>
          <Text style={type.small}>{t('match.cancellationPolicy')}</Text>
          <Text style={type.body}>{policy}</Text>
        </View>
      ) : null}
      {paidByCard ? (
        <ListRow icon="wallet-outline" title={t('booking.refundToWallet')} toggle={{ value: toWallet, onChange: setToWallet }} />
      ) : null}
      <ErrorText error={cancel.error} />
      <Button testID="confirm-cancel" title={t('booking.confirmCancel')} variant="primary" loading={cancel.isPending} onPress={() => cancel.mutate(uuid())} />
      <Button title={t('booking.keep')} variant="secondary" onPress={() => setOpen(false)} />
    </Card>
  );
}

function RefundResult({ refund, wasPaid }: { refund: Refund | null; wasPaid: boolean }) {
  const { t } = useTranslation();
  return (
    <Card tone="white" style={styles.refund}>
      <View style={styles.refundIcon}>
        <Ionicons name="return-down-back" size={20} color={colors.success} />
      </View>
      <Text style={type.title}>{t('booking.cancelledTitle')}</Text>
      {refund ? (
        <>
          <Text style={styles.refundAmount}>{t('booking.refundAmount', { amount: money(refund.amount) })}</Text>
          <Text style={type.body}>
            {refund.destination ? t(`booking.refundDestination.${refund.destination}`) : ''}
            {refund.status ? ` · ${t(`booking.refundStatus.${refund.status}`)}` : ''}
          </Text>
          {refund.policy_rule ? <Text style={type.small}>{t('booking.policyRule', { rule: refund.policy_rule })}</Text> : null}
        </>
      ) : wasPaid ? (
        <Text style={type.small}>{t('booking.noRefund')}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: colors.bg },
  plain: { flex: 1, backgroundColor: colors.bg },
  plainBar: { paddingHorizontal: space.lg },
  overscroll: { position: 'absolute', top: 0, left: 0, right: 0, height: 400 },
  statusStrip: { position: 'absolute', top: 0, left: 0, right: 0 },
  scroll: { flexGrow: 1, backgroundColor: colors.bg },
  hero: {
    overflow: 'hidden',
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    gap: space.lg,
  },
  texture: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: 0.8 },
  status: { alignItems: 'center', gap: space.sm },
  mark: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.onSport,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  statusTitle: { ...type.display, color: colors.onSport, textAlign: 'center' },
  statusNote: { fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: space.md },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.sportShade,
  },
  pillText: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.onSport },
  stretch: { alignSelf: 'stretch', marginTop: space.sm },
  infoWrap: { gap: space.md },
  glass: {
    backgroundColor: colors.sportGlass,
    borderColor: colors.sportGlassBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.sportGlassBorder,
  },
  matchTitle: { flex: 1, fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 22, color: colors.onSport },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  infoRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.sportGlassBorder },
  infoLabel: { fontFamily: fontFamily.medium, fontSize: 14 },
  infoValue: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.onSport, flexShrink: 1, textAlign: 'right' },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  payCard: { gap: 0, paddingVertical: space.sm },
  cancelCard: { gap: space.md },
  policy: { gap: 2 },
  refund: { gap: space.sm },
  refundIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refundAmount: { fontFamily: fontFamily.display, fontSize: 26, lineHeight: 32, textTransform: 'uppercase', color: colors.success },
});
