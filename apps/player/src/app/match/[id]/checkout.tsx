import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { PaymentProvider } from '@matchup/contracts';
import { api, call } from '@/api/client';
import { ApiError, isApiError } from '@/api/errors';
import { qk, useMatch, usePaymentMethods, useRequiredWaiver } from '@/api/queries';
import { colors, font, radius, space } from '@/components/theme';
import { Body, Button, Card, Divider, ErrorText, ErrorView, Footer, Loading, Muted, Notice, Row, Screen } from '@/components/ui';
import { paymentReturnUrl, PROVIDER_COLORS, rememberCheckout } from '@/features/payment';
import { currentLocale } from '@/i18n';
import { formatDay, formatTime } from '@/lib/datetime';
import { uuid } from '@/lib/device';
import { money } from '@/lib/money';

interface Attempt {
  provider: PaymentProvider;
  /** Har yangi urinish (tugma bosilishi) — yangi kalit; tarmoq xatosidagi avtomatik qayta yuborish — o'sha kalit. */
  idempotencyKey: string;
}

export default function CheckoutScreen() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const { id: matchId } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const match = useMatch(matchId);
  const waiver = useRequiredWaiver(matchId);
  const methods = usePaymentMethods(matchId);
  const [selected, setSelected] = useState<PaymentProvider>();

  const price = match.data?.price;
  const balance = methods.data?.wallet_balance;
  const walletEnough = !!price && !!balance && balance.amount >= price.amount;

  // Standart tanlov: hamyon yetsa — hamyon, aks holda birinchi provider (priority bo'yicha)
  const provider = useMemo<PaymentProvider | undefined>(() => {
    if (selected) return selected;
    const list = methods.data?.methods ?? [];
    if (walletEnough && list.some((m) => m.provider === 'wallet')) return 'wallet';
    return list.find((m) => m.provider !== 'wallet')?.provider;
  }, [selected, methods.data, walletEnough]);

  useEffect(() => {
    if (waiver.data && !waiver.data.signed) router.replace({ pathname: '/match/[id]/waiver', params: { id: matchId } });
  }, [waiver.data, matchId]);

  const book = useMutation({
    mutationFn: async ({ provider: p, idempotencyKey }: Attempt) => {
      const result = await call(
        api.POST('/v1/bookings', {
          params: { header: { 'Idempotency-Key': idempotencyKey } },
          body: {
            match_id: matchId,
            seats: 1,
            payment_method: p,
            use_wallet: p === 'wallet',
            waiver_signature_id: waiver.data!.signature_id!,
            return_url: paymentReturnUrl(),
          },
        }),
      );
      // Stripe Payment Sheet (type: sdk) — keyingi iteratsiya; UZ'da server uni taklif qilmaydi
      if (result.checkout.type === 'sdk') throw new ApiError({ status: 0, code: 'PAYMENT_METHOD_UNAVAILABLE' });
      return result;
    },
    // Javob kelmay qolgan bo'lsa (tarmoq) — o'sha Idempotency-Key bilan xavfsiz qayta yuboramiz
    retry: (count, err) => isApiError(err, 'NETWORK') && count < 2,
    onSuccess: async ({ booking, checkout }) => {
      queryClient.setQueryData(qk.booking(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: ['match'] });
      void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
      if (checkout.type === 'redirect') {
        rememberCheckout(booking.id, checkout.url);
        router.replace({ pathname: '/booking/[id]', params: { id: booking.id, pay: '1' } });
      } else {
        // type: none — hamyon to'liq yopdi, booking allaqachon confirmed
        router.replace({ pathname: '/booking/[id]', params: { id: booking.id } });
      }
    },
    onError: (err) => {
      if (isApiError(err, 'WAIVER_REQUIRED')) router.replace({ pathname: '/match/[id]/waiver', params: { id: matchId } });
      if (isApiError(err, 'WALLET_INSUFFICIENT')) void methods.refetch();
    },
  });

  if (match.isPending || waiver.isPending || methods.isPending) return <Loading />;
  const error = match.error ?? waiver.error ?? methods.error;
  if (error) {
    return (
      <ErrorView
        error={error}
        onRetry={() => void Promise.all([match.refetch(), waiver.refetch(), methods.refetch()])}
      />
    );
  }
  const m = match.data!;
  const list = methods.data?.methods ?? [];

  return (
    <View style={styles.flex}>
      <Screen>
        <Card>
          <Muted>{t('checkout.order')}</Muted>
          <Text style={font.h3}>{m.title || m.venue.name}</Text>
          <Body>
            {formatDay(m.starts_at, m.timezone, locale)}, {formatTime(m.starts_at, m.timezone)}
          </Body>
          <Muted>{m.venue.name}</Muted>
          <Divider />
          <Row label={t('checkout.seat')} value={money(m.price)} />
          <Row label={t('checkout.total')} value={money(m.price)} strong />
        </Card>

        <Text style={[font.h3, { marginTop: space.sm }]}>{t('checkout.method')}</Text>
        {list.length === 0 ? <Notice tone="warning">{t('checkout.noMethods')}</Notice> : null}
        {list.map((pm) => {
          const p = pm.provider!;
          const isWallet = p === 'wallet';
          const disabled = isWallet && !walletEnough;
          const active = provider === p;
          return (
            <Pressable
              key={p}
              testID={`method-${p}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: active, disabled }}
              disabled={disabled}
              onPress={() => setSelected(p)}
              style={[styles.method, active && styles.methodActive, disabled && styles.methodDisabled]}
            >
              <View style={[styles.methodIcon, { backgroundColor: PROVIDER_COLORS[p] ?? colors.muted }]}>
                {isWallet ? (
                  <Ionicons name="wallet-outline" size={20} color={colors.white} />
                ) : (
                  <Text style={styles.methodLetter}>{(pm.display_name ?? p).slice(0, 1)}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={font.h3}>{pm.display_name ?? p}</Text>
                {isWallet ? (
                  <Muted>
                    {t('checkout.balance', { amount: money(balance) })}
                    {disabled ? ` · ${t('checkout.insufficient')}` : ''}
                  </Muted>
                ) : null}
              </View>
              <Ionicons
                name={active ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={active ? colors.primary : colors.faint}
              />
            </Pressable>
          );
        })}
        <Muted style={{ textAlign: 'center' }}>{t('checkout.holdNote')}</Muted>
      </Screen>
      <Footer>
        <ErrorText error={book.error} />
        <Button
          testID="pay"
          title={t('checkout.pay', { amount: money(m.price) })}
          disabled={!provider || !waiver.data?.signature_id}
          loading={book.isPending}
          onPress={() => provider && book.mutate({ provider, idempotencyKey: uuid() })}
        />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  methodActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  methodDisabled: { opacity: 0.5 },
  methodIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  methodLetter: { color: colors.white, fontWeight: '800', fontSize: 18 },
});
