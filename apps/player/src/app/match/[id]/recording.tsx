import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, EmptyState, ErrorView, fontFamily, IconButton, Loading, radius, space, states } from '@matchup/ui';
import { formatDuration, openHighlight } from '@/features/highlights/HighlightTile';
import {
  type MatchRecording,
  momentOffset,
  playableCameras,
  type RecordingCameraView,
  type RecordingMoment,
  translateTime,
  useMatchRecording,
} from '@/features/recording/api';

/** Lahzaga sakraganda — biroz oldindan (gol oldidan hujum ko'rinsin). */
const LEAD_IN_S = 8;

/** To'liq o'yin videosi: kameralar (chap / o'ng / umumiy), lahzalarga sakrash, kesilgan kliplar. */
export default function RecordingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const q = useMatchRecording(id);
  const cameras = playableCameras(q.data);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <IconButton icon="close" label={t('common.close')} variant="glass" onPress={() => router.back()} />
        <Text style={styles.heading} numberOfLines={1}>
          {t('recording.title')}
        </Text>
        <View style={styles.topSpacer} />
      </View>
      {cameras.length && q.data ? (
        <Viewer recording={q.data} cameras={cameras} />
      ) : (
        <View style={styles.center}>
          {q.isPending ? (
            <Loading color={colors.onPrimary} />
          ) : q.isError ? (
            <ErrorView error={q.error} onRetry={() => void q.refetch()} />
          ) : q.data ? (
            <EmptyState icon="hourglass-outline" title={q.data.status === 'recording' ? t('recording.recordingNow') : t('recording.processing')} />
          ) : (
            <EmptyState icon="videocam-off-outline" title={t('recording.notAvailable')} />
          )}
        </View>
      )}
    </View>
  );
}

function Viewer({ recording, cameras }: { recording: MatchRecording; cameras: RecordingCameraView[] }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [cameraId, setCameraId] = useState(cameras[0]!.id);
  const camera = cameras.find((c) => c.id === cameraId) ?? cameras[0]!;
  // Refetch yangi token'li URL beradi — player qayta boshlanmasin, kamera bo'yicha birinchi URL qoladi (6 soat)
  const urls = useRef(new Map<string, string>());
  const urlOf = (c: RecordingCameraView) => {
    if (!urls.current.has(c.id)) urls.current.set(c.id, c.playback!.hls_url);
    return urls.current.get(c.id)!;
  };
  const player = useVideoPlayer({ uri: urlOf(camera), contentType: 'hls' }, (p) => p.play());
  const shown = useRef(camera);

  // Kamera almashtirish: o'sha lahzada davom etadi (devor soati bo'yicha)
  useEffect(() => {
    const prev = shown.current;
    if (prev.id === camera.id) return;
    const at = translateTime(player.currentTime, prev, camera);
    shown.current = camera;
    void player.replaceAsync({ uri: urlOf(camera), contentType: 'hls' }).then(() => {
      player.currentTime = at;
      player.play();
    });
    // urlOf — ref orqali, qayta bog'lanish shart emas
  }, [camera, player]);

  const jump = (m: RecordingMoment) => {
    const offset = momentOffset(m, camera.id);
    if (offset === undefined) return;
    player.currentTime = Math.max(0, offset / 1000 - LEAD_IN_S);
    player.play();
  };

  return (
    <>
      <View style={styles.videoBox}>
        <VideoView testID="recording-video" player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls allowsPictureInPicture={false} />
      </View>
      {cameras.length > 1 ? (
        <View style={styles.cameras} accessibilityRole="tablist">
          {cameras.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: c.id === camera.id }}
              onPress={() => setCameraId(c.id)}
              style={({ pressed }) => [styles.chip, c.id === camera.id && styles.chipOn, pressed && { opacity: states.pressedOpacity }]}
            >
              <Ionicons name="videocam" size={14} color={c.id === camera.id ? colors.text : colors.onPrimary} />
              <Text style={[styles.chipText, c.id === camera.id && styles.chipTextOn]}>{t(`recording.position.${c.position}`)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ScrollView style={styles.flex} contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.xl }]}>
        <Text style={styles.section}>{t('recording.moments')}</Text>
        {recording.moments.length === 0 ? <Text style={styles.muted}>{t('recording.noMoments')}</Text> : null}
        {recording.moments.map((m) => (
          <MomentRow key={m.id} m={m} onCamera={momentOffset(m, camera.id) !== undefined} onJump={() => jump(m)} />
        ))}
        <Text style={[styles.muted, styles.privacy]}>{t('recording.privacy')}</Text>
      </ScrollView>
    </>
  );
}

function MomentRow({ m, onCamera, onJump }: { m: RecordingMoment; onCamera: boolean; onJump: () => void }) {
  const { t } = useTranslation();
  const at = m.match_offset_ms !== null && m.match_offset_ms !== undefined ? `${formatDuration(m.match_offset_ms)}` : '—';
  return (
    <View style={styles.row}>
      <Text style={styles.at}>{at}</Text>
      <Text style={[styles.what, styles.flex]} numberOfLines={1}>
        {t(`recording.side.${m.side ?? 'none'}`)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={onCamera ? t('recording.toVideo') : t('recording.notOnCamera')}
        disabled={!onCamera}
        onPress={onJump}
        hitSlop={8}
        style={({ pressed }) => [styles.jump, !onCamera && styles.actionOff, pressed && { opacity: states.pressedOpacity }]}
      >
        <Ionicons name="play" size={16} color={colors.onPrimary} />
      </Pressable>
      {m.highlight_id ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => openHighlight(m.highlight_id!)}
          hitSlop={6}
          style={({ pressed }) => [styles.action, styles.clip, pressed && { opacity: states.pressedOpacity }]}
        >
          <Ionicons name="film-outline" size={14} color={colors.text} />
          <Text style={[styles.actionText, styles.clipText]}>{t('recording.clip')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: colors.primary },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.md },
  heading: { flex: 1, textAlign: 'center', fontFamily: fontFamily.semibold, fontSize: 16, color: colors.onPrimary },
  topSpacer: { width: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  videoBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  cameras: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  chipOn: { backgroundColor: colors.onPrimary, borderColor: colors.onPrimary },
  chipText: { fontFamily: fontFamily.semibold, fontSize: 14, color: colors.onPrimary },
  chipTextOn: { color: colors.text },
  list: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  section: { fontFamily: fontFamily.display, fontSize: 22, lineHeight: 28, textTransform: 'uppercase', color: colors.onPrimary },
  muted: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.7)' },
  privacy: { marginTop: space.lg, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  at: { fontFamily: fontFamily.display, fontSize: 18, color: colors.onPrimary, minWidth: 52, fontVariant: ['tabular-nums'] },
  what: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.onPrimary },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  jump: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  actionOff: { opacity: 0.45 },
  actionText: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.onPrimary },
  clip: { backgroundColor: colors.onPrimary },
  clipText: { color: colors.text },
});
