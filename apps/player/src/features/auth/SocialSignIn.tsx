import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import type { SocialCredential } from '@matchup/contracts';
import { BrandMark, Button, colors, ErrorText, fontFamily, space } from '@matchup/ui';
import { api, call } from '@/api/client';
import { ApiError, type ClientErrorCode } from '@/api/errors';
import { useSession } from '@/auth/session';
import { currentLocale } from '@/i18n';
import { deviceInfo } from '@/lib/device';
import { googleClientIds, isExpoGo, telegramCredential } from './social';

// Web: Google popup'i yopilishi uchun (native'da hech narsa qilmaydi)
WebBrowser.maybeCompleteAuthSession();

type Provider = SocialCredential['provider'];

/** Apple tugmasi bizning pill tugmalar bilan bir xil balandlikda. */
const BUTTON_HEIGHT = 54;

/**
 * Login ekranidagi "yoki" + Apple / Google / Telegram. Har provider credential'ni oladi, server
 * `POST /v1/auth/social` da tekshiradi; yangi foydalanuvchi onboarding'ga o'tadi (`is_new_user`).
 */
export function SocialSignIn() {
  const { t } = useTranslation();
  const { signIn } = useSession();
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<unknown>();
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  const login = useMutation({
    mutationFn: async (credential: SocialCredential) =>
      call(api.POST('/v1/auth/social', { body: { ...credential, device: await deviceInfo(currentLocale()) } })),
    onSuccess: (auth) => signIn(auth),
  });

  /** Credential olish (provider oynasi) -> server. Bekor qilinsa xato ko'rsatilmaydi. */
  const run = async (provider: Provider, getCredential: () => Promise<SocialCredential | null>) => {
    setError(undefined);
    setPending(provider);
    try {
      const credential = await getCredential();
      if (credential) await login.mutateAsync(credential);
    } catch (err) {
      if (!isCancel(err)) setError(err);
    } finally {
      setPending(null);
    }
  };
  const unavailable = (code: ClientErrorCode) => setError(ApiError.client(code));
  const busy = pending !== null;

  return (
    <View style={styles.root}>
      <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.line} />
        <Text style={styles.dividerText}>{t('auth.socialDivider')}</Text>
        <View style={styles.line} />
      </View>

      {appleAvailable ? (
        <AppleAuthentication.AppleAuthenticationButton
          testID="apple-sign-in"
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={BUTTON_HEIGHT / 2}
          style={[styles.apple, busy && styles.dimmed]}
          onPress={() => !busy && void run('apple', appleCredential)}
        />
      ) : null}

      <View style={styles.row}>
        <GoogleButton
          busy={busy}
          loading={pending === 'google'}
          onCredential={(c) => void run('google', async () => c)}
          onError={setError}
          onStart={() => setError(undefined)}
          onUnavailable={unavailable}
        />
        <Button
          testID="telegram-sign-in"
          variant="secondary"
          title="Telegram"
          accessibilityLabel={t('auth.continueWithTelegram')}
          leading={<BrandMark brand="telegram" />}
          loading={pending === 'telegram'}
          disabled={busy && pending !== 'telegram'}
          style={styles.half}
          onPress={() => void run('telegram', telegramCredential)}
        />
      </View>
      <ErrorText error={error ?? login.error} />
    </View>
  );
}

/** Apple: xom nonce serverga, SHA-256'i Apple'ga (token'dagi `nonce` = SHA-256 hex). */
async function appleCredential(): Promise<SocialCredential | null> {
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

interface GoogleButtonProps {
  busy: boolean;
  loading: boolean;
  onCredential: (c: SocialCredential) => void;
  onError: (e: unknown) => void;
  onStart: () => void;
  onUnavailable: (code: ClientErrorCode) => void;
}

/** Client ID sozlanmagan yoki Expo Go — tugma ko'rinadi, bosilganda sababini aytadi. */
function GoogleButton(props: GoogleButtonProps) {
  const { t } = useTranslation();
  const ids = googleClientIds();
  if (ids && !isExpoGo) return <ConfiguredGoogleButton {...props} ids={ids} />;
  return (
    <Button
      testID="google-sign-in"
      variant="secondary"
      title="Google"
      accessibilityLabel={t('auth.continueWithGoogle')}
      leading={<BrandMark brand="google" />}
      disabled={props.busy}
      style={styles.half}
      onPress={() => props.onUnavailable(isExpoGo ? 'SOCIAL_EXPO_GO' : 'SOCIAL_NOT_CONFIGURED')}
    />
  );
}

/**
 * expo-auth-session Google provider: native'da PKCE authorization code -> token almashinuvi -> `id_token`;
 * web'da to'g'ridan-to'g'ri `id_token` (nonce bilan — serverga ham yuboriladi).
 */
function ConfiguredGoogleButton({ ids, busy, loading, onCredential, onError, onStart }: GoogleButtonProps & { ids: NonNullable<ReturnType<typeof googleClientIds>> }) {
  const { t } = useTranslation();
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({ ...ids, selectAccount: true });
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!response) return;
    setWaiting(false);
    if (response.type === 'success') {
      const idToken = response.params.id_token ?? response.authentication?.idToken;
      if (idToken) onCredential({ provider: 'google', id_token: idToken, nonce: request?.nonce });
      else onError(new ApiError({ status: 0, code: 'SOCIAL_TOKEN_INVALID' }));
    } else if (response.type === 'error') {
      onError(response.error ?? new ApiError({ status: 0, code: 'UNKNOWN' }));
    }
    // Faqat yangi javobga reaksiya (callback'lar har render'da yangi)
  }, [response]);

  return (
    <Button
      testID="google-sign-in"
      variant="secondary"
      title="Google"
      accessibilityLabel={t('auth.continueWithGoogle')}
      leading={<BrandMark brand="google" />}
      loading={loading || waiting}
      disabled={!request || (busy && !loading)}
      style={styles.half}
      onPress={() => {
        onStart();
        setWaiting(true);
        promptAsync().then(
          (r) => r.type !== 'success' && setWaiting(false),
          (e: unknown) => {
            setWaiting(false);
            onError(e);
          },
        );
      }}
    />
  );
}

function isCancel(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'ERR_REQUEST_CANCELED';
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  dividerText: { fontFamily: fontFamily.medium, fontSize: 13, color: colors.textMuted, textTransform: 'lowercase' },
  // Apple qoidasi: radius faqat `cornerRadius` prop orqali, fon rangi berilmaydi
  apple: { width: '100%', height: BUTTON_HEIGHT },
  dimmed: { opacity: 0.5 },
  row: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
});
