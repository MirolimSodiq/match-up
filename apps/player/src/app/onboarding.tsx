import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { ConsentInput, SkillLevel } from '@matchup/contracts';
import { Button, Card, Chip, colors, Divider, ErrorText, ErrorView, fontFamily, Footer, IconButton, ListRow, Loading, radius, ScreenGlow, space, sportColors, SportIcon, type } from '@matchup/ui';
import { api, call } from '@/api/client';
import { useCities, useSports } from '@/api/queries';
import { useSession } from '@/auth/session';
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
    <View style={styles.flex}>
      {/* Login hero'sidan (oq status bar) keyin — och fon */}
      <StatusBar style="dark" />
      <ScreenGlow />
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.headerSide}>
          {step > 1 ? <IconButton icon="chevron-back" label={t('common.back')} variant="light" onPress={() => setStep(step - 1)} /> : null}
        </View>
        <View
          style={styles.progress}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('onboarding.step', { step, total: TOTAL })}
          accessibilityValue={{ min: 1, max: TOTAL, now: step }}
        >
          {Array.from({ length: TOTAL }, (_, i) => (
            <View key={i} style={[styles.progressBar, i < step && styles.progressBarDone]} />
          ))}
        </View>
        <Text style={type.caption} numberOfLines={1}>
          {t('onboarding.step', { step, total: TOTAL })}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 1 ? (
          <>
            <StepTitle title={t('onboarding.nameTitle')} hint={t('onboarding.nameHint')} />
            <TextInput
              testID="name-input"
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('onboarding.namePlaceholder')}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.primary}
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
            <StepTitle title={t('onboarding.cityTitle')} hint={t('onboarding.cityHint')} />
            <Card tone="white" style={styles.list}>
              {cities.data.map((c, i) => (
                <View key={c.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListRow
                    icon="business-outline"
                    title={c.name ?? ''}
                    accessory={cityId === c.id ? 'check' : 'radio'}
                    onPress={() => setCityId(c.id)}
                  />
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <StepTitle title={t('onboarding.sportsTitle')} hint={t('onboarding.sportsHint')} />
            {sports.data.map((s) => {
              const code = s.code ?? '';
              const selected = levels[code];
              const sc = sportColors(code);
              return (
                <Card key={code} tone="white" style={styles.sport}>
                  <View style={styles.sportHeader}>
                    <View style={[styles.sportIcon, { backgroundColor: sc.base }]}>
                      <SportIcon sport={code} size={20} color={colors.onSport} />
                    </View>
                    <Text style={[type.h3, styles.flexShrink]}>{s.name}</Text>
                    {selected ? (
                      <IconButton
                        icon="close"
                        label={t('common.close')}
                        variant="muted"
                        size={32}
                        onPress={() => {
                          const { [code]: _, ...rest } = levels;
                          setLevels(rest);
                        }}
                      />
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
            <StepTitle title={t('onboarding.consentsTitle')} hint={t('onboarding.consentsHint')} />
            <Card tone="white" style={styles.list}>
              <ListRow
                title={t('onboarding.consentTerms')}
                subtitle={t('common.required')}
                toggle={{ value: consents.terms, onChange: (v) => setConsents({ ...consents, terms: v }) }}
              />
              <Divider />
              <ListRow
                title={t('onboarding.consentPrivacy')}
                subtitle={t('common.required')}
                toggle={{ value: consents.privacy, onChange: (v) => setConsents({ ...consents, privacy: v }) }}
              />
              <Divider />
              <ListRow
                title={t('onboarding.consentMarketing')}
                subtitle={t('common.optional')}
                toggle={{ value: consents.marketing, onChange: (v) => setConsents({ ...consents, marketing: v }) }}
              />
              <Divider />
              <ListRow
                title={t('onboarding.consentMedia')}
                subtitle={t('common.optional')}
                toggle={{ value: consents.media, onChange: (v) => setConsents({ ...consents, media: v }) }}
              />
            </Card>
          </>
        ) : null}
        <ErrorText error={finish.error} />
      </ScrollView>

      <Footer transparent>
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

function StepTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <View style={styles.stepTitle}>
      <Text style={type.display} accessibilityRole="header">
        {title}
      </Text>
      <Text style={type.small}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flexShrink: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  headerSide: { width: 40 },
  scroll: { flex: 1 },
  progress: { flex: 1, flexDirection: 'row', gap: 6 },
  progressBar: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  progressBarDone: { backgroundColor: colors.primary },
  content: { padding: space.lg, gap: space.md },
  stepTitle: { gap: space.xs, marginBottom: space.sm },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.xl,
    paddingVertical: 15,
    fontFamily: fontFamily.medium,
    fontSize: 18,
    color: colors.text,
  },
  error: { fontFamily: fontFamily.medium, color: colors.danger, fontSize: 14 },
  list: { paddingVertical: space.xs, gap: 0 },
  sport: { gap: space.md },
  sportHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sportIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
