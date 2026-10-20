import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DataSubjectRequest } from '@matchup/contracts';
import {
  Badge,
  BottomSheet,
  Button,
  Card,
  colors,
  ErrorText,
  ErrorView,
  type IconName,
  ListRow,
  Loading,
  Notice,
  space,
  type Tone,
  type,
  useToast,
} from '@matchup/ui';
import { api, call } from '@/api/client';
import { isApiError } from '@/api/errors';
import { isOpenRequest, openErasure, qk, useDataRequests } from '@/api/queries';
import { SubScreen } from '@/features/SubScreen';
import { shareDataExport } from '@/features/privacy/dataExport';
import { currentLocale } from '@/i18n';
import { deviceTimeZone, formatDateTime, formatDay } from '@/lib/datetime';

/**
 * Profil -> Maxfiylik: shaxsiy ma'lumotlar eksporti (GDPR Art. 15/20) va akkauntni o'chirish (Art. 17,
 * 30 kunlik grace bilan). Holat `GET /v1/me/data-requests` dan; eksport tayyorlanayotganda polling.
 */
export default function PrivacyScreen() {
  const { t } = useTranslation();
  const requests = useDataRequests();

  return (
    <SubScreen title={t('privacy.title')} subtitle={t('privacy.subtitle')}>
      {requests.isPending ? (
        <Loading />
      ) : requests.error ? (
        <ErrorView error={requests.error} onRetry={() => void requests.refetch()} />
      ) : (
        <>
          <ExportSection items={requests.data.items} />
          <ErasureSection items={requests.data.items} />
        </>
      )}
    </SubScreen>
  );
}

/** Yangi/yangilangan so'rovni ro'yxat boshiga qo'yadi (server tartibi: yangisi birinchi). */
function upsertRequest(queryClient: QueryClient, request: DataSubjectRequest) {
  queryClient.setQueryData<{ items: DataSubjectRequest[] }>(qk.dataRequests, (old) =>
    old ? { items: [request, ...old.items.filter((r) => r.id !== request.id)] } : old,
  );
}

type ExportState = 'none' | 'preparing' | 'ready' | 'expired' | 'failed';

const EXPORT_BADGE: Record<Exclude<ExportState, 'none'>, { tone: Tone; icon: IconName }> = {
  preparing: { tone: 'warning', icon: 'hourglass-outline' },
  ready: { tone: 'success', icon: 'checkmark-circle' },
  expired: { tone: 'neutral', icon: 'time-outline' },
  failed: { tone: 'danger', icon: 'alert-circle' },
};

function exportState(last: DataSubjectRequest | undefined): ExportState {
  if (!last) return 'none';
  if (isOpenRequest(last)) return 'preparing';
  if (last.status === 'completed') return last.download_url ? 'ready' : 'expired';
  if (last.status === 'rejected') return 'failed';
  return 'none';
}

