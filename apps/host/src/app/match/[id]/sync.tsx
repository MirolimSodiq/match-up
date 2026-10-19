import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Badge, Button, colors, Divider, EmptyState, type IconName, SheetScreen, space, type Tone, type } from '@matchup/ui';
import { formatTime } from '@/lib/datetime';
import { reasonText, SyncBanner } from '@/features/Roster';
import { useMatchControl } from '@/features/useMatchControl';
import type { EventState, QueuedEvent } from '@/offline/core';
import { offlineStore } from '@/offline/store';
import { syncMatch } from '@/offline/sync';

const STATE_LOOK: Record<EventState, { tone: Tone; icon: IconName }> = {
  pending: { tone: 'warning', icon: 'cloud-upload-outline' },
  accepted: { tone: 'success', icon: 'checkmark-circle' },
  duplicate: { tone: 'neutral', icon: 'copy-outline' },
  rejected: { tone: 'danger', icon: 'close-circle' },
};

/** Har bir event: amal, usul, kim, qachon va server natijasi (qabul / takror / rad + sabab). */
export default function SyncLogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const ctl = useMatchControl(id);
  const tz = ctl.summary?.timezone ?? 'Asia/Tashkent';
  const names = useMemo(() => new Map(ctl.participants.map((p) => [p.participant_id, p.display_name])), [ctl.participants]);
  const events = useMemo(() => [...ctl.events].reverse(), [ctl.events]);

  const renderItem = ({ item: e }: { item: QueuedEvent }) => {
    const look = STATE_LOOK[e.state];
    return (
      <View style={styles.row} testID={`event-${e.state}`}>
        <Ionicons name={e.method === 'qr' ? 'qr-code-outline' : 'hand-left-outline'} size={20} color={colors.textMuted} />
        <View style={styles.flex}>
          <Text style={type.bodyStrong} numberOfLines={1}>
            {names.get(e.participant_id) ?? e.display_name ?? e.participant_id.slice(0, 8)}
          </Text>
          <Text style={type.caption}>
            {t(`sync.action.${e.action}`)} · {t(`sync.method.${e.method}`)} · {formatTime(e.occurred_at, tz)}
          </Text>
          {e.state === 'rejected' ? <Text style={[type.caption, { color: colors.danger }]}>{reasonText(t, e.reason)}</Text> : null}
        </View>
        <Badge tone={look.tone} icon={look.icon} label={t(`sync.state.${e.state}`)} />
      </View>
    );
  };

  return (
    <SheetScreen title={t('sync.log')} onClose={() => router.back()}>
      <FlatList
        data={events}
        keyExtractor={(e) => e.client_event_id}
        renderItem={renderItem}
        ItemSeparatorComponent={Divider}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <SyncBanner sync={ctl.sync} pending={ctl.pendingCount} onPress={() => void syncMatch(id)} onSyncNow={() => void syncMatch(id)} />
          </View>
        }
        ListEmptyComponent={<EmptyState icon="list-outline" title={t('sync.logEmpty')} />}
        ListFooterComponent={
          __DEV__ && events.some((e) => e.state === 'accepted' || e.state === 'duplicate') ? (
            <Button
              title={t('sync.resendDev')}
              icon="repeat"
              variant="ghost"
              onPress={() => {
                offlineStore.requeueResolved(id);
                void syncMatch(id);
              }}
              style={styles.dev}
            />
          ) : undefined
        }
      />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { paddingBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  dev: { marginTop: space.lg },
});
