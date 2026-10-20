import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AuthLayout, Button, colors, ErrorText, fontFamily, Notice, radius, space, states } from '@matchup/ui';
import { api, call } from '@/api/client';
import { useSession } from '@/auth/session';
import { formatPhoneDigits, phoneDigits, toE164, UZ_PREFIX } from '@/features/phone';
import { LanguagePicker } from '@/features/LanguagePicker';
import { SocialSignIn } from './SocialSignIn';

export interface OtpChallenge {
  phone: string;
  challengeId: string;
  resendAfter: number;
}

export function PhoneStep({ onSent }: { onSent: (c: OtpChallenge) => void }) {
  const { t } = useTranslation();
  const { endedReason } = useSession();
  const [digits, setDigits] = useState('');
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);

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
    <AuthLayout
      heroTitle={t('auth.heroTitle')}
      heroSubtitle={t('auth.tagline')}
      sheetTitle={t('auth.phoneSheetTitle')}
      topRight={<LanguagePicker variant="hero" />}
    >
      {endedReason ? (
        <Notice tone="warning" icon="shield-outline">
          {endedReason === 'token_reused' ? t('auth.endedTokenReused') : t('auth.endedExpired')}
        </Notice>
      ) : null}
      <View style={[styles.field, focused && styles.fieldFocused]}>
        <Text style={styles.prefix}>{UZ_PREFIX}</Text>
        <TextInput
          testID="phone-input"
          accessibilityLabel={t('auth.phoneLabel')}
          style={styles.input}
          value={formatPhoneDigits(digits)}
          onChangeText={(v) => setDigits(phoneDigits(v))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t('auth.phonePlaceholder')}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          returnKeyType="done"
          onSubmitEditing={submit}
          maxLength={12}
        />
      </View>
      {touched && !valid ? <Text style={styles.error}>{t('auth.phoneInvalid')}</Text> : null}
      <ErrorText error={request.error} />
      <Button testID="send-code" title={t('auth.sendCode')} onPress={submit} loading={request.isPending} />
      <SocialSignIn />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.surfaceMuted,
    paddingHorizontal: space.xl,
  },
  fieldFocused: { borderColor: states.focusBorder },
  prefix: { fontFamily: fontFamily.bold, fontSize: 18, color: colors.text, marginRight: space.sm },
  input: { flex: 1, fontFamily: fontFamily.medium, fontSize: 18, paddingVertical: 15, color: colors.text, letterSpacing: 0.6 },
  error: { fontFamily: fontFamily.medium, color: colors.danger, fontSize: 14 },
});
