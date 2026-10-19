import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AuthLayout, Button, colors, ErrorText, fontFamily, IconButton, radius, space, states } from '@matchup/ui';
import { api, call } from '@/api/client';
import { useSession } from '@/auth/session';
import { prettyPhone } from '@/lib/phone';
import { LanguagePicker } from '@/features/LanguagePicker';
import { currentLocale } from '@/i18n';
import { deviceInfo } from '@/lib/device';
import type { OtpChallenge } from './PhoneStep';

const CODE_LENGTH = 6;

export function OtpStep({ challenge, onBack }: { challenge: OtpChallenge; onBack: () => void }) {
  const { t } = useTranslation();
  const { signIn } = useSession();
  const [challengeId, setChallengeId] = useState(challenge.challengeId);
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(challenge.resendAfter);

  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => setLeft((s) => Math.max(s - 1, 0)), 1000);
    return () => clearInterval(id);
  }, [left]);

  const verify = useMutation({
    mutationFn: async (value: string) =>
      call(
        api.POST('/v1/auth/otp/verify', {
          body: { challenge_id: challengeId, code: value, device: await deviceInfo(currentLocale()) },
        }),
      ),
    onSuccess: (auth) => signIn(auth),
    onError: () => setCode(''),
  });

  const resend = useMutation({
    mutationFn: () => call(api.POST('/v1/auth/otp/request', { body: { phone: challenge.phone, channel: 'sms' } })),
    onSuccess: (res) => {
      setChallengeId(res.challenge_id);
      setLeft(res.resend_after);
      verify.reset();
    },
  });

  const onChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH && !verify.isPending) verify.mutate(digits);
  };

  return (
    <AuthLayout
      heroTitle={t('auth.heroTitle')}
      sheetTitle={t('auth.otpTitle')}
      sheetSubtitle={t('auth.otpSubtitle', { phone: prettyPhone(challenge.phone) })}
      topLeft={<IconButton icon="chevron-back" label={t('auth.changePhone')} variant="glass" onPress={onBack} />}
      topRight={<LanguagePicker variant="hero" />}
    >
      <View style={styles.cells}>
        {Array.from({ length: CODE_LENGTH }, (_, i) => (
          <View key={i} style={[styles.cell, i < code.length && styles.cellFilled, i === code.length && styles.cellActive]}>
            <Text style={styles.cellText}>{code[i] ?? ''}</Text>
          </View>
        ))}
        {/* Katakchalar ustidagi shaffof input: tap, SMS'dan avtomatik to'ldirish (oneTimeCode) va paste ishlaydi */}
        <TextInput
          testID="otp-input"
          accessibilityLabel={t('auth.otpTitle')}
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          autoFocus
          caretHidden
          maxLength={CODE_LENGTH}
          style={styles.overlayInput}
        />
      </View>

      <ErrorText error={verify.error ?? resend.error} />
      <Button
        testID="verify"
        title={t('auth.verify')}
        onPress={() => verify.mutate(code)}
        disabled={code.length !== CODE_LENGTH}
        loading={verify.isPending}
      />
      <Button
        variant="ghost"
        title={left > 0 ? t('auth.resendIn', { seconds: left }) : t('auth.resend')}
        disabled={left > 0}
        loading={resend.isPending}
        onPress={() => resend.mutate()}
      />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  cells: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  cell: {
    flex: 1,
    maxWidth: 54,
    height: 60,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.surfaceMuted,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  cellActive: { backgroundColor: colors.surface, borderColor: states.focusBorder },
  cellText: { fontFamily: fontFamily.display, fontSize: 28, color: colors.text },
  overlayInput: { ...StyleSheet.absoluteFill, opacity: 0.02, color: 'transparent', fontSize: 1 },
});
