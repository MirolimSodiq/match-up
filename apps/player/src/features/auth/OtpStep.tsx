import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { api, call } from '@/api/client';
import { useSession } from '@/auth/session';
import { colors, radius, space } from '@/components/theme';
import { Body, Button, ErrorText, H2 } from '@/components/ui';
import { prettyPhone } from '@/features/phone';
import { currentLocale } from '@/i18n';
import { deviceInfo } from '@/lib/device';
import type { OtpChallenge } from './PhoneStep';

const CODE_LENGTH = 6;

export function OtpStep({ challenge, onBack }: { challenge: OtpChallenge; onBack: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
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
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.link}>‹ {t('auth.changePhone')}</Text>
        </Pressable>
        <View style={{ gap: space.sm }}>
          <H2>{t('auth.otpTitle')}</H2>
          <Body style={{ color: colors.muted }}>{t('auth.otpSubtitle', { phone: prettyPhone(challenge.phone) })}</Body>
        </View>

        <View style={styles.cells}>
          {Array.from({ length: CODE_LENGTH }, (_, i) => (
            <View key={i} style={[styles.cell, i === code.length && styles.cellActive]}>
              <Text style={styles.cellText}>{code[i] ?? ''}</Text>
            </View>
          ))}
          {/* Katakchalar ustidagi shaffof input: tap, SMS'dan avtomatik to'ldirish (oneTimeCode) va paste ishlaydi */}
          <TextInput
            testID="otp-input"
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
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, paddingHorizontal: space.xl, gap: space.lg },
  link: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  cells: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.md },
  cell: {
    width: 48,
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderColor: colors.primary },
  cellText: { fontSize: 24, fontWeight: '700', color: colors.text },
  overlayInput: { ...StyleSheet.absoluteFill, opacity: 0.02, color: 'transparent', fontSize: 1 },
});
