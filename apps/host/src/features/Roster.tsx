import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar, bibFallback, Button, colors, fontFamily, type IconName, radius, space, states, type, useToast, useUI } from '@matchup/ui';
import type { components } from '@matchup/contracts';
import { api, call } from '@/api/client';
import { ApiError } from '@/api/errors';
import { qk, type RosterData } from '@/api/queries';
import { offlineStore } from '@/offline/store';
import { useNow } from '@/lib/time';
import type { ParticipantStatus, ParticipantView } from '@/offline/core';
import { useNetwork } from '@/offline/network';
import type { MatchSyncState } from '@/offline/store';

type Side = NonNullable<components['schemas']['Roster']['sides']>[number];

const STATUS_STYLE: Record<ParticipantStatus, { bg: string; fg: string; icon: IconName }> = {
  checked_in: { bg: colors.successSoft, fg: colors.success, icon: 'checkmark-circle' },
  confirmed: { bg: colors.surfaceMuted, fg: colors.textMuted, icon: 'time-outline' },
  no_show: { bg: colors.dangerSoft, fg: colors.danger, icon: 'close-circle' },
};

export const bibColor = (side: Side | undefined, sideNo: number | null | undefined) =>
  side?.bib_color ?? (sideNo ? bibFallback[(sideNo - 1) % bibFallback.length]! : colors.borderStrong);

