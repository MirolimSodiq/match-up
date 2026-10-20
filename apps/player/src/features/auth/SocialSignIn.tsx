import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import type { SocialCredential } from '@matchup/contracts';
import { BrandMark, Button, colors, ErrorText, fontFamily, space } from '@matchup/ui';
import { api, call } from '@/api/client';
import { useSession } from '@/auth/session';
import { currentLocale } from '@/i18n';
import { deviceInfo } from '@/lib/device';
import { appleCredential, type CredentialGetter, GoogleCredential, isCancel, useAppleAvailable } from './credentials';
import { telegramCredential } from './social';

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
  const appleAvailable = useAppleAvailable();

  const login = useMutation({
    mutationFn: async (credential: SocialCredential) =>
      call(api.POST('/v1/auth/social', { body: { ...credential, device: await deviceInfo(currentLocale()) } })),
    onSuccess: (auth) => signIn(auth),
  });

  /** Credential olish (provider oynasi) -> server. Bekor qilinsa xato ko'rsatilmaydi. */
  const run = async (provider: Provider, getCredential: CredentialGetter) => {
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
        <GoogleCredential>
          {(google) => (
            <Button
              testID="google-sign-in"
              variant="secondary"
              title="Google"
              accessibilityLabel={t('auth.continueWithGoogle')}
              leading={<BrandMark brand="google" />}
              loading={pending === 'google'}
              disabled={!google.ready || busy}
              style={styles.half}
              onPress={() => void run('google', google.get)}
            />
          )}
        </GoogleCredential>
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
