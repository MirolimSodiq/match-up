import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, colors, Divider, fontFamily, Notice, radius, SheetScreen, space, type Tone, type, useToast } from '@matchup/ui';
import { useHostMatch } from '@/api/queries';
import { formatTime } from '@/lib/datetime';
import { useNow } from '@/lib/time';
import { kickoffAt, matchClock, type MarkerSide, type QueuedMarker } from '@/recording/core';
import { markerEngine, useMarkers } from '@/recording/markers';

/**
 * Pult (host o'z telefonida, kamera telefonlari shtativda): lahza bo'lgandan keyin tomonini bosadi —
 * klip o'sha tomondagi kameradan kesiladi. Belgi telefon soati bilan darhol diskka yoziladi (internetsiz ham).
 */
export default function RemoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const markers = useMarkers(id);
  const hostMatch = useHostMatch(id).match;
  const timeZone = hostMatch?.match?.timezone ?? 'Asia/Tashkent';
  const now = useNow(1000);
  const kickoff = kickoffAt(markers.all, id);
  const clock = matchClock(now, kickoff);
  // O'yin davomida ekran o'chmasin
  useKeepAwake();

  const mark = (side: MarkerSide | null) => {
    const m = markerEngine.add(id, 'highlight', side);
    if (!m) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast({ message: `${t('recording.remotePanel.marked')}${clock ? ` · ${clock}` : ''}`, icon: 'flash' });
  };

  const startGame = () => {
    markerEngine.add(id, 'kickoff', null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <SheetScreen title={t('recording.remotePanel.title')} subtitle={t('recording.remotePanel.hint')} onClose={() => router.back()}>
      <ScrollView contentContainerStyle={styles.content}>
        {kickoff ? (
          <View style={styles.clock}>
            <Text style={styles.clockText} accessibilityRole="timer">
              {clock}
            </Text>
            <Text style={type.small}>{t('recording.remotePanel.kickoffAt', { time: formatTime(kickoff, timeZone) })}</Text>
          </View>
        ) : (
          <Button testID="remote-kickoff" title={t('recording.remotePanel.kickoff')} icon="play-circle" onPress={startGame} />
        )}

        <View style={styles.pads}>
          <Pad testID="remote-left" label={t('recording.remotePanel.left')} icon="arrow-back" onPress={() => mark('left')} />
          <Pad testID="remote-right" label={t('recording.remotePanel.right')} icon="arrow-forward" onPress={() => mark('right')} />
        </View>
        <Button testID="remote-any" title={t('recording.remotePanel.highlight')} icon="flash-outline" variant="secondary" onPress={() => mark(null)} />

        {markers.pending ? (
          <Notice tone={markers.sync.status === 'error' ? 'danger' : 'warning'} icon="cloud-upload-outline">
            {t('recording.remotePanel.pending', { count: markers.pending })}
          </Notice>
        ) : null}

        <Card tone="white" style={styles.list}>
          {markers.visible.length === 0 ? (
            <Text style={[type.small, styles.empty]}>{t('recording.remotePanel.empty')}</Text>
          ) : (
            markers.visible.map((m, i) => (
              <View key={m.client_marker_id}>
                {i > 0 ? <Divider /> : null}
                <MarkerRow m={m} kickoff={kickoff} timeZone={timeZone} />
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </SheetScreen>
  );
}

function Pad({ label, icon, onPress, testID }: { label: string; icon: 'arrow-back' | 'arrow-forward'; onPress: () => void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.pad, pressed && styles.padPressed]}
    >
      <Ionicons name="football" size={34} color={colors.onPrimary} />
      <View style={styles.padLabel}>
        {icon === 'arrow-back' ? <Ionicons name={icon} size={16} color={colors.onPrimary} /> : null}
        <Text style={styles.padText}>{label}</Text>
        {icon === 'arrow-forward' ? <Ionicons name={icon} size={16} color={colors.onPrimary} /> : null}
      </View>
    </Pressable>
  );
}

function MarkerRow({ m, kickoff, timeZone }: { m: QueuedMarker; kickoff?: string; timeZone: string }) {
  const { t } = useTranslation();
  const at = kickoff && m.occurred_at >= kickoff ? matchClock(Date.parse(m.occurred_at), kickoff) : formatTime(m.occurred_at, timeZone);
  const state = m.state === 'synced' && m.highlight_id ? 'clip' : m.state === 'deleting' ? 'pending' : m.state;
  const tone: Tone = state === 'rejected' ? 'danger' : state === 'pending' ? 'warning' : state === 'clip' ? 'success' : 'neutral';
  const what =
    m.kind === 'kickoff'
      ? t('recording.remotePanel.kind.kickoff')
      : m.side
        ? t(`recording.remotePanel.${m.side}`)
        : t('recording.remotePanel.kind.highlight');
  return (
    <View style={styles.row}>
      <Text style={styles.at}>{at}</Text>
      <View style={styles.flex}>
        <Text style={type.bodyStrong}>{what}</Text>
        {m.state === 'rejected' ? (
          <Text style={[type.caption, { color: colors.danger }]}>
            {t(`recording.remotePanel.reasons.${m.reason ?? 'REJECTED'}`, { defaultValue: t('recording.remotePanel.reasons.REJECTED') })}
          </Text>
        ) : null}
      </View>
      <Badge label={t(`recording.remotePanel.state.${state}`)} tone={tone} />
      <Pressable accessibilityRole="button" onPress={() => markerEngine.undo(m.client_marker_id)} hitSlop={8}>
        <Text style={styles.undo}>{t('recording.remotePanel.undo')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.md },
  clock: { alignItems: 'center', gap: space.xs },
  clockText: { fontFamily: fontFamily.display, fontSize: 56, lineHeight: 62, color: colors.text, fontVariant: ['tabular-nums'] },
  pads: { flexDirection: 'row', gap: space.md },
  pad: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  padPressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  padLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  padText: { fontFamily: fontFamily.semibold, fontSize: 16, color: colors.onPrimary },
  list: { paddingVertical: space.xs, gap: 0 },
  empty: { textAlign: 'center', paddingVertical: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  at: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.text, minWidth: 52, fontVariant: ['tabular-nums'] },
  undo: { fontFamily: fontFamily.semibold, fontSize: 14, color: colors.danger },
});
