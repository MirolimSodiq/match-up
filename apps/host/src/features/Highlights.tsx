import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Highlight } from '@matchup/contracts';
import { Badge, Button, Card, colors, Divider, fontFamily, radius, space, type Tone, type, useToast } from '@matchup/ui';
import { useHostHighlights } from '@/api/queries';
import { pickFromLibrary } from '@/media/pickClip';
import { pendingClip } from '@/media/pendingClip';
import { progress, type UploadJob } from '@/media/uploadCore';
import { uploadEngine, useUploads } from '@/media/uploads';
import { useNetwork } from '@/offline/network';

export function formatDuration(ms: number | null | undefined): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);

/** Match ekranidagi bo'lim: yozish / galereya, lokal yuklashlar (progress) va serverdagi kliplar. */
export function HighlightsSection({ matchId, canUpload }: { matchId: string; canUpload: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const uploads = useUploads(matchId);
  const server = useHostHighlights(matchId);
  // Lokal yuklash tugagach (highlightId bor) server ro'yxatidagi qatori ko'rsatiladi — ikki marta emas
  const uploading = uploads.filter((u) => !u.highlightId || !server.data?.items.some((h) => h.id === u.highlightId));
  const items = server.data?.items ?? [];

  const fromLibrary = async () => {
    const r = await pickFromLibrary();
    if (r.ok) {
      pendingClip.set(r.clip);
      router.push({ pathname: '/match/[id]/highlight', params: { id: matchId } });
    } else if (r.reason !== 'cancelled') {
      toast({ message: t(r.reason === 'permission' ? 'highlights.libraryPermission' : `highlights.invalid.${r.reason}`), icon: 'alert-circle' });
    }
  };

  return (
    <View style={styles.section} testID="highlights-section">
      <View style={styles.head}>
        <Text style={type.section}>{t('highlights.title')}</Text>
        {items.length ? <Text style={styles.count}>{items.length}</Text> : null}
      </View>
      {canUpload ? (
        <>
          <View style={styles.actions}>
            <Button
              testID="record-highlight"
              title={t('highlights.record')}
              icon="videocam"
              style={styles.flex}
              onPress={() => router.push({ pathname: '/match/[id]/record', params: { id: matchId } })}
            />
            <Button testID="pick-highlight" title={t('highlights.gallery')} icon="images-outline" variant="secondary" style={styles.flex} onPress={() => void fromLibrary()} />
          </View>
          <Text style={type.caption}>{t('highlights.hint')}</Text>
        </>
      ) : null}

      {uploading.length || items.length ? (
        <Card tone="white" style={styles.list}>
          {uploading.map((u, i) => (
            <View key={u.id}>
              {i > 0 ? <Divider /> : null}
              <UploadRow job={u} />
            </View>
          ))}
          {items.map((h, i) => (
            <View key={h.id}>
              {i > 0 || uploading.length ? <Divider /> : null}
              <HighlightRow h={h} />
            </View>
          ))}
        </Card>
      ) : !canUpload ? null : (
        <Text style={[type.small, styles.empty]}>{t('highlights.empty')}</Text>
      )}
    </View>
  );
}

function stateTone(state: UploadJob['state']): Tone {
  if (state === 'failed') return 'danger';
  if (state === 'paused') return 'warning';
  if (state === 'processing' || state === 'completing') return 'sport';
  return 'neutral';
}

function UploadRow({ job }: { job: UploadJob }) {
  const { t } = useTranslation();
  const { online } = useNetwork();
  const percent = Math.floor(progress(job) * 100);
  const label =
    job.state === 'failed'
      ? t(`highlights.failure.${job.failureCode ?? job.error ?? 'generic'}`, { defaultValue: t('highlights.failure.generic') })
      : (job.state === 'paused' || job.state === 'queued') && !online
        ? t('highlights.state.offline', { percent })
        : t(`highlights.state.${job.state}`, { percent });
  const remove = () =>
    Alert.alert(t('highlights.removeTitle'), t('highlights.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('highlights.remove'), style: 'destructive', onPress: () => void uploadEngine.remove(job.id) },
    ]);
  return (
    <View style={styles.row} testID={`upload-${job.state}`}>
      <View style={[styles.thumb, styles.thumbPlaceholder]}>
        <Ionicons name={job.state === 'paused' || !online ? 'cloud-offline-outline' : job.state === 'failed' ? 'alert-circle-outline' : 'cloud-upload-outline'} size={22} color={colors.textMuted} />
      </View>
      <View style={styles.flex}>
        <Text style={type.bodyStrong} numberOfLines={1}>
          {job.title || t('highlights.untitled')}
        </Text>
        <Text style={type.small}>
          {formatDuration(job.durationMs)} · {megabytes(job.sizeBytes)} MB
        </Text>
        <View style={styles.statusLine}>
          <Badge label={label} tone={stateTone(job.state)} />
        </View>
        {job.state === 'uploading' || job.state === 'paused' || job.state === 'queued' ? (
          <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
            <View style={[styles.fill, job.state === 'paused' && styles.fillPaused, { width: `${percent}%` }]} />
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

function HighlightRow({ h }: { h: Highlight }) {
  const { t } = useTranslation();
  const tone: Tone = h.status === 'ready' ? 'success' : h.status === 'failed' ? 'danger' : 'sport';
  const label =
    h.status === 'failed'
      ? t(`highlights.failure.${h.failure_code ?? 'generic'}`, { defaultValue: t('highlights.failure.generic') })
      : t(`highlights.status.${h.status}`);
  return (
    <View style={styles.row} testID={`highlight-${h.status}`}>
      {h.media.thumbnail_url ? (
        <Image source={{ uri: h.media.thumbnail_url }} style={styles.thumb} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Ionicons name={h.status === 'failed' ? 'alert-circle-outline' : 'hourglass-outline'} size={22} color={colors.textMuted} />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={type.bodyStrong} numberOfLines={1}>
          {h.title || t('highlights.untitled')}
        </Text>
        <Text style={type.small}>
          {formatDuration(h.duration_ms)}
          {h.tags.length ? ` · ${t('highlights.taggedCount', { count: h.tags.length })}` : ''}
        </Text>
        <View style={styles.statusLine}>
          <Badge label={label} tone={tone} />
          {h.status === 'ready' ? (
            <View style={styles.stat}>
              <Ionicons name="heart" size={13} color={colors.textMuted} />
              <Text style={type.caption}>{h.likes_count}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: space.sm, marginTop: space.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  count: { fontFamily: fontFamily.display, fontSize: 24, lineHeight: 28, color: colors.text },
  actions: { flexDirection: 'row', gap: space.sm },
  list: { paddingVertical: space.xs, gap: 0 },
  empty: { textAlign: 'center', paddingVertical: space.md },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm, alignItems: 'flex-start' },
  thumb: { width: 56, height: 84, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 4 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden', marginTop: space.sm },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  fillPaused: { backgroundColor: colors.warning },
  rowActions: { flexDirection: 'row', gap: space.lg, marginTop: space.xs },
  link: { fontFamily: fontFamily.semibold, fontSize: 14, color: colors.primary },
  linkDanger: { color: colors.danger },
});