function ExportSection({ items }: { items: DataSubjectRequest[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const last = items.find((r) => r.type === 'export');
  const state = exportState(last);

  const request = useMutation({
    mutationFn: () => call(api.POST('/v1/me/data-export')),
    onSuccess: (created) => upsertRequest(queryClient, created),
  });

  const download = useMutation({
    mutationFn: (r: DataSubjectRequest) => shareDataExport(r, t('privacy.export.shareTitle')),
    // Muddat o'tgan / fayl o'chirilgan bo'lsa — holatni serverdan yangilaymiz
    onError: (err) => {
      if (isApiError(err, 'EXPORT_EXPIRED') || isApiError(err, 'NOT_FOUND')) void queryClient.invalidateQueries({ queryKey: qk.dataRequests });
    },
  });

  const start = () => {
    download.reset();
    request.mutate();
  };

  return (
    <Card tone="white" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name="document-text-outline" size={20} color={colors.text} />
        </View>
        <Text style={[type.section, styles.flex]}>{t('privacy.export.title')}</Text>
        {state !== 'none' ? <Badge label={t(`privacy.export.state.${state}`)} {...EXPORT_BADGE[state]} /> : null}
      </View>
      <Text style={type.body}>{t('privacy.export.body')}</Text>

      {state === 'preparing' ? (
        <View style={styles.progress} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.text} />
          <Text style={[type.small, styles.flex]}>{t('privacy.export.preparing')}</Text>
        </View>
      ) : null}
      {state === 'ready' && last?.expires_at ? (
        <Text style={type.small}>
          {t('privacy.export.availableUntil', { date: formatDateTime(last.expires_at, deviceTimeZone(), currentLocale()) })}
        </Text>
      ) : null}
      {state === 'expired' ? <Text style={type.small}>{t('privacy.export.expired')}</Text> : null}
      {state === 'failed' ? <Notice tone="danger" icon="alert-circle-outline">{t('privacy.export.failed')}</Notice> : null}

      <ErrorText error={request.error ?? download.error} />

      {state === 'ready' && last ? (
        <>
          <Button
            testID="download-export"
            title={t('privacy.export.download')}
            icon="download-outline"
            loading={download.isPending}
            onPress={() => download.mutate(last)}
          />
          <Button title={t('privacy.export.again')} variant="ghost" loading={request.isPending} onPress={start} />
        </>
      ) : state !== 'preparing' ? (
        <Button testID="request-export" title={t('privacy.export.request')} variant="secondary" loading={request.isPending} onPress={start} />
      ) : null}
    </Card>
  );
}

function ErasureSection({ items }: { items: DataSubjectRequest[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pending = openErasure(items);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const erase = useMutation({
    mutationFn: () => call(api.DELETE('/v1/me')),
    onSuccess: (created) => {
      upsertRequest(queryClient, created);
      setSheetOpen(false);
      toast({ message: t('privacy.erase.requestedToast'), icon: 'checkmark-circle' });
    },
    // ERASURE_PENDING: so'rov boshqa qurilmadan yuborilgan — ro'yxatni yangilaymiz
    onError: () => void queryClient.invalidateQueries({ queryKey: qk.dataRequests }),
  });

  const cancel = useMutation({
    mutationFn: () => call(api.DELETE('/v1/me/erasure-request')),
    onSuccess: (cancelled) => {
      upsertRequest(queryClient, cancelled);
      toast({ message: t('privacy.erase.cancelledToast'), icon: 'checkmark-circle' });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: qk.dataRequests }),
  });

  const openSheet = () => {
    erase.reset();
    setUnderstood(false);
    setSheetOpen(true);
  };

  return (
    <>
      {pending ? (
        <Card tone="white" style={[styles.card, styles.pendingCard]}>
          <View style={styles.head}>
            <View style={[styles.icon, styles.iconDanger]}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </View>
            <Text style={[type.section, styles.flex]}>{t('privacy.erase.pendingTitle')}</Text>
          </View>
          <Text testID="erasure-due" style={type.body}>
            {t(pending.blocked_reasons?.length ? 'privacy.erase.blockedBody' : 'privacy.erase.pendingBody', {
              date: formatDay(pending.due_at, deviceTimeZone(), currentLocale()),
            })}
          </Text>
          {pending.blocked_reasons?.map((r) => (
            <Notice key={`${r.code}-${r.match_code ?? ''}`} tone="danger" icon={r.code === 'wallet_balance' ? 'wallet-outline' : 'football-outline'}>
              {r.message}
            </Notice>
          ))}
          <ErrorText error={cancel.error} />
          <Button
            testID="cancel-erasure"
            title={t('privacy.erase.cancel')}
            icon="arrow-undo-outline"
            loading={cancel.isPending}
            onPress={() => cancel.mutate()}
          />
        </Card>
      ) : (
        <Card tone="white" style={styles.card}>
          <View style={styles.head}>
            <View style={[styles.icon, styles.iconDanger]}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </View>
            <Text style={[type.section, styles.flex]}>{t('privacy.erase.title')}</Text>
          </View>
          <Text style={type.body}>{t('privacy.erase.body')}</Text>
          <Button testID="erase-account" title={t('privacy.erase.start')} variant="danger" onPress={openSheet} />
        </Card>
      )}

      <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title={t('privacy.erase.confirmTitle')}>
        <View style={styles.consequences}>
          <Consequence icon="time-outline" text={t('privacy.erase.graceNote')} />
          <Consequence icon="person-remove-outline" text={t('privacy.erase.deletesNote')} />
          <Consequence icon="calendar-outline" text={t('privacy.erase.bookingsNote')} />
          <Consequence icon="document-lock-outline" text={t('privacy.erase.keepsNote')} />
        </View>
        <ListRow
          title={t('privacy.erase.understand')}
          toggle={{ value: understood, onChange: setUnderstood }}
        />
        <ErrorText error={erase.error} />
        <Button
          testID="confirm-erase"
          title={t('privacy.erase.confirm')}
          variant="danger"
          disabled={!understood}
          loading={erase.isPending}
          onPress={() => erase.mutate()}
        />
        <Button title={t('privacy.erase.keep')} variant="secondary" onPress={() => setSheetOpen(false)} />
      </BottomSheet>
    </>
  );
}

function Consequence({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.consequence}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={[type.small, styles.flex, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.md },
  pendingCard: { borderColor: colors.danger },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDanger: { backgroundColor: colors.dangerSoft },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  consequences: { gap: space.md },
  consequence: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
