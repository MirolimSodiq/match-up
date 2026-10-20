import { type ReactNode, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AuthIdentity, SocialCredential, SocialProvider } from '@matchup/contracts';
import { BottomSheet, BrandMark, Button, Card, colors, Divider, ErrorText, ErrorView, fontFamily, Loading, Notice, space, type, useToast } from '@matchup/ui';
import { api, call } from '@/api/client';
import { isApiError } from '@/api/errors';
import { qk, useIdentities } from '@/api/queries';
import { appleCredential, type CredentialGetter, GoogleCredential, isCancel, useAppleAvailable } from '@/features/auth/credentials';
import { telegramCredential } from '@/features/auth/social';
import { prettyPhone } from '@/features/phone';
import { SubScreen } from '@/features/SubScreen';
import { currentLocale } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { deviceTimeZone, formatDateTime } from '@/lib/datetime';

const NAMES: Record<SocialProvider, string> = { apple: 'Apple', google: 'Google', telegram: 'Telegram' };

/**
 * Profil -> Kirish usullari: telefon va social identity'lar (`GET /v1/me/identities`), bog'lash
 * (`POST /v1/me/identities` — credential login ekranidagi kabi olinadi) va uzish (`DELETE .../{provider}`).
 */
export default function SignInMethodsScreen() {
  const { t } = useTranslation();
  const identities = useIdentities();

  return (
    <SubScreen title={t('identities.title')} subtitle={t('identities.subtitle')}>
      {identities.isPending ? (
        <Loading />
      ) : identities.error ? (
        <ErrorView error={identities.error} onRetry={() => void identities.refetch()} />
      ) : (
        <IdentityList list={identities.data} />
      )}
    </SubScreen>
  );
}

function IdentityList({ list }: { list: AuthIdentity[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const appleAvailable = useAppleAvailable();
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [linkError, setLinkError] = useState<{ provider: SocialProvider; error: unknown }>();
  // Sheet yopilish animatsiyasida ham provider nomi ko'rinib tursin — alohida `open`
  const [target, setTarget] = useState<SocialProvider>('google');
  const [sheetOpen, setSheetOpen] = useState(false);

  const linked = (p: AuthIdentity['provider']) => list.find((i) => i.provider === p);

  const link = useMutation({
    mutationFn: (credential: SocialCredential) => call(api.POST('/v1/me/identities', { body: credential })),
    onSuccess: (fresh) => queryClient.setQueryData(qk.identities, fresh),
    // ALREADY_EXISTS: ro'yxat eskirgan (boshqa qurilmada bog'langan) — yangilaymiz
    onError: () => void queryClient.invalidateQueries({ queryKey: qk.identities }),
  });

  const unlink = useMutation({
    mutationFn: (provider: SocialProvider) =>
      call(api.DELETE('/v1/me/identities/{provider}', { params: { path: { provider } } })),
    onSuccess: (_, provider) => {
      queryClient.setQueryData<AuthIdentity[]>(qk.identities, (old) => old?.filter((i) => i.provider !== provider));
      setSheetOpen(false);
      toast({ message: t('identities.unlinkedToast', { provider: NAMES[provider] }), icon: 'checkmark-circle' });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.identities }),
  });

  /** Provider oynasi -> credential -> server. Oyna yopilsa xato ko'rsatilmaydi. */
  const run = async (provider: SocialProvider, getCredential: CredentialGetter) => {
    setLinkError(undefined);
    setPending(provider);
    try {
      const credential = await getCredential();
      if (!credential) return;
      await link.mutateAsync(credential);
      toast({ message: t('identities.linkedToast', { provider: NAMES[provider] }), icon: 'checkmark-circle' });
    } catch (err) {
      if (!isCancel(err)) setLinkError({ provider, error: err });
    } finally {
      setPending(null);
    }
  };

  const askUnlink = (provider: SocialProvider) => {
    setLinkError(undefined);
    unlink.reset();
    setTarget(provider);
    setSheetOpen(true);
  };

  const busy = pending !== null;

  /** Bog'langan bo'lsa "Uzish", aks holda "Bog'lash" (Google — expo-auth-session hook'i orqali). */
  const action = (provider: SocialProvider, getCredential?: CredentialGetter, ready = true) => {
    if (linked(provider)) {
      return (
        <Button
          testID={`unlink-${provider}`}
          title={t('identities.unlink')}
          accessibilityLabel={t('identities.unlinkA11y', { provider: NAMES[provider] })}
          variant="secondary"
          disabled={busy}
          style={styles.action}
          onPress={() => askUnlink(provider)}
        />
      );
    }
    return (
      <Button
        testID={`link-${provider}`}
        title={t('identities.link')}
        accessibilityLabel={t('identities.linkA11y', { provider: NAMES[provider] })}
        loading={pending === provider}
        disabled={!ready || (busy && pending !== provider)}
        style={styles.action}
        onPress={() => getCredential && void run(provider, getCredential)}
      />
    );
  };

  const phone = linked('phone');
  // Apple faqat iOS'da bog'lanadi; boshqa platformada bog'langan bo'lsa ham ko'rinadi (uzish uchun)
  const showApple = appleAvailable || !!linked('apple');

  return (
    <>
      <Card tone="white" style={styles.list}>
        <MethodRow
          mark={<Ionicons name="call" size={20} color={colors.text} />}
          name={t('identities.phone')}
          identity={phone}
          detail={phone ? prettyPhone(phone.label) : t('identities.notLinked')}
        />
        {showApple ? (
          <>
            <Divider />
            <MethodRow
              mark={<Ionicons name="logo-apple" size={22} color={colors.text} />}
              name={NAMES.apple}
              identity={linked('apple')}
              action={action('apple', appleCredential)}
            />
          </>
        ) : null}
        <Divider />
        <GoogleCredential>
          {(google) => (
            <MethodRow
              mark={<BrandMark brand="google" />}
              name={NAMES.google}
              identity={linked('google')}
              action={action('google', google.get, google.ready)}
            />
          )}
        </GoogleCredential>
        <Divider />
        <MethodRow
          mark={<BrandMark brand="telegram" size={22} />}
          name={NAMES.telegram}
          identity={linked('telegram')}
          action={action('telegram', telegramCredential)}
        />
      </Card>

      {linkError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {linkErrorText(t, linkError.error, linkError.provider)}
        </Text>
      ) : null}

      <Notice icon="information-circle-outline">{t('identities.hint')}</Notice>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t('identities.unlinkTitle')}
        subtitle={t('identities.unlinkBody', { provider: NAMES[target] })}
      >
        <ErrorText error={unlink.error} />
        <Button
          testID="confirm-unlink"
          title={t('identities.unlinkConfirm', { provider: NAMES[target] })}
          variant="danger"
          loading={unlink.isPending}
          onPress={() => unlink.mutate(target)}
        />
        <Button title={t('identities.keep')} variant="secondary" onPress={() => setSheetOpen(false)} />
      </BottomSheet>
    </>
  );
}

