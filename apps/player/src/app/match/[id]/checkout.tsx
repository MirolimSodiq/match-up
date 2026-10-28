import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { PaymentProvider } from '@matchup/contracts';
import { Button, colors, ErrorText, ErrorView, fontFamily, Footer, Loading, Notice, Perforation, radius, SheetScreen, space, sportColors, SportIcon, SportTexture, states, type } from '@matchup/ui';
import { api, call } from '@/api/client';
import { ApiError, isApiError } from '@/api/errors';
import { qk, useMatch, usePaymentMethods, useRequiredWaiver } from '@/api/queries';
import { paymentReturnUrl, PROVIDER_COLORS, PROVIDER_ON_COLORS, rememberCheckout } from '@/features/payment';
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
    onSuccess: ({ booking, checkout }) => {
      queryClient.setQueryData(qk.booking(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: ['match'] });
      void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
      // Match va to'lov sheet'lari yopiladi — band ekrani tab'lar ustida oddiy sahifa bo'lib ochiladi
      router.dismissAll();
      if (checkout.type === 'redirect') {
        rememberCheckout(booking.id, checkout.url);
        router.push({ pathname: '/booking/[id]', params: { id: booking.id, pay: '1' } });
      } else {
        // type: none — hamyon to'liq yopdi, booking allaqachon confirmed
        router.push({ pathname: '/booking/[id]', params: { id: booking.id } });
      }
    },
    onError: (err) => {
      if (isApiError(err, 'WAIVER_REQUIRED')) router.replace({ pathname: '/match/[id]/waiver', params: { id: matchId } });
      if (isApiError(err, 'WALLET_INSUFFICIENT')) void methods.refetch();
    },
  });

  const close = () => router.back();
  if (match.isPending || waiver.isPending || methods.isPending) {
    return (
      <SheetScreen onClose={close}>
        <Loading />
      </SheetScreen>
    );
  }
  const error = match.error ?? waiver.error ?? methods.error;
  if (error) {
    return (
      <SheetScreen onClose={close}>
        <ErrorView error={error} onRetry={() => void Promise.all([match.refetch(), waiver.refetch(), methods.refetch()])} />
      </SheetScreen>
    );
  }
  const m = match.data!;
  const sc = sportColors(m.sport);
  const list = methods.data?.methods ?? [];

  return (
    <SheetScreen title={t('checkout.title')} onClose={close}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {/* Buyurtma — sport rangidagi "chek" */}
        <View style={[styles.order, { backgroundColor: sc.base }]}>
          <SportTexture sport={m.sport} />
          <View style={styles.orderTop}>
            <View style={styles.pill}>
              <SportIcon sport={m.sport} size={14} color={colors.onSport} />
              <Text style={styles.pillText}>{m.format}</Text>
            </View>
            {m.public_code ? <Text style={[styles.code, { color: sc.muted }]}>{m.public_code}</Text> : null}
          </View>
          <Text style={styles.orderTitle}>{m.title || m.venue.name}</Text>
          <Text style={[styles.orderMeta, { color: sc.muted }]}>
            {formatDay(m.starts_at, m.timezone, locale)} · {formatTime(m.starts_at, m.timezone)}–{formatTime(m.ends_at, m.timezone)}
          </Text>
          {m.venue.name ? <Text style={[styles.orderMeta, { color: sc.muted }]}>{m.venue.name}</Text> : null}
          <Perforation notchColor={colors.surface} edgeColor={colors.surface} lineColor={colors.sportGlassBorder} />
          <View style={styles.totalRow}>
            <View>
              <Text style={[styles.orderMeta, { color: sc.muted }]}>{t('checkout.total')}</Text>
              <Text style={styles.orderMeta}>{t('checkout.seat')}</Text>
            </View>
            <Text style={styles.total}>{money(m.price)}</Text>
          </View>
        </View>

        <Text style={styles.section}>{t('checkout.method')}</Text>
        {list.length === 0 ? <Notice tone="warning">{t('checkout.noMethods')}</Notice> : null}
        <View style={styles.methods}>
          {list.map((pm, i) => {
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
                style={({ pressed }) => [
                  styles.method,
                  i > 0 && styles.methodBorder,
                  disabled && styles.methodDisabled,
                  pressed && !disabled && { opacity: states.pressedOpacity },
                ]}
              >
                <View style={[styles.methodIcon, { backgroundColor: PROVIDER_COLORS[p] ?? colors.surfaceSunken }]}>
                  {isWallet ? (
                    <Ionicons name="wallet" size={19} color={colors.onPrimary} />
                  ) : (
                    <Text style={[styles.methodLetter, PROVIDER_ON_COLORS[p] ? { color: PROVIDER_ON_COLORS[p] } : null]}>
                      {(pm.display_name ?? p).slice(0, 1)}
                    </Text>
                  )}
                </View>
                <View style={styles.flex}>
                  <Text style={type.bodyStrong}>{pm.display_name ?? p}</Text>
                  {isWallet ? (
                    <Text style={[type.small, disabled && { color: colors.danger }]}>
                      {t('checkout.balance', { amount: money(balance) })}
                      {disabled ? ` · ${t('checkout.insufficient')}` : ''}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active ? <Ionicons name="checkmark" size={16} color={colors.onPrimary} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.holdNote}>
          <Ionicons name="lock-closed" size={13} color={colors.textMuted} />
          <Text style={[type.small, styles.flexShrink]}>{t('checkout.holdNote')}</Text>
        </View>
      </ScrollView>
      <Footer transparent>
        <ErrorText error={book.error} />
        <Button
          testID="pay"
          title={t('checkout.pay', { amount: money(m.price) })}
          disabled={!provider || !waiver.data?.signature_id}
          loading={book.isPending}
          onPress={() => provider && book.mutate({ provider, idempotencyKey: uuid() })}
        />
      </Footer>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.md },
  order: { borderRadius: radius.lg, padding: space.lg, gap: 4, overflow: 'hidden' },
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.sportShade,
  },
  pillText: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.onSport },
  code: { fontFamily: fontFamily.semibold, fontSize: 12, letterSpacing: 0.6 },
  orderTitle: { fontFamily: fontFamily.bold, fontSize: 20, lineHeight: 26, color: colors.onSport },
  orderMeta: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, color: colors.onSport },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  total: { fontFamily: fontFamily.display, fontSize: 30, lineHeight: 36, textTransform: 'uppercase', color: colors.onSport },
  section: { ...type.section, marginTop: space.sm },
  methods: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, paddingHorizontal: space.lg },
  method: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 64 },
  methodBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  methodDisabled: { opacity: states.disabledOpacity + 0.15 },
  methodIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  methodLetter: { fontFamily: fontFamily.bold, fontSize: 18, color: colors.text },
  radio: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  holdNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, marginTop: space.xs },
});
