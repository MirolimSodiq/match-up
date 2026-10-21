import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, colors, Divider, fontFamily, ListRow, radius, space, type Tone, type } from '@matchup/ui';
import { useHostRecording } from '@/api/queries';
import { formatDuration } from '@/features/Highlights';
import { progress, type UploadJob, waitsForWifi } from '@/media/uploadCore';
import { uploadEngine, useCellularAllowed, useUploads } from '@/media/uploads';
import { useNetwork } from '@/offline/network';
import { useMarkers } from '@/recording/markers';

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

/**
 * Match ekranidagi AI-Cam bo'limi: kamera rejimi va pult, shu telefondagi yozuvlar (Wi-Fi'da yuklanadi) va
 * serverdagi barcha kameralar (boshqa telefonlarniki ham).
 */
export function RecordingSection({ matchId, canRecord }: { matchId: string; canRecord: boolean }) {
  const { t } = useTranslation();
  const uploads = useUploads(matchId, 'recording');
  const cellular = useCellularAllowed();
  const server = useHostRecording(matchId);
  const markers = useMarkers(matchId);
  const local = new Set(uploads.map((u) => u.camera?.clientCameraId));
  const others = (server.data?.cameras ?? []).filter((c) => !local.has(c.client_camera_id) && c.status !== 'cancelled');
  const marked = server.data?.markers.filter((m) => m.kind === 'highlight').length ?? 0;

  if (!canRecord && !uploads.length && !others.length) return null;
  return (
    <View style={styles.section} testID="recording-section">
      <Text style={type.section}>{t('recording.title')}</Text>
      {canRecord ? (
        <>
          <View style={styles.actions}>
            <Button
              testID="open-camera-mode"
              title={t('recording.camera')}
              icon="videocam-outline"
              variant="secondary"
              style={styles.flex}
              onPress={() => router.push({ pathname: '/match/[id]/camera', params: { id: matchId } })}
            />
            <Button
              testID="open-remote"
              title={t('recording.remote')}
              icon="flash-outline"
              variant="secondary"
              style={styles.flex}
              onPress={() => router.push({ pathname: '/match/[id]/remote', params: { id: matchId } })}
            />
          </View>
          <Text style={type.caption}>{t('recording.hint')}</Text>
        </>
      ) : null}

      {uploads.length || others.length ? (
        <Card tone="white" style={styles.list}>
          {uploads.map((u, i) => (
            <View key={u.id}>
              {i > 0 ? <Divider /> : null}
              <LocalRow job={u} cellular={cellular} />
            </View>
          ))}
          {others.map((c, i) => (
            <View key={c.id}>
              {i > 0 || uploads.length ? <Divider /> : null}
              <View style={styles.row}>
                <Ionicons name="phone-landscape-outline" size={22} color={colors.textMuted} />
                <View style={styles.flex}>
                  <Text style={type.bodyStrong}>{t(`recording.position.${c.position}`)}</Text>
                  <Text style={type.small}>
                    {[c.device_model, c.duration_ms ? formatDuration(c.duration_ms) : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Badge label={t(`recording.status.${c.status}`)} tone={cameraTone(c.status)} />
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {uploads.length ? (
        <Card tone="white" style={styles.list}>
          <ListRow
            title={t('recording.cellular')}
            subtitle={t('recording.cellularHint')}
            icon="cellular-outline"
            toggle={{ value: cellular, onChange: (v) => void uploadEngine.setCellularAllowed(v) }}
          />
        </Card>
      ) : null}

      {marked || markers.pending ? (
        <Text style={type.small}>
          {t('recording.markersCount', { count: marked })}
          {markers.pending ? ` · ${t('recording.remotePanel.pending', { count: markers.pending })}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

function cameraTone(status: string): Tone {
  if (status === 'ready') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'recording') return 'warning';
  return 'sport';
}

function LocalRow({ job, cellular }: { job: UploadJob; cellular: boolean }) {
  const { t } = useTranslation();
  const net = useNetwork();
  const percent = Math.floor(progress(job) * 100);
  const wifiWait = (job.state === 'queued' || job.state === 'paused') && waitsForWifi(job, net, cellular);
  const label =
    job.state === 'failed'
      ? t(`highlights.failure.${job.failureCode ?? job.error ?? 'generic'}`, { defaultValue: t('highlights.failure.generic') })
      : wifiWait
        ? t('recording.upload.waitingWifi', { percent })
        : (job.state === 'paused' || job.state === 'queued') && !net.online
          ? t('highlights.state.offline', { percent })
          : t(`highlights.state.${job.state}`, { percent });
  const tone: Tone = job.state === 'failed' ? 'danger' : job.state === 'paused' || wifiWait ? 'warning' : job.state === 'processing' ? 'sport' : 'neutral';
  const remove = () =>
    Alert.alert(t('highlights.removeTitle'), t('highlights.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('highlights.remove'), style: 'destructive', onPress: () => void uploadEngine.remove(job.id) },
    ]);
  return (
    <View style={styles.row} testID={`recording-upload-${job.state}`}>
      <Ionicons name={wifiWait ? 'wifi-outline' : 'phone-landscape'} size={22} color={colors.textMuted} />
      <View style={styles.flex}>
        <Text style={type.bodyStrong}>{job.camera ? t(`recording.position.${job.camera.position}`) : t('recording.title')}</Text>
        <Text style={type.small}>{t('recording.upload.size', { gb: gb(job.sizeBytes), duration: formatDuration(job.durationMs) })}</Text>
        <View style={styles.status}>
          <Badge label={label} tone={tone} />
        </View>
        {job.state === 'uploading' || job.state === 'paused' || job.state === 'queued' ? (
          <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
            <View style={[styles.fill, (job.state === 'paused' || wifiWait) && styles.fillPaused, { width: `${percent}%` }]} />
          </View>
        ) : null}
        <View style={styles.rowActions}>
          {job.state === 'paused' || job.state === 'failed' ? (
            <Pressable accessibilityRole="button" onPress={() => uploadEngine.retry(job.id)} hitSlop={8}>
              <Text style={styles.link}>{job.state === 'paused' ? t('highlights.resume') : t('highlights.retry')}</Text>
            </Pressable>
          ) : null}
          {job.state !== 'processing' && job.state !== 'completing' ? (
            <Pressable accessibilityRole="button" onPress={remove} hitSlop={8}>
              <Text style={[styles.link, styles.linkDanger]}>{t('highlights.remove')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: space.sm, marginTop: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  list: { paddingVertical: space.xs, gap: 0 },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm, alignItems: 'flex-start' },
  status: { flexDirection: 'row', marginTop: 4 },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden', marginTop: space.sm },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  fillPaused: { backgroundColor: colors.warning },
  rowActions: { flexDirection: 'row', gap: space.lg, marginTop: space.xs },
  link: { fontFamily: fontFamily.semibold, fontSize: 14, color: colors.primary },
  linkDanger: { color: colors.danger },
});
