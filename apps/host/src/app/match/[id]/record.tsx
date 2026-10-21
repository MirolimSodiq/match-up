import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button, colors, fontFamily, IconButton, radius, space, type, useToast } from '@matchup/ui';
import { formatDuration } from '@/features/Highlights';
import { pendingClip } from '@/media/pendingClip';
import { toClip } from '@/media/pickClip';

const MAX_SECONDS = 60;

/** Highlight yozish: orqa kamera, 720p, ≤ 60 s (avtomatik to'xtaydi). */
export default function RecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const camera = useRef<CameraView>(null);
  const [cam, requestCam] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [startedAt, setStartedAt] = useState<number>();
  const [elapsed, setElapsed] = useState(0);
  useKeepAwake();

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(timer);
  }, [startedAt]);

  const granted = cam?.granted && mic?.granted;

  const start = async () => {
    if (!camera.current || startedAt) return;
    const t0 = Date.now();
    setStartedAt(t0);
    setElapsed(0);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await camera.current.recordAsync({ maxDuration: MAX_SECONDS });
      const durationMs = Math.min(Date.now() - t0, MAX_SECONDS * 1000);
      setStartedAt(undefined);
      if (!res?.uri) return;
      const r = toClip({ uri: res.uri, durationMs, recordedAt: new Date(t0).toISOString() });
      if (!r.ok) {
        toast({ message: t(`highlights.invalid.${r.reason}`), icon: 'alert-circle' });
        return;
      }
      pendingClip.set(r.clip);
      router.replace({ pathname: '/match/[id]/highlight', params: { id } });
    } catch (err) {
      setStartedAt(undefined);
      console.warn('record', err);
      toast({ message: t('highlights.camera.failed'), icon: 'alert-circle' });
    }
  };

  const stop = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    camera.current?.stopRecording();
  };

  const recording = !!startedAt;
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {granted && !unavailable ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="video"
          videoQuality="720p"
          mute={false}
          onCameraReady={() => setReady(true)}
          onMountError={() => setUnavailable(true)}
        />
      ) : null}

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <IconButton icon="close" label={t('common.close')} variant="glass" onPress={() => (recording ? stop() : router.back())} />
        <View style={[styles.timer, recording && styles.timerLive]}>
          {recording ? <View style={styles.dot} /> : null}
          <Text style={styles.timerText}>
            {formatDuration(elapsed)} / {formatDuration(MAX_SECONDS * 1000)}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {!granted ? (
        <View style={styles.center}>
          <Ionicons name="videocam-outline" size={48} color={colors.onPrimary} />
          <Text style={[type.body, styles.centerText]}>{t('highlights.camera.permission')}</Text>
          <Button
            title={t('highlights.camera.allow')}
            variant="light"
            onPress={async () => {
              await requestCam();
              await requestMic();
            }}
          />
        </View>
      ) : unavailable ? (
        <View style={styles.center}>
          <Ionicons name="videocam-off-outline" size={48} color={colors.onPrimary} />
          <Text style={[type.body, styles.centerText]}>{t('highlights.camera.unavailable')}</Text>
        </View>
      ) : null}

      {granted && !unavailable ? (
        <View style={[styles.bottom, { paddingBottom: insets.bottom + space.xl }]}>
          <Text style={styles.hint}>{t('highlights.camera.maxHint')}</Text>
          <Pressable
            testID="record-toggle"
            accessibilityRole="button"
            accessibilityLabel={recording ? t('highlights.camera.stop') : t('highlights.camera.start')}
            disabled={!ready}
            onPress={() => (recording ? stop() : void start())}
            style={({ pressed }) => [styles.shutter, pressed && { opacity: 0.8 }, !ready && { opacity: 0.4 }]}
          >
            <View style={[styles.shutterInner, recording && styles.shutterStop]} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  timerLive: { backgroundColor: colors.danger },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onPrimary },
  timerText: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.onPrimary, fontVariant: ['tabular-nums'] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  centerText: { color: colors.onPrimary, textAlign: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: space.md },
  hint: { fontFamily: fontFamily.medium, fontSize: 13, color: colors.onPrimary, opacity: 0.85 },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: colors.onPrimary, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.danger },
  shutterStop: { width: 30, height: 30, borderRadius: 6 },
});
