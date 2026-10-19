import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { useTranslation } from 'react-i18next';
import { qk, useBooking } from '@/api/queries';
import { colors, radius, space, type } from '@/components/theme';
import { Badge, Button, EmptyState, IconButton, Notice } from '@/components/ui';
import { checkoutUrlFor, isPaymentReturn, openCheckout } from '@/features/payment';

const HTTP = /^https?:\/\//i;

/**
 * To'lov gateway'i (Payme/Click) ilova ichidagi WebView'da, ilova uslubidagi oq ramka bilan.
 * - `return_url` ga yo'naltirish ushlanadi — WebView yopiladi, booking ekrani polling'ni davom ettiradi;
 * - `payme://`, `click://`, bank ilovalari va boshqa http bo'lmagan havolalar tizimga (tashqi ilovaga) beriladi;
 * - sahifa ochilmasa (tarmoq/3DS xatosi) — tashqi brauzerga fallback.
 */
export default function PaymentScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useBooking(id);
  const url = checkoutUrlFor(id);

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [host, setHost] = useState(() => hostOf(url));
  const lastUrl = useRef(url);

  const close = () => {
    void queryClient.invalidateQueries({ queryKey: qk.booking(id) });
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/booking/[id]', params: { id } });
  };

  // To'lov tasdiqlandi (yoki hold muddati o'tdi) — gateway'ni yopamiz, natija booking ekranida
  const status = booking.data?.status;
  useEffect(() => {
    if (status && status !== 'pending_payment') close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const openExternal = () => {
    const target = lastUrl.current ?? url;
    if (target) void WebBrowser.openBrowserAsync(target).catch(() => undefined);
  };

  const onShouldStart = (req: ShouldStartLoadRequest): boolean => {
    if (isPaymentReturn(req.url)) {
      close();
      return false;
    }
    if (!HTTP.test(req.url) && !req.url.startsWith('about:')) {
      // payme://, click://, bank ilovasi, tel: … — tizim ochadi; ilova o'rnatilmagan bo'lsa — brauzer fallback
      Linking.openURL(req.url).catch(() => setFailed(true));
      return false;
    }
    return true;
  };

  const onNavigation = (nav: WebViewNavigation) => {
    if (HTTP.test(nav.url)) {
      lastUrl.current = nav.url;
      setHost(hostOf(nav.url));
    }
  };

  if (!url) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <EmptyState icon="link-outline" title={t('pay.noUrl')} action={<Button title={t('common.close')} variant="secondary" onPress={close} />} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm }]}>
      {/* Ostidagi band ekrani sport rangida (oq status bar) — bu yerda fon och */}
      <StatusBar style="dark" />
      <View style={styles.header}>
        <IconButton icon="close" label={t('common.close')} variant="light" onPress={close} />
        <View style={styles.flex}>
          <Text style={type.h3}>{t('pay.title')}</Text>
          <View style={styles.secure}>
            <Ionicons name="lock-closed" size={12} color={colors.success} />
            <Text style={type.small} numberOfLines={1}>
              {host ?? t('pay.secure')}
            </Text>
          </View>
        </View>
        <Badge icon="time-outline" label={t('booking.status.pending_payment')} tone="warning" />
      </View>

      {/* Tashqi sahifa — ilova uslubidagi oq ramka ichida */}
      <View style={styles.frame}>
        {Platform.OS === 'web' ? (
          <WebFallback url={url} />
        ) : (
          <WebView
            source={{ uri: url }}
            style={styles.webview}
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={onShouldStart}
            onNavigationStateChange={onNavigation}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => setFailed(true)}
            onHttpError={(e) => {
              if (e.nativeEvent.statusCode >= 500) setFailed(true);
            }}
            setSupportMultipleWindows={false}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            // Sahifa yuklanguncha ramka foni bilan bir xil bo'lsin
            containerStyle={styles.webviewContainer}
          />
        )}
        {loading && Platform.OS !== 'web' ? (
          <View style={styles.loader} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[type.small, { marginTop: space.md }]}>{t('pay.secure')}</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        {failed ? (
          <Notice tone="warning" icon="alert-circle-outline">
            {t('pay.loadFailed')}
          </Notice>
        ) : (
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.warning} />
            <Text style={[type.small, styles.flex]}>{t('booking.awaitingPayment')}</Text>
          </View>
        )}
        <Button title={t('pay.openExternal')} icon="open-outline" variant={failed ? 'primary' : 'secondary'} onPress={openExternal} />
      </View>
    </View>
  );
}

/** Web build: react-native-webview ishlamaydi — avvalgidek yangi oynada ochamiz. */
function WebFallback({ url }: { url: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.webFallback}>
      <Button title={t('booking.openCheckout')} icon="open-outline" onPress={() => void openCheckout(url)} />
    </View>
  );
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m?.[1];
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  flex: { flex: 1 },
  secure: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  frame: {
    flex: 1,
    marginHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  webview: { flex: 1, backgroundColor: colors.surface },
  webviewContainer: { backgroundColor: colors.surface },
  loader: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
