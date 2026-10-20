import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
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

/**
 * Push ko'prigi (UI chizmaydi): host sessiyasida token'ni `PUT /v1/me/devices` ga yozadi, logout'da
 * o'chiradi; taklif push'i bosilsa — takliflar ekraniga (`/?offer=<id>`), sovuq start'da ham.
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
    if (status === 'signedIn' || status === 'signedOut') reconnectRealtime();
  }, [signedIn, status]);

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
        // Internetsiz ochilgan bo'lishi mumkin — keyingi safar
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

  useEffect(
    () =>
      tokens.beforeLogout(async () => {
        const token = registered.current;
        registered.current = null;
        if (token) await unregisterDevice(token);
      }),
    [],
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handle = (r: Notifications.NotificationResponse) => {
      if (r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = r.notification.request.content.data;
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
  }, []);

  useEffect(() => {
    if (!signedIn || !pending) return;
    const { url, notificationId } = pending;
    setPending(null);
    if (notificationId) void call(api.POST('/v1/me/notifications/read', { body: { ids: [notificationId] } })).catch(() => undefined);
    if (url) requestAnimationFrame(() => router.navigate(url as Href));
  }, [signedIn, pending]);

  // Ilova ochiq paytda taklif keldi — ro'yxat yangilanadi (WebSocket bilan birga, ikkalasi ham idempotent)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const d = (n.request.content.data ?? {}) as { type?: string };
      if (d.type === 'host.offer') void queryClient.invalidateQueries({ queryKey: qk.offers });
    });
    return () => sub.remove();
  }, [queryClient]);

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