/** Jamoa formasi rangidagi kichik doira. */
export function BibDot({ color, size = 12 }: { color: string; size?: number }) {
  return <View style={[styles.bib, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />;
}

/** Ism bo'yicha check-in ro'yxati qatori. */
export function ParticipantRow({ p, side, onPress }: { p: ParticipantView; side?: Side; onPress: () => void }) {
  const { t } = useTranslation();
  const s = STATUS_STYLE[p.status];
  const meta = [p.level ? t(`match.level.${p.level}`) : null, p.is_guest ? t('match.guest') : null].filter(Boolean).join(' · ');
  return (
    <Pressable
      testID={`participant-${p.display_name}`}
      accessibilityRole="button"
      accessibilityLabel={`${p.display_name}, ${t(`match.participant.${p.status}`)}${p.pending ? `, ${t('match.pending')}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: states.pressedOpacity }]}
    >
      <Avatar name={p.display_name} size={42} highlight={p.status === 'checked_in'} />
      <View style={styles.flex}>
        <View style={styles.nameRow}>
          <Text style={[type.bodyStrong, styles.flexShrink]} numberOfLines={1}>
            {p.display_name}
          </Text>
          {p.bib_number ? <Text style={styles.bibNumber}>#{p.bib_number}</Text> : null}
        </View>
        <View style={styles.metaRow}>
          {p.side_no ? <BibDot color={bibColor(side, p.side_no)} /> : null}
          {side?.label ? <Text style={type.caption}>{side.label}</Text> : null}
          {meta ? <Text style={type.caption}>{side?.label ? `· ${meta}` : meta}</Text> : null}
        </View>
        {p.rejectedReason ? (
          <Text style={[type.caption, { color: colors.danger }]} numberOfLines={2}>
            {t('match.rejected')}: {reasonText(t, p.rejectedReason)}
          </Text>
        ) : null}
      </View>
      {p.pending ? <Ionicons name="cloud-upload-outline" size={18} color={colors.warning} accessibilityLabel={t('match.pending')} /> : null}
      <View style={[styles.status, { backgroundColor: s.bg }]}>
        <Ionicons name={s.icon} size={14} color={s.fg} />
        <Text style={[styles.statusText, { color: s.fg }]}>{t(`match.participant.${p.status}`)}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Bib raqami (AI-Cam: videoda o'yinchini tanish uchun). Internet kerak — server raqam takrorlanmasligini
 * tekshiradi (`BIB_TAKEN`); muvaffaqiyatda roster keshi ham yangilanadi.
 */
export function BibEditor({ matchId, p }: { matchId: string; p: ParticipantView }) {
  const { t } = useTranslation();
  const { formatError } = useUI();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(p.bib_number ? String(p.bib_number) : '');
  // Varaq ochilgandagi `p` eskiradi — oxirgi saqlangan qiymat bilan solishtiramiz
  const [saved, setSaved] = useState<number | null>(p.bib_number ?? null);
  const parsed = /^\d{1,2}$/.test(value) && Number(value) >= 1 ? Number(value) : null;

  const save = useMutation({
    mutationFn: (bib: number | null) =>
      call(
        api.PATCH('/v1/host/matches/{matchId}/participants/{participantId}', {
          params: { path: { matchId, participantId: p.participant_id } },
          body: { bib_number: bib },
        }),
      ),
    onSuccess: (_r, bib) => {
      offlineStore.patchParticipant(matchId, p.participant_id, { bib_number: bib });
      queryClient.setQueryData<RosterData>(qk.roster(matchId), (old) =>
        old
          ? { ...old, roster: { ...old.roster, participants: old.roster.participants?.map((x) => (x.participant_id === p.participant_id ? { ...x, bib_number: bib } : x)) } }
          : old,
      );
      setSaved(bib);
      if (bib === null) setValue('');
      toast({ message: t('match.bibSaved'), icon: 'shirt' });
    },
    onError: (err) => toast({ message: formatError(err), icon: 'alert-circle' }),
  });

  return (
    <View style={styles.bibEditor}>
      <Text style={type.bodyStrong}>{t('match.bib')}</Text>
      <Text style={type.caption}>{t('match.bibHint')}</Text>
      <View style={styles.bibRow}>
        <TextInput
          testID="bib-input"
          value={value}
          onChangeText={(v) => setValue(v.replace(/\D/g, '').slice(0, 2))}
          keyboardType="number-pad"
          placeholder="7"
          placeholderTextColor={colors.textMuted}
          style={styles.bibInput}
          accessibilityLabel={t('match.bib')}
          maxLength={2}
        />
        <Button
          testID="bib-save"
          title={t('match.bibSave')}
          style={styles.flex}
          loading={save.isPending}
          disabled={parsed === null || parsed === saved}
          onPress={() => parsed !== null && save.mutate(parsed)}
        />
        {saved ? <Button title={t('match.bibClear')} variant="secondary" disabled={save.isPending} onPress={() => save.mutate(null)} /> : null}
      </View>
    </View>
  );
}

export function reasonText(t: (k: string, o?: Record<string, unknown>) => string, reason: string | null | undefined): string {
  if (!reason) return t('sync.state.rejected');
  const key = `sync.reasons.${reason}`;
  const known = ['TICKET_EXPIRED', 'NOT_ON_ROSTER', 'INVALID_SIGNATURE', 'PARTICIPANT_REQUIRED'];
  return known.includes(reason) ? t(key) : t('sync.reasons.unknown', { reason });
}

/**
 * Sinxron holati: internet yo'q / navbatda / yuborilmoqda / xato / hammasi serverda.
 * Bosilsa — jurnal (har event natijasi: qabul, takror, rad + sabab).
 */
export function SyncBanner({ sync, pending, onPress, onSyncNow }: { sync: MatchSyncState; pending: number; onPress: () => void; onSyncNow: () => void }) {
  const { t } = useTranslation();
  const { formatError } = useUI();
  const { online } = useNetwork();
  const now = useNow(1000);

  let tone: 'warning' | 'neutral' | 'danger' | 'success' = 'success';
  let icon: IconName = 'cloud-done-outline';
  let title = t('sync.synced');
  let detail: string | undefined;

  if (sync.status === 'syncing') {
    tone = 'neutral';
    title = t('sync.syncing');
  } else if (pending > 0 && (!online || sync.status === 'offline')) {
    tone = 'warning';
    icon = 'cloud-offline-outline';
    title = t('sync.queued', { count: pending });
    detail = sync.nextRetryAt && online ? t('sync.retryIn', { seconds: Math.max(0, Math.ceil((sync.nextRetryAt - now) / 1000)) }) : t('sync.offline');
  } else if (sync.status === 'error' && pending > 0) {
    tone = 'danger';
    icon = 'warning-outline';
    title = t('sync.queued', { count: pending });
    detail = t('sync.error', { message: formatError(new ApiError({ status: 0, code: sync.error ?? 'UNKNOWN' })) });
  } else if (pending > 0) {
    tone = 'neutral';
    icon = 'cloud-upload-outline';
    title = t('sync.queued', { count: pending });
  } else if (sync.lastResult) {
    detail = t('sync.lastResult', sync.lastResult);
  }

  const palette = {
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    neutral: { bg: colors.surfaceMuted, fg: colors.text },
  }[tone];

  return (
    <Pressable
      testID="sync-banner"
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail ?? ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.banner, { backgroundColor: palette.bg }, pressed && { opacity: states.pressedOpacity }]}
    >
      {sync.status === 'syncing' ? <ActivityIndicator color={palette.fg} /> : <Ionicons name={icon} size={20} color={palette.fg} />}
      <View style={styles.flex}>
        <Text style={[type.smallStrong, { color: palette.fg }]}>{title}</Text>
        {detail ? <Text style={[type.caption, { color: palette.fg }]}>{detail}</Text> : null}
      </View>
      {pending > 0 && sync.status !== 'syncing' ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onSyncNow} style={[styles.syncNow, { borderColor: palette.fg }]}>
          <Text style={[styles.syncNowText, { color: palette.fg }]}>{t('sync.syncNow')}</Text>
        </Pressable>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={palette.fg} />
      )}
    </Pressable>
  );
}

/** Kelganlar progress chizig'i. */
export function CheckinProgress({ checked, total }: { checked: number; total: number }) {
  const ratio = total ? Math.min(checked / total, 1) : 0;
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: checked }}>
      <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
    </View>
  );
}


const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, minHeight: 60 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bibNumber: { fontFamily: fontFamily.display, fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  bibEditor: { gap: space.xs },
  bibRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  bibInput: {
    width: 64,
    textAlign: 'center',
    fontFamily: fontFamily.display,
    fontSize: 22,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  bib: { borderWidth: 1, borderColor: colors.border },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  statusText: { fontFamily: fontFamily.semibold, fontSize: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.md, padding: space.md },
  syncNow: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  syncNowText: { fontFamily: fontFamily.semibold, fontSize: 13 },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.success },
});
