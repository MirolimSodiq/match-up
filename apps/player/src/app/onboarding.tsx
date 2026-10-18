import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { ConsentInput, SkillLevel } from '@matchup/contracts';
import { api, call } from '@/api/client';
import { useCities, useSports } from '@/api/queries';
import { useSession } from '@/auth/session';
import { colors, font, radius, space } from '@/components/theme';
import { Body, Button, Card, Chip, ErrorText, ErrorView, Footer, H2, Loading, Muted, Screen } from '@/components/ui';
import { currentLocale } from '@/i18n';

const LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced', 'pro'];
const TOTAL = 4;

/** Hujjat versiyalari — huquqiy matnlar bilan birga yangilanadi. */
const DOC_VERSIONS = { terms: 'terms-2026-10', privacy: 'privacy-2026-10' } as const;

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user, completeOnboarding } = useSession();
  const cities = useCities();
  const sports = useSports();

  const [step, setStep] = useState(1);
  // Server yangi foydalanuvchiga vaqtinchalik "Player 1234" ism beradi — uni maydonga qo'ymaymiz
  const [name, setName] = useState(/^Player \d{4}$/.test(user?.display_name ?? '') ? '' : (user?.display_name ?? ''));
  const [cityId, setCityId] = useState<number | undefined>(user?.home_city_id ?? undefined);
  const [levels, setLevels] = useState<Record<string, SkillLevel>>({});
  const [consents, setConsents] = useState({ terms: false, privacy: false, marketing: false, media: false });

  const nameValid = name.trim().length >= 2 && name.trim().length <= 40;
  const canNext =
    (step === 1 && nameValid) ||
    (step === 2 && cityId !== undefined) ||
    (step === 3 && Object.keys(levels).length > 0) ||
    (step === 4 && consents.terms && consents.privacy);

  // Tartib: consent'lar -> sport -> profil. PATCH /me (shahar) onboarding'ni yakunlaydi, shuning uchun oxirida
  const finish = useMutation({
    mutationFn: async () => {
      const list: ConsentInput[] = [
        { purpose: 'terms_of_service', granted: true, document_version: DOC_VERSIONS.terms },
        { purpose: 'privacy_policy', granted: true, document_version: DOC_VERSIONS.privacy },
        { purpose: 'marketing_sms', granted: consents.marketing },
        { purpose: 'marketing_push', granted: consents.marketing },
        { purpose: 'media_appearance', granted: consents.media },
      ];
      await call(api.PUT('/v1/me/consents', { body: { consents: list } }));
      for (const [sportCode, self_level] of Object.entries(levels)) {
        await call(api.PUT('/v1/me/sports/{sportCode}', { params: { path: { sportCode } }, body: { self_level } }));
      }
      return call(
        api.PATCH('/v1/me', { body: { display_name: name.trim(), home_city_id: cityId!, locale: currentLocale() } }),
      );
    },
    onSuccess: (me) => completeOnboarding(me),
  });

  const next = () => {
    if (!canNext) return;
    if (step < TOTAL) setStep(step + 1);
    else finish.mutate();
  };

  if (cities.isPending || sports.isPending) return <Loading />;
  if (cities.error || sports.error) {
    return <ErrorView error={cities.error ?? sports.error} onRetry={() => void Promise.all([cities.refetch(), sports.refetch()])} />;
  }

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {step > 1 ? (
          <Pressable onPress={() => setStep(step - 1)} hitSlop={12}>
            <Text style={styles.back}>‹ {t('common.back')}</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Muted>{t('onboarding.step', { step, total: TOTAL })}</Muted>
      </View>
      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${(step / TOTAL) * 100}%` }]} />
      </View>

      <Screen>
        {step === 1 ? (
          <>
            <H2>{t('onboarding.nameTitle')}</H2>
            <Muted>{t('onboarding.nameHint')}</Muted>
            <TextInput
              testID="name-input"
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('onboarding.namePlaceholder')}
              placeholderTextColor={colors.faint}
              autoFocus
              autoCapitalize="words"
              textContentType="givenName"
              maxLength={40}
              returnKeyType="next"
              onSubmitEditing={next}
            />
            {name.length > 0 && !nameValid ? <Text style={styles.error}>{t('onboarding.nameInvalid')}</Text> : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <H2>{t('onboarding.cityTitle')}</H2>
            <Muted>{t('onboarding.cityHint')}</Muted>
            {cities.data.map((c) => (
              <Card key={c.id} onPress={() => setCityId(c.id)} style={[styles.option, cityId === c.id && styles.optionSelected]}>
                <Body style={cityId === c.id ? styles.optionTextSelected : undefined}>{c.name}</Body>
              </Card>
            ))}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <H2>{t('onboarding.sportsTitle')}</H2>
            <Muted>{t('onboarding.sportsHint')}</Muted>
            {sports.data.map((s) => {
              const code = s.code ?? '';
              const selected = levels[code];
              return (
                <Card key={code}>
                  <View style={styles.sportHeader}>
                    <Text style={font.h3}>{s.name}</Text>
                    {selected ? (
                      <Pressable
                        hitSlop={8}
                        onPress={() => {
                          const { [code]: _, ...rest } = levels;
                          setLevels(rest);
                        }}
                      >
                        <Text style={styles.clear}>✕</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={styles.chips}>
                    {LEVELS.map((l) => (
                      <Chip key={l} label={t(`levels.${l}`)} selected={selected === l} onPress={() => setLevels({ ...levels, [code]: l })} />
                    ))}
                  </View>
                </Card>
              );
            })}
          </>
        ) : null}

        {step === 4 ? (
          <>
            <H2>{t('onboarding.consentsTitle')}</H2>
            <Muted>{t('onboarding.consentsHint')}</Muted>
            <Card style={{ gap: space.md }}>
              <ConsentRow
                label={t('onboarding.consentTerms')}
                tag={t('common.required')}
                value={consents.terms}
                onChange={(v) => setConsents({ ...consents, terms: v })}
              />
              <ConsentRow
                label={t('onboarding.consentPrivacy')}
                tag={t('common.required')}
                value={consents.privacy}
                onChange={(v) => setConsents({ ...consents, privacy: v })}
              />
              <ConsentRow
                label={t('onboarding.consentMarketing')}
                tag={t('common.optional')}
                value={consents.marketing}
                onChange={(v) => setConsents({ ...consents, marketing: v })}
              />
              <ConsentRow
                label={t('onboarding.consentMedia')}
                tag={t('common.optional')}
                value={consents.media}
                onChange={(v) => setConsents({ ...consents, media: v })}
              />
            </Card>
          </>
        ) : null}
        <ErrorText error={finish.error} />
      </Screen>

      <Footer>
        <Button
          testID="onboarding-next"
          title={step < TOTAL ? t('common.continue') : t('onboarding.finish')}
          onPress={next}
          disabled={!canNext}
          loading={finish.isPending}
        />
      </Footer>
    </View>
  );
}

function ConsentRow({ label, tag, value, onChange }: { label: string; tag: string; value: boolean; onChange: (v: boolean) => void }) {
  // Butun qator bosiladi — faqat kichik switch emas
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.consent}
    >
      <View style={{ flex: 1 }}>
        <Body>{label}</Body>
        <Muted>{tag}</Muted>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  back: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  progress: { height: 4, backgroundColor: colors.border, marginHorizontal: space.lg, borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    fontSize: 18,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 14 },
  option: { paddingVertical: space.lg },
  optionSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  optionTextSelected: { fontWeight: '700', color: colors.primaryDark },
  sportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clear: { color: colors.muted, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  consent: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
