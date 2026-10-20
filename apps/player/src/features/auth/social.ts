import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { SocialCredential } from '@matchup/contracts';
import { api, call } from '@/api/client';

type TelegramAuth = Extract<SocialCredential, { provider: 'telegram' }>['telegram_auth'];

/** Expo Go: native modullar bor, lekin bundle ID / URL sxemasi Expo Go'niki (host.exp.Exponent, exp://). */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Google OAuth client ID'lari (Google Cloud Console). iOS client'ning redirect'i — bundle ID sxemasi
 * (`uz.matchup.player:/oauthredirect`), shuning uchun Expo Go'da ishlamaydi.
 */
export function googleClientIds() {
  const ids = {
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  };
  const current = Platform.select({ ios: ids.iosClientId, android: ids.androidClientId, default: ids.webClientId });
  return current ? ids : undefined;
}

/** base64 / base64url -> UTF-8 matn (Hermes'da TextDecoder'ga tayanmaymiz). */
function decodeBase64Utf8(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(b64);
  return decodeURIComponent(Array.from(binary, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
}

/** `...#tgAuthResult=<base64 JSON>` -> Telegram Login maydonlari (null — bekor qilingan). */
export function parseTelegramReturn(url: string): TelegramAuth | null {
  // RN'ning URLSearchParams polifili to'liq emas — fragment'ni qo'lda o'qiymiz
  const match = /[#&]tgAuthResult=([^&]+)/.exec(url);
  if (!match?.[1]) return null;
  const data = JSON.parse(decodeBase64Utf8(decodeURIComponent(match[1]))) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as TelegramAuth;
}

/**
 * Telegram Login brauzer orqali: API `/v1/auth/telegram/start` -> oauth.telegram.org -> API qaytish sahifasi ->
 * ilova deep link'i. Bot domeni (@BotFather `/setdomain`) API host'i bo'lishi kerak — localhost'da ishlamaydi.
 */
export async function telegramCredential(): Promise<SocialCredential | null> {
  const redirect = Linking.createURL('auth/telegram');
  // URL'ni avval JSON'da olamiz: Telegram serverda sozlanmagan bo'lsa xato ilovada ko'rinadi, brauzerda emas
  const { url } = await call(
    api.GET('/v1/auth/telegram/start', { params: { query: { redirect_uri: redirect } }, headers: { Accept: 'application/json' } }),
  );
  const result = await WebBrowser.openAuthSessionAsync(url, redirect);
  if (result.type !== 'success') return null;
  const data = parseTelegramReturn(result.url);
  return data ? { provider: 'telegram', telegram_auth: data } : null;
}
