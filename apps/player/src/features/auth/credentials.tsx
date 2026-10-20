import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import type { SocialCredential } from '@matchup/contracts';
import { ApiError } from '@/api/errors';
import { googleClientIds, isExpoGo } from './social';

/**
 * Provider oynasini ochib credential oladi (server `POST /v1/auth/social` yoki `POST /v1/me/identities` da
 * tekshiradi). `null` — foydalanuvchi oynani yopdi.
 */
export type CredentialGetter = () => Promise<SocialCredential | null>;

/** Sign in with Apple faqat iOS'da (va qurilma/simulyator qo'llasa). */
export function useAppleAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);
  return available;
}

/** Apple: xom nonce serverga, SHA-256'i Apple'ga (token'dagi `nonce` = SHA-256 hex). */
export async function appleCredential(): Promise<SocialCredential | null> {
  const nonce = randomUUID();
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    nonce: await digestStringAsync(CryptoDigestAlgorithm.SHA256, nonce),
  });
  if (!credential.identityToken) throw new ApiError({ status: 0, code: 'SOCIAL_TOKEN_INVALID' });
  return {
    provider: 'apple',
    id_token: credential.identityToken,
    nonce,
    // Ism faqat birinchi kirishda keladi
    profile: {
      first_name: credential.fullName?.givenName ?? undefined,
      last_name: credential.fullName?.familyName ?? undefined,
    },
  };
}

/** Apple oynasi yopilganda keladigan xato — foydalanuvchiga ko'rsatilmaydi. */
export function isCancel(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'ERR_REQUEST_CANCELED';
}

export interface GoogleCredentialState {
  get: CredentialGetter;
  /** expo-auth-session so'rovi tayyor (discovery, PKCE) — bosish mumkin. */
  ready: boolean;
}

/**
 * Google credential: expo-auth-session hook'i faqat client ID sozlangan va Expo Go bo'lmaganda chaqiriladi
 * (aks holda hook xato beradi), shuning uchun render-prop komponent. Sozlanmagan bo'lsa `get` sababini
 * aytadigan client xatosi bilan rad etadi.
 */
export function GoogleCredential({ children }: { children: (google: GoogleCredentialState) => ReactNode }) {
  const ids = googleClientIds();
  if (ids && !isExpoGo) return <ConfiguredGoogle ids={ids}>{children}</ConfiguredGoogle>;
  const code = isExpoGo ? 'SOCIAL_EXPO_GO' : 'SOCIAL_NOT_CONFIGURED';
  return children({ ready: true, get: () => Promise.reject(ApiError.client(code)) });
}

type Pending = { resolve: (c: SocialCredential | null) => void; reject: (e: unknown) => void };

const EXCHANGE_TIMEOUT_MS = 30_000;

/**
 * Native'da PKCE authorization code -> token almashinuvi hook ichida bo'ladi va natija keyingi `response`da
 * keladi; web'da to'g'ridan-to'g'ri `id_token` (nonce bilan — serverga ham yuboriladi). Shu sabab `get`
 * promise'i `promptAsync` emas, `response` o'zgarganda yakunlanadi.
 */
function ConfiguredGoogle({
  ids,
  children,
}: {
  ids: NonNullable<ReturnType<typeof googleClientIds>>;
  children: (google: GoogleCredentialState) => ReactNode;
}) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({ ...ids, selectAccount: true });
  const pending = useRef<Pending | null>(null);

  const settle = useCallback((fn: (p: Pending) => void) => {
    const p = pending.current;
    pending.current = null;
    if (p) fn(p);
  }, []);

  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const idToken = response.params.id_token ?? response.authentication?.idToken;
      settle((p) =>
        idToken
          ? p.resolve({ provider: 'google', id_token: idToken, nonce: request?.nonce })
          : p.reject(new ApiError({ status: 0, code: 'SOCIAL_TOKEN_INVALID' })),
      );
    } else if (response.type === 'error') {
      settle((p) => p.reject(response.error ?? new ApiError({ status: 0, code: 'UNKNOWN' })));
    } else {
      settle((p) => p.resolve(null));
    }
    // Faqat yangi javobga reaksiya
  }, [response]);

  const get = useCallback<CredentialGetter>(
    () =>
      new Promise((resolve, reject) => {
        const entry: Pending = { resolve, reject };
        pending.current = entry;
        // Faqat shu so'rovni yakunlaydi (keyingi bosish o'z `entry`siga ega)
        const own = (fn: (p: Pending) => void) => pending.current === entry && settle(fn);
        promptAsync().then(
          (r) => {
            if (r.type !== 'success' && r.type !== 'error') own((p) => p.resolve(null));
            // Muvaffaqiyatda token almashinuvini `response` orqali kutamiz. Almashinuv xatosini hook yutib
            // yuboradi (`response` kelmaydi) — tugma abadiy aylanib qolmasligi uchun muddat
            else setTimeout(() => own((p) => p.reject(new ApiError({ status: 0, code: 'UNKNOWN' }))), EXCHANGE_TIMEOUT_MS);
          },
          (e: unknown) => own((p) => p.reject(e)),
        );
      }),
    [promptAsync, settle],
  );

  return children({ get, ready: !!request });
}
