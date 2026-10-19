import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Chip,
  colors,
  Divider,
  ErrorText,
  fontFamily,
  Footer,
  IconButton,
  Notice,
  radius,
  readableOn,
  SheetScreen,
  space,
  type,
  useToast,
} from '@matchup/ui';
import { api, call } from '@/api/client';
import { ApiError } from '@/api/errors';
import { formatTime } from '@/lib/datetime';
import { useNow } from '@/lib/time';
import { bibColor } from '@/features/Roster';
import { useMatchControl } from '@/features/useMatchControl';
import { syncMatch } from '@/offline/sync';

type IncidentType = 'injury' | 'misconduct' | 'venue_issue' | 'other';
const INCIDENT_TYPES: IncidentType[] = ['injury', 'misconduct', 'venue_issue', 'other'];

interface Incident {
  key: number;
  type: IncidentType;
  participant_id: string | null;
  note: string;
}

export default function CompleteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const ctl = useMatchControl(id);
  const now = useNow(15_000);
  const sides = ctl.sides.filter((s): s is typeof s & { side_no: number } => typeof s.side_no === 'number');
  const [scores, setScores] = useState<Record<number, number>>({});
  const [mvp, setMvp] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [draft, setDraft] = useState<Omit<Incident, 'key'>>({ type: 'injury', participant_id: null, note: '' });

  const arrived = useMemo(() => ctl.participants.filter((p) => p.status === 'checked_in'), [ctl.participants]);
  const nameOf = (pid: string | null) => arrived.find((p) => p.participant_id === pid)?.display_name;
  const started = ctl.summary ? new Date(ctl.summary.starts_at).getTime() <= now : false;
  const blocked = ctl.pendingCount > 0;

  const complete = useMutation({
    mutationFn: () =>
      call(
        api.POST('/v1/host/matches/{matchId}/complete', {
          params: { path: { matchId: id } },
          body: {
            scores: sides.map((s) => ({ side_no: s.side_no, score: scores[s.side_no] ?? 0 })),
            mvp_participant_id: mvp,
            incidents: incidents.map(({ type: kind, participant_id, note }) => ({ type: kind, participant_id, note: note.trim() || undefined })),
          },
        }),
      ),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast({ message: t('complete.done'), icon: 'flag' });
      void queryClient.invalidateQueries({ queryKey: ['host-matches'] });
      void queryClient.invalidateQueries({ queryKey: ['roster', id] });
      router.back();
    },
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  });

  const submit = () =>
    Alert.alert(t('complete.confirmTitle'), t('complete.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('complete.submit'), style: 'destructive', onPress: () => complete.mutate() },
    ]);

  const bump = (side: number, d: number) => setScores((s) => ({ ...s, [side]: Math.max(0, Math.min(99, (s[side] ?? 0) + d)) }));

  // INVALID_STATE — bu ekranda aniq ma'no: o'yin hali boshlanmagan (yoki allaqachon yakunlangan)
  const error = complete.error instanceof ApiError && complete.error.code === 'INVALID_STATE' ? null : complete.error;

  return (
    <SheetScreen title={t('complete.title')} onClose={() => router.back()}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!started && ctl.summary ? (
            <Notice tone="warning" icon="time-outline">
              {t('match.completeLocked', { time: formatTime(ctl.summary.starts_at, ctl.summary.timezone) })}
            </Notice>
          ) : null}
          {complete.error instanceof ApiError && complete.error.code === 'INVALID_STATE' ? (
            <Notice tone="danger" icon="alert-circle">
              {t('complete.notStarted')}
            </Notice>
          ) : null}
          {blocked ? (
            <Card style={styles.block}>
              <Notice tone="warning" icon="cloud-upload-outline">
                {t('complete.pendingBlock', { count: ctl.pendingCount })}
              </Notice>
              <Button title={t('sync.syncNow')} icon="sync" variant="secondary" loading={ctl.sync.status === 'syncing'} onPress={() => void syncMatch(id)} />
            </Card>
          ) : null}

          <Text style={type.section}>{t('complete.score')}</Text>
          <View style={styles.scores}>
            {sides.map((s) => {
              const bg = bibColor(s, s.side_no);
              const fg = readableOn(bg);
              return (
                <View key={s.side_no} style={[styles.scoreCard, { backgroundColor: bg }]}>
                  <Text style={[styles.scoreLabel, { color: fg }]} numberOfLines={1}>
                    {s.label ?? `#${s.side_no}`}
                  </Text>
                  <Text style={[styles.score, { color: fg }]} testID={`score-${s.side_no}`}>
                    {scores[s.side_no] ?? 0}
                  </Text>
                  <View style={styles.stepper}>
                    <IconButton icon="remove" label={`${s.label} −1`} variant="light" onPress={() => bump(s.side_no, -1)} />
                    <IconButton icon="add" label={`${s.label} +1`} variant="light" onPress={() => bump(s.side_no, 1)} />
                  </View>
                </View>
              );
            })}
          </View>

          <View>
            <Text style={type.section}>{t('complete.mvp')}</Text>
            <Text style={type.small}>{t('complete.mvpHint')}</Text>
          </View>
          <View style={styles.wrap}>
            <Chip label={t('complete.noMvp')} selected={mvp === null} onPress={() => setMvp(null)} />
            {arrived.map((p) => (
              <Chip
                key={p.participant_id}
                label={p.display_name}
                selected={mvp === p.participant_id}
                onPress={() => setMvp(p.participant_id)}
                icon={mvp === p.participant_id ? <Ionicons name="star" size={14} color={colors.onPrimary} /> : undefined}
              />
            ))}
          </View>

          <View>
            <Text style={type.section}>{t('complete.incidents')}</Text>
            <Text style={type.small}>{t('complete.incidentsHint')}</Text>
          </View>
          {incidents.length ? (
            <Card tone="white" style={styles.incidents}>
              {incidents.map((inc, i) => (
                <View key={inc.key}>
                  {i > 0 ? <Divider /> : null}
                  <View style={styles.incident}>
                    <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
                    <View style={styles.flex}>
                      <Text style={type.bodyStrong}>
                        {t(`complete.incidentType.${inc.type}`)}
                        {inc.participant_id ? ` · ${nameOf(inc.participant_id) ?? ''}` : ''}
                      </Text>
                      {inc.note ? <Text style={type.small}>{inc.note}</Text> : null}
                    </View>
                    <IconButton icon="trash-outline" label={t('complete.remove')} variant="muted" size={34} onPress={() => setIncidents((l) => l.filter((x) => x.key !== inc.key))} />
                  </View>
                </View>
              ))}
            </Card>
          ) : null}
          <Card style={styles.form}>
            <View style={styles.wrap}>
              {INCIDENT_TYPES.map((k) => (
                <Chip key={k} label={t(`complete.incidentType.${k}`)} selected={draft.type === k} onPress={() => setDraft((d) => ({ ...d, type: k }))} />
              ))}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hscroll}>
              <Chip label={t('complete.incidentNobody')} selected={draft.participant_id === null} onPress={() => setDraft((d) => ({ ...d, participant_id: null }))} />
              {arrived.map((p) => (
                <Chip
                  key={p.participant_id}
                  label={p.display_name}
                  selected={draft.participant_id === p.participant_id}
                  onPress={() => setDraft((d) => ({ ...d, participant_id: p.participant_id }))}
                />
              ))}
            </ScrollView>
            <TextInput
              value={draft.note}
              onChangeText={(note) => setDraft((d) => ({ ...d, note }))}
              placeholder={t('complete.notePlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={styles.note}
              maxLength={1000}
              multiline
            />
            <Button
              title={t('complete.addIncident')}
              icon="add"
              variant="secondary"
              onPress={() => {
                setIncidents((l) => [...l, { ...draft, key: Date.now() }]);
                setDraft({ type: 'injury', participant_id: null, note: '' });
              }}
            />
          </Card>
          <ErrorText error={error} />
        </ScrollView>
        <Footer>
          <Button
            testID="complete-submit"
            title={t('complete.submit')}
            icon="flag"
            loading={complete.isPending}
            disabled={!started || blocked || sides.length < 2}
            onPress={submit}
          />
        </Footer>
      </KeyboardAvoidingView>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.md },
  block: { gap: space.sm },
  scores: { flexDirection: 'row', gap: space.sm },
  scoreCard: { flex: 1, borderRadius: radius.lg, padding: space.md, alignItems: 'center', gap: space.xs },
  scoreLabel: { fontFamily: fontFamily.semibold, fontSize: 14 },
  score: { fontFamily: fontFamily.display, fontSize: 64, lineHeight: 72 },
  stepper: { flexDirection: 'row', gap: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hscroll: { gap: space.sm },
  incidents: { paddingVertical: space.xs, gap: 0 },
  incident: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  form: { gap: space.md },
  note: {
    minHeight: 64,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    textAlignVertical: 'top',
  },
});