function MethodRow({
  mark,
  name,
  identity,
  detail,
  action,
}: {
  mark: ReactNode;
  name: string;
  identity: AuthIdentity | undefined;
  /** Berilmasa: bog'langan — label (email / @username), aks holda "Bog'lanmagan". */
  detail?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  const text = detail ?? (identity ? (identity.label ?? t('identities.linked')) : t('identities.notLinked'));
  return (
    <View style={styles.row} accessible={!action} accessibilityLabel={!action ? `${name}, ${text}` : undefined}>
      <View style={[styles.mark, identity ? styles.markLinked : null]}>{mark}</View>
      <View style={styles.flex}>
        <View style={styles.nameRow}>
          <Text style={type.bodyStrong}>{name}</Text>
          {identity ? <Ionicons name="checkmark-circle" size={16} color={colors.success} accessibilityLabel={t('identities.linked')} /> : null}
        </View>
        <Text style={type.small} numberOfLines={1}>
          {text}
        </Text>
        {identity?.last_used_at ? (
          <Text style={type.caption}>
            {t('identities.lastUsed', { date: formatDateTime(identity.last_used_at, deviceTimeZone(), currentLocale()) })}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/** `ALREADY_EXISTS` bu yerda "shu provider'dan boshqa akkaunt bog'langan" degani — umumiy matn emas. */
function linkErrorText(t: TFunction, err: unknown, provider: SocialProvider): string {
  if (isApiError(err, 'ALREADY_EXISTS')) return t('identities.alreadyLinked', { provider: NAMES[provider] });
  return errorMessage(t, err);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingVertical: space.xs, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  mark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markLinked: { backgroundColor: colors.successSoft },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Yuklanishda (spinner) kenglik o'zgarmasin
  action: { minHeight: 38, minWidth: 96, paddingHorizontal: space.md },
  error: { fontFamily: fontFamily.medium, color: colors.danger, fontSize: 14 },
});
