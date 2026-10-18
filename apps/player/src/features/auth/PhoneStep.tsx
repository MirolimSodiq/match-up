import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { api, call } from '@/api/client';
import { useSession } from '@/auth/session';
import { colors, font, radius, space } from '@/components/theme';
import { Body, Button, ErrorText, H1, Muted, Notice } from '@/components/ui';
import { formatPhoneDigits, phoneDigits, toE164, UZ_PREFIX } from '@/features/phone';
import { LanguagePicker } from '@/features/LanguagePicker';

export interface OtpChallenge {
  phone: string;
  challengeId: string;
  resendAfter: number;
}

export function PhoneStep({ onSent }: { onSent: (c: OtpChallenge) => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { endedReason } = useSession();
  const [digits, setDigits] = useState('');
  const [touched, setTouched] = useState(false);

  const request = useMutation({
    mutationFn: (phone: string) => call(api.POST('/v1/auth/otp/request', { body: { phone, channel: 'sms' } })),
    onSuccess: (res, phone) => onSent({ phone, challengeId: res.challenge_id, resendAfter: res.resend_after }),
  });

  const valid = digits.length === 9;
  const submit = () => {
    setTouched(true);
    if (valid) request.mutate(toE164(digits));
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.lang}>
          <LanguagePicker compact />
        </View>
        <View style={styles.hero}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>MU</Text>
          </View>
          <H1>Match Up</H1>
          <Body style={styles.tagline}>{t('auth.tagline')}</Body>
        </View>

        {endedReason ? (
          <Notice tone="warning">{endedReason === 'token_reused' ? t('auth.endedTokenReused') : t('auth.endedExpired')}</Notice>
        ) : null}

        <View style={styles.form}>
          <Muted>{t('auth.phoneLabel')}</Muted>
          <View style={styles.phoneField}>
            <Text style={styles.prefix}>{UZ_PREFIX}</Text>
            <TextInput
              testID="phone-input"
              style={styles.input}
              value={formatPhoneDigits(digits)}
              onChangeText={(v) => setDigits(phoneDigits(v))}
              placeholder={t('auth.phonePlaceholder')}
              placeholderTextColor={colors.faint}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              maxLength={12}
            />
          </View>
          {touched && !valid ? <Text style={styles.error}>{t('auth.phoneInvalid')}</Text> : null}
          <ErrorText error={request.error} />
          <Button testID="send-code" title={t('auth.sendCode')} onPress={submit} loading={request.isPending} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, paddingHorizontal: space.xl, gap: space.xl },
  lang: { alignItems: 'flex-end' },
  hero: { alignItems: 'center', gap: space.sm, marginTop: space.xl },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  logoText: { color: colors.white, fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  tagline: { textAlign: 'center', color: colors.muted },
  form: { gap: space.sm },
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
  },
  prefix: { ...font.h3, marginRight: space.sm },
  input: { flex: 1, fontSize: 18, paddingVertical: 14, color: colors.text, letterSpacing: 0.5 },
  error: { color: colors.danger, fontSize: 14 },
});
