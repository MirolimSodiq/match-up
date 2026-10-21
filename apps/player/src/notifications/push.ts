import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { api, call } from '@/api/client';
import { APP_VERSION } from '@/lib/device';

/** Push `data.url` — faqat ilovaning ma'lum ekranlariga (begona yo'l bilan navigatsiya qilinmaydi). */
const DEEP_LINKS = [/^\/booking\/[0-9a-f-]{36}$/i, /^\/match\/[0-9a-f-]{36}(\?rate=1)?$/i, /^\/highlight\/[0-9a-f-]{36}$/i, /^\/account\/privacy$/];

export function deepLinkOf(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  return typeof url === 'string' && DEEP_LINKS.some((re) => re.test(url)) ? url : null;
}

export function notificationIdOf(data: unknown): string | null {
  const id = (data as { notification_id?: unknown } | null)?.notification_id;
  return typeof id === 'string' ? id : null;
}

let signedIn = false;

/** Ilova ochiq paytda kelgan push ham banner bo'lib ko'rinadi — faqat sessiya bo'lsa. */
export function configureNotifications() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: signedIn,
      shouldShowList: signedIn,
      shouldPlaySound: signedIn,
      shouldSetBadge: signedIn,
    }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('default', {
      name: 'Match Up',
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => undefined);
  }
}

export function setPushSessionActive(active: boolean) {
  signedIn = active;
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/**
 * Ruxsat so'raydi va Expo push token'ini oladi. `null` — ruxsat yo'q, web, EAS projectId
 * sozlanmagan (lokal dev) yoki qurilma token bera olmadi (ba'zi simulyatorlar).
 */
export async function obtainPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && current.canAskAgain) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  const id = projectId();
  if (!id) {
    if (__DEV__) console.info('[push] EAS projectId sozlanmagan — Expo push token olinmaydi');
    return null;
  }
  try {
    return (await withTimeout(Notifications.getExpoPushTokenAsync({ projectId: id }), 15_000)).data;
  } catch (err) {
    if (__DEV__) console.warn('[push] token olinmadi:', (err as Error).message);
    return null;
  }
}

export async function registerDevice(pushToken: string, locale: string) {
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
  await call(api.PUT('/v1/me/devices', { body: { push_token: pushToken, platform, provider: 'expo', app_version: APP_VERSION, locale } }));
}

export async function unregisterDevice(pushToken: string) {
  await call(api.DELETE('/v1/me/devices/{token}', { params: { path: { token: pushToken } } }));
}
