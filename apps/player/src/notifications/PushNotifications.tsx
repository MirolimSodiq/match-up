import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, call } from '@/api/client';
import { qk } from '@/api/queries';
import { useSession } from '@/auth/session';
import { tokens } from '@/auth/tokens';
import { reconnectRealtime } from '@/realtime/socket';
import {
  configureNotifications,
  deepLinkOf,
  notificationIdOf,
  obtainPushToken,
  registerDevice,
  setPushSessionActive,
  unregisterDevice,
} from './push';

configureNotifications();

interface Pending {
  url: string | null;
  notificationId: string | null;
}

/** Xabar bo'yicha tegishli ekran ma'lumotlarini yangilash (ilova ochiq paytda kelganda yoki bosilganda). */
function refreshFor(queryClient: QueryClient, data: unknown) {
  const d = (data ?? {}) as { booking_id?: string; match_id?: string; type?: string };
  if (d.booking_id) {
    void queryClient.invalidateQueries({ queryKey: qk.booking(d.booking_id) });
    void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
  }
  if (d.match_id) void queryClient.invalidateQueries({ queryKey: ['match'] });
  if (d.type === 'refund.issued') void queryClient.invalidateQueries({ queryKey: qk.wallet });
  // Eksport tayyor: "Maxfiylik" ekrani polling'ni kutmasdan "Tayyor" holatiga o'tadi
  if (d.type === 'privacy.export_ready') void queryClient.invalidateQueries({ queryKey: qk.dataRequests });
  if (d.type?.startsWith('highlight.')) void queryClient.invalidateQueries({ queryKey: ['highlights'] });
}

/**
 * Push xabarnomalar ko'prigi (UI chizmaydi): sessiya bo'lsa token'ni `PUT /v1/me/devices` ga yozadi,
 * logout'da o'chiradi, xabar bosilganda deep link'ga o'tadi (sovuq start'da ham — sessiya tiklangach),
 * ilova ochiq paytda kelgan xabar bo'yicha tegishli ma'lumotlarni yangilaydi.
 */
export function PushNotifications() {
  const { status } = useSession();
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const registered = useRef<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const signedIn = status === 'signedIn';

  useEffect(() => {
    setPushSessionActive(signedIn);
    // Token o'zgardi (login/logout) — WebSocket yangi token bilan qayta ulanadi
    if (status === 'signedIn' || status === 'signedOut') reconnectRealtime();
  }, [signedIn, status]);

  // Ro'yxatdan o'tkazish: login'da, til o'zgarganda va qurilma token'i yangilanganda
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      const token = await obtainPushToken();
      if (!token || cancelled) return;
      try {
        await registerDevice(token, i18n.language);
        registered.current = token;
      } catch {
        // Keyingi ochilishda yana urinadi
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, i18n.language, rotation]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addPushTokenListener(() => setRotation((r) => r + 1));
    return () => sub.remove();
  }, []);

  // Logout: token hali yaroqli paytda qurilmani akkauntdan uzamiz
  useEffect(
    () =>
      tokens.beforeLogout(async () => {
        const token = registered.current;
        registered.current = null;
        if (token) await unregisterDevice(token);
      }),
    [],
  );

  // Xabar bosildi (ilova ochiq, fonda yoki yopiq bo'lganda)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handle = (r: Notifications.NotificationResponse) => {
      if (r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = r.notification.request.content.data;
      // Fonda kelgan xabarda "received" listener ishlamaydi — keshni bosilganda yangilaymiz
      refreshFor(queryClient, data);
      setPending({ url: deepLinkOf(data), notificationId: notificationIdOf(data) });
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      handle(last);
      Notifications.clearLastNotificationResponse();
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handle(r);
      Notifications.clearLastNotificationResponse();
    });
    return () => sub.remove();
  }, [queryClient]);

  // Navigatsiya faqat sessiya tiklangach (aks holda guard login'ga qaytaradi)
  useEffect(() => {
    if (!signedIn || !pending) return;
    const { url, notificationId } = pending;
    setPending(null);
    if (notificationId) void call(api.POST('/v1/me/notifications/read', { body: { ids: [notificationId] } })).catch(() => undefined);
    if (url) requestAnimationFrame(() => router.push(url as Href));
  }, [signedIn, pending]);

  // Ilova ochiq paytda kelgan xabar — tegishli ekran ma'lumotlarini yangilash
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationReceivedListener((n) => refreshFor(queryClient, n.request.content.data));
    return () => sub.remove();
  }, [queryClient]);

  // Ilovada xabarlar ro'yxati yo'q: ochilganda badge nolga tushadi va xabarlar o'qilgan deb belgilanadi
  useEffect(() => {
    if (!signedIn || Platform.OS === 'web') return;
    const clear = () => {
      void Notifications.setBadgeCountAsync(0).catch(() => undefined);
      void call(api.POST('/v1/me/notifications/read', { body: { all: true } })).catch(() => undefined);
    };
    clear();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && clear());
    return () => sub.remove();
  }, [signedIn]);

  return null;
}
