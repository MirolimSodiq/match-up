import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Booking, BookingStatus, Refund } from '@matchup/contracts';
import { api, call } from '@/api/client';
import { qk, useBooking, useMatch } from '@/api/queries';
import { colors, font, space } from '@/components/theme';
import { Badge, Body, Button, Card, Divider, ErrorText, ErrorView, H2, Loading, Muted, Notice, Row, Screen } from '@/components/ui';
import { checkoutUrlFor, closeCheckout, openCheckout } from '@/features/payment';
import { currentLocale } from '@/i18n';
import { formatDay, formatTime } from '@/lib/datetime';
import { uuid } from '@/lib/device';
import { money } from '@/lib/money';

const STATUS_TONE: Record<BookingStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending_payment: 'warning',
  confirmed: 'success',
  cancelled: 'danger',
  expired: 'neutral',
  completed: 'neutral',
};

export default function BookingScreen() {
  const { t } = useTranslation();
  const { id, pay } = useLocalSearchParams<{ id: string; pay?: string }>();
  const queryClient = useQueryClient();
  const booking = useBooking(id);
  const status = booking.data?.status;

  // Checkout'dan kelganda to'lov sahifasini bir marta avtomatik ochamiz
  const autoOpened = useRef(false);
  useEffect(() => {
    const url = checkoutUrlFor(id);
    if (pay !== '1' || autoOpened.current || !url) return;
    autoOpened.current = true;
    void openCheckout(url).then(() => queryClient.invalidateQueries({ queryKey: qk.booking(id) }));
  }, [pay, id, queryClient]);

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

  if (booking.isPending) return <Loading />;
  if (booking.error) return <ErrorView error={booking.error} onRetry={() => void booking.refetch()} />;
  const b = booking.data;

  return (
    <Screen>
      <StatusHeader booking={b} />
      {b.match ? <MatchCardMini booking={b} /> : null}
      <PaymentCard booking={b} />
      <CancelSection booking={b} />
    </Screen>
  );
}

function StatusHeader({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const tz = b.match?.timezone ?? 'Asia/Tashkent';
  const url = checkoutUrlFor(b.id);
  return (
    <Card style={{ gap: space.md }}>
      <Badge label={t(`booking.status.${b.status}`)} tone={STATUS_TONE[b.status]} />
      {b.status === 'pending_payment' ? (
        <>
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.warning} />
            <Body style={{ flex: 1 }}>{t('booking.awaitingPayment')}</Body>
          </View>
          {b.expires_at ? <Muted>{t('booking.holdUntil', { time: formatTime(b.expires_at, tz) })}</Muted> : null}
          {url ? <Button testID="open-checkout" title={t('booking.openCheckout')} onPress={() => void openCheckout(url)} /> : null}
        </>
      ) : null}
      {b.status === 'confirmed' ? (
        <>
          <Notice tone="success">{t('booking.confirmedNote')}</Notice>
          <Button
            testID="open-ticket"
            title={t('booking.ticket')}
            onPress={() => router.push({ pathname: '/booking/[id]/ticket', params: { id: b.id } })}
          />
        </>
      ) : null}
    </Card>
  );
}

function MatchCardMini({ booking: b }: { booking: Booking }) {
  const locale = currentLocale();
  const m = b.match!;
  return (
    <Card onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.id } })}>
      <Text style={font.h3}>{m.title || m.venue.name}</Text>
      <Body>
        {formatDay(m.starts_at, m.timezone, locale)}, {formatTime(m.starts_at, m.timezone)}–{formatTime(m.ends_at, m.timezone)}
      </Body>
      <Muted>
        {m.venue.name}
        {m.public_code ? ` · ${m.public_code}` : ''}
      </Muted>
    </Card>
  );
}

function PaymentCard({ booking: b }: { booking: Booking }) {
  const { t } = useTranslation();
  const walletUsed = (b.wallet_applied?.amount ?? 0) > 0;
  return (
    <Card>
      <Row label={t('common.seats', { count: b.seats })} value={money(b.unit_price)} />
      {walletUsed ? <Row label={t('booking.walletApplied')} value={money(b.wallet_applied)} /> : null}
      <Divider />
      <Row label={b.status === 'confirmed' || b.status === 'completed' ? t('booking.paid') : t('checkout.total')} value={money(walletUsed ? b.wallet_applied : b.total)} strong />
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

  if (!open) return <Button testID="cancel-booking" title={t('booking.cancel')} variant="danger" onPress={() => setOpen(true)} />;

  const paidByCard = b.status === 'confirmed' && (b.total?.amount ?? 0) > 0;
  const policy = match.data?.cancellation_policy?.summary;
  return (
    <Card style={{ gap: space.md }}>
      <Text style={font.h3}>{t('booking.cancelTitle')}</Text>
      {policy ? (
        <View>
          <Muted>{t('match.cancellationPolicy')}</Muted>
          <Body>{policy}</Body>
        </View>
      ) : null}
      {paidByCard ? (
        <View style={styles.switchRow}>
          <Body style={{ flex: 1 }}>{t('booking.refundToWallet')}</Body>
          <Switch value={toWallet} onValueChange={setToWallet} trackColor={{ true: colors.primary, false: colors.border }} />
        </View>
      ) : null}
      <ErrorText error={cancel.error} />
      <Button
        testID="confirm-cancel"
        title={t('booking.confirmCancel')}
        variant="danger"
        loading={cancel.isPending}
        onPress={() => cancel.mutate(uuid())}
      />
      <Button title={t('booking.keep')} variant="ghost" onPress={() => setOpen(false)} />
    </Card>
  );
}

function RefundResult({ refund, wasPaid }: { refund: Refund | null; wasPaid: boolean }) {
  const { t } = useTranslation();
  return (
    <Card style={{ gap: space.sm }}>
      <H2>{t('booking.cancelledTitle')}</H2>
      {refund ? (
        <>
          <Text style={styles.refundAmount}>{t('booking.refundAmount', { amount: money(refund.amount) })}</Text>
          <Body>
            {refund.destination ? t(`booking.refundDestination.${refund.destination}`) : ''}
            {refund.status ? ` · ${t(`booking.refundStatus.${refund.status}`)}` : ''}
          </Body>
          {refund.policy_rule ? <Muted>{t('booking.policyRule', { rule: refund.policy_rule })}</Muted> : null}
        </>
      ) : wasPaid ? (
        <Muted>{t('booking.noRefund')}</Muted>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  refundAmount: { fontSize: 20, fontWeight: '700', color: colors.primaryDark },
});
