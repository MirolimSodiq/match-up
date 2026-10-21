import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, type RecordingProgress, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button, colors, fontFamily, IconButton, radius, space, type, useToast } from '@matchup/ui';
import { api, call } from '@/api/client';
import { uuid } from '@/lib/device';
import { formatDuration } from '@/features/Highlights';
import { contentTypeFor } from '@/media/uploadCore';
import { uploadEngine } from '@/media/uploads';
import { type CameraPosition, maxFileSize, RECORDING_LIMITS } from '@/recording/core';

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

interface Take {
  clientCameraId: string;
  /** Birinchi kadr vaqti (ms): birinchi progress hodisasidan aniqlanadi (`now − duration`). */
  startedAt: number;
  durationMs: number;
  sizeBytes: number;
}

/**
 * Kamera rejimi (2-qadam, landshaft): butun o'yinni 4K yozish. Fokus bir marta qulflanadi, stabilizatsiya
 * o'chiq (kalibrovka uchun kadr qimirlamasligi kerak), iOS'da HEVC. Yozish boshlanganda kamera serverda
 * ro'yxatga olinadi (internet bo'lmasa — yuklash paytida). To'xtagach fayl yuklash navbatiga (Wi-Fi) tushadi.
 */
export default function CameraRecordScreen() {
  const { id, position } = useLocalSearchParams<{ id: string; position: CameraPosition }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const camera = useRef<CameraView>(null);
  const [cam, requestCam] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [take, setTake] = useState<Take>();
  const takeRef = useRef<Take>(undefined);
  useKeepAwake();

  // Shtativdagi telefon yotiq; chiqishda ilova portretga qaytadi
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
    return () => void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
  }, []);

  const granted = cam?.granted && mic?.granted;
  const recording = !!take;

  const register = (body: { started_at: string; stopped_at?: string; duration_ms?: number }, clientCameraId: string) =>
    call(
      api.PUT('/v1/host/matches/{matchId}/recording/cameras/{clientCameraId}', {
        params: { path: { matchId: id, clientCameraId } },
        body: { position, device_model: Device.modelName ?? undefined, ...body },
      }),
    ).catch(() => undefined); // oflayn — yuklash paytida qayta yuboriladi

  const onProgress = (p: RecordingProgress) => {
    const cur = takeRef.current;
    if (!cur) return;
    const first = cur.durationMs === 0;
    const next: Take = {
      ...cur,
      startedAt: first ? Date.now() - Math.round(p.duration * 1000) : cur.startedAt,
      durationMs: Math.round(p.duration * 1000),
      sizeBytes: p.fileSize,
    };
    takeRef.current = next;
    setTake(next);
    if (first) void register({ started_at: new Date(next.startedAt).toISOString() }, next.clientCameraId);
  };

  const start = async () => {
    if (!camera.current || takeRef.current) return;
    const limit = maxFileSize(Paths.availableDiskSpace);
    const t0: Take = { clientCameraId: uuid(), startedAt: Date.now(), durationMs: 0, sizeBytes: 0 };
    takeRef.current = t0;
    setTake(t0);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const res = await camera.current.recordAsync({
        maxDuration: RECORDING_LIMITS.maxDurationMs / 1000,
        maxFileSize: limit,
        ...(Platform.OS === 'ios' ? { codec: 'hvc1' as const } : {}),
      });
      const done = takeRef.current;
      takeRef.current = undefined;
      setTake(undefined);
      if (!res?.uri || !done) return;
      const durationMs = done.durationMs || Date.now() - done.startedAt;
      const startedAt = new Date(done.startedAt).toISOString();
      const stoppedAt = new Date(done.startedAt + durationMs).toISOString();
      const job = await uploadEngine.enqueueRecording({
        matchId: id,
        sourceUri: res.uri,
        contentType: contentTypeFor(res.uri) ?? (Platform.OS === 'ios' ? 'video/quicktime' : 'video/mp4'),
        durationMs,
        camera: { clientCameraId: done.clientCameraId, position, startedAt, stoppedAt, deviceModel: Device.modelName ?? undefined },
      });
      void register({ started_at: startedAt, stopped_at: stoppedAt, duration_ms: durationMs }, done.clientCameraId);
      if (limit > 0 && job.sizeBytes >= limit * 0.98) toast({ message: t('recording.record.fullStop'), icon: 'alert-circle' });
      toast({ message: t('recording.record.saved', { duration: formatDuration(durationMs), gb: gb(job.sizeBytes) }), icon: 'checkmark-circle' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      takeRef.current = undefined;
      setTake(undefined);
      console.warn('camera record', err);
      toast({ message: t('recording.record.failed'), icon: 'alert-circle' });
    }
  };

  const stop = () =>
    Alert.alert(t('recording.record.stopTitle'), t('recording.record.stopBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('recording.record.stop'),
        style: 'destructive',
        onPress: () => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          camera.current?.stopRecording();
        },
      },
    ]);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {granted && !unavailable ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="video"
          videoQuality="2160p"
          videoStabilizationMode="off"
          autofocus="on"
          mute={false}
          onCameraReady={() => setReady(true)}
          onMountError={() => setUnavailable(true)}
          onRecordingProgress={onProgress}
        />
      ) : null}

      <View style={[styles.top, { paddingTop: insets.top + space.sm, paddingLeft: insets.left + space.lg, paddingRight: insets.right + space.lg }]}>
        <IconButton icon="close" label={t('common.close')} variant="glass" onPress={() => (recording ? stop() : router.back())} />
        <View style={[styles.timer, recording && styles.timerLive]}>
          {recording ? <View style={styles.dot} /> : null}
          <Text style={styles.timerText}>
            {recording
              ? t('recording.record.elapsed', { time: formatDuration(take.durationMs), gb: gb(take.sizeBytes) })
              : t(`recording.positionShort.${position}`)}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {!granted ? (
        <View style={styles.center}>
          <Ionicons name="videocam-outline" size={48} color={colors.onPrimary} />
          <Text style={[type.body, styles.centerText]}>{t('recording.record.permission')}</Text>
          <Button
            title={t('recording.record.allow')}
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
          <Text style={[type.body, styles.centerText]}>{t('recording.record.unavailable')}</Text>
        </View>
      ) : (
        <View style={[styles.side, { paddingRight: insets.right + space.xl }]}>
          <Pressable
            testID="camera-record-toggle"
            accessibilityRole="button"
            accessibilityLabel={recording ? t('recording.record.stop') : t('recording.record.start')}
            disabled={!ready}
            onPress={() => (recording ? stop() : void start())}
            style={({ pressed }) => [styles.shutter, pressed && { opacity: 0.8 }, !ready && { opacity: 0.4 }]}
          >
            <View style={[styles.shutterInner, recording && styles.shutterStop]} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  timerLive: { backgroundColor: colors.danger },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onPrimary },
  timerText: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.onPrimary, fontVariant: ['tabular-nums'] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  centerText: { color: colors.onPrimary, textAlign: 'center' },
  side: { position: 'absolute', top: 0, bottom: 0, right: 0, justifyContent: 'center' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: colors.onPrimary, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.danger },
  shutterStop: { width: 30, height: 30, borderRadius: 6 },
});
