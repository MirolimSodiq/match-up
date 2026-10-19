import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  colors,
  Divider,
  EmptyState,
  fontFamily,
  radius,
  readableOn,
  SegmentedControl,
  SheetScreen,
  space,
  states,
  type,
  useToast,
  useUI,
} from '@matchup/ui';
import { api, call } from '@/api/client';
import { qk, type RosterData } from '@/api/queries';
import { BibDot, bibColor } from '@/features/Roster';
import { useMatchControl } from '@/features/useMatchControl';
import { autoSplit, type ParticipantView } from '@/offline/core';
import { offlineStore } from '@/offline/store';

type Filter = 'checked' | 'all';

export default function TeamsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { formatError } = useUI();
  const toast = useToast();
  const queryClient = useQueryClient();
  const ctl = useMatchControl(id);
  const [filter, setFilter] = useState<Filter>('checked');
  const [busy, setBusy] = useState<string>();

  const players = useMemo(
    () => ctl.participants.filter((p) => p.status !== 'no_show' && (filter === 'all' || p.status === 'checked_in')),
    [ctl.participants, filter],
  );
  const sides = ctl.sides.filter((s): s is typeof s & { side_no: number } => typeof s.side_no === 'number');

  /** Optimistik: ekranda darhol, server rad etsa — qaytariladi. */
  const patchLocal = (pid: string, side: number | null) => {
    offlineStore.patchParticipant(id, pid, { side_no: side });
    queryClient.setQueryData<RosterData>(qk.roster(id), (old) =>
      old
        ? { ...old, roster: { ...old.roster, participants: old.roster.participants?.map((p) => (p.participant_id === pid ? { ...p, side_no: side } : p)) } }
        : old,
    );
  };

  const assign = async (p: ParticipantView, side: number) => {
    if (p.side_no === side) return true;
    const prev = p.side_no ?? null;
    patchLocal(p.participant_id, side);
    try {
      await call(
        api.PATCH('/v1/host/matches/{matchId}/participants/{participantId}', {
          params: { path: { matchId: id, participantId: p.participant_id } },
          body: { side_no: side },
        }),
      );
      return true;
    } catch (err) {
      patchLocal(p.participant_id, prev);
      toast({ message: formatError(err), icon: 'alert-circle' });
      return false;
    }
  };

  const onPick = async (p: ParticipantView, side: number) => {
    setBusy(p.participant_id);
    if (await assign(p, side)) void Haptics.selectionAsync();
    setBusy(undefined);
  };

  const onAuto = async () => {
    setBusy('auto');
    const plan = autoSplit(players, sides.map((s) => s.side_no));
    let ok = true;
    for (const p of players) {
      const side = plan.get(p.participant_id);
      if (side !== undefined && !(await assign(p, side))) {
        ok = false;
        break;
      }
    }
    setBusy(undefined);
    if (ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast({ message: t('teams.saved'), icon: 'shirt' });
    }
    void queryClient.invalidateQueries({ queryKey: qk.roster(id) });
  };

  return (
    <SheetScreen title={t('teams.title')} subtitle={t('teams.hint')} onClose={() => router.back()}>
      {sides.length === 0 ? (
        <EmptyState icon="shirt-outline" title={t('teams.noSides')} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summary}>
            {sides.map((s) => {
              const count = ctl.participants.filter((p) => p.side_no === s.side_no && p.status !== 'no_show').length;
              const bg = bibColor(s, s.side_no);
              return (
                <View key={s.side_no} style={[styles.sideCard, { backgroundColor: bg }]}>
                  <Text style={[styles.sideLabel, { color: readableOn(bg) }]} numberOfLines={1}>
                    {s.label ?? `#${s.side_no}`}
                  </Text>
                  <Text style={[styles.sideCount, { color: readableOn(bg) }]}>{count}</Text>
                </View>
              );
            })}
          </View>

          <SegmentedControl
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'checked', label: t('teams.onlyCheckedIn') },
              { value: 'all', label: t('match.roster') },
            ]}
          />

          <Button title={t('teams.auto')} icon="shuffle" variant="secondary" loading={busy === 'auto'} disabled={!players.length || !!busy} onPress={() => void onAuto()} />
          <Text style={[type.caption, styles.center]}>{t('teams.autoHint')}</Text>

          <Card tone="white" style={styles.list}>
            {players.map((p, i) => (
              <View key={p.participant_id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={type.bodyStrong} numberOfLines={1}>
                      {p.display_name}
                    </Text>
                    <View style={styles.meta}>
                      {p.side_no ? <BibDot color={bibColor(sides.find((s) => s.side_no === p.side_no), p.side_no)} /> : null}
                      <Text style={type.caption}>
                        {p.side_no ? (sides.find((s) => s.side_no === p.side_no)?.label ?? `#${p.side_no}`) : t('teams.unassigned')}
                        {p.level ? ` · ${t(`match.level.${p.level}`)}` : ''}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.chips}>
                    {sides.map((s) => {
                      const bg = bibColor(s, s.side_no);
                      const on = p.side_no === s.side_no;
                      return (
                        <Pressable
                          key={s.side_no}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on, disabled: !!busy }}
                          accessibilityLabel={`${p.display_name}: ${s.label ?? s.side_no}`}
                          disabled={!!busy}
                          onPress={() => void onPick(p, s.side_no)}
                          style={({ pressed }) => [
                            styles.chip,
                            { borderColor: bg },
                            on && { backgroundColor: bg },
                            pressed && { opacity: states.pressedOpacity },
                          ]}
                        >
                          <Text style={[styles.chipText, { color: on ? readableOn(bg) : colors.text }]}>{(s.label ?? String(s.side_no)).slice(0, 1)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>
            ))}
            {players.length === 0 ? <Text style={[type.small, styles.empty]}>{t('match.rosterEmpty')}</Text> : null}
          </Card>
        </ScrollView>
      )}
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.md },
  summary: { flexDirection: 'row', gap: space.sm },
  sideCard: { flex: 1, borderRadius: radius.lg, padding: space.md, gap: 2 },
  sideLabel: { fontFamily: fontFamily.semibold, fontSize: 14 },
  sideCount: { fontFamily: fontFamily.display, fontSize: 34, lineHeight: 40 },
  center: { textAlign: 'center' },
  list: { paddingVertical: space.xs, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, minHeight: 56 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  chips: { flexDirection: 'row', gap: space.sm },
  chip: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: fontFamily.bold, fontSize: 15 },
  empty: { textAlign: 'center', paddingVertical: space.lg },
});
