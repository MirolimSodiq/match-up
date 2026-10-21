import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { Highlight } from '@matchup/contracts';
import { colors, EmptyState, ErrorView, fontFamily, IconButton, Loading, radius, space } from '@matchup/ui';
import { isApiError } from '@/api/errors';
import { currentLocale } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { formatDay } from '@/lib/datetime';
import { shareHighlight, useHighlight, useLike } from '@/features/highlights/api';
import { formatDuration } from '@/features/highlights/HighlightTile';

/** To'liq ekran ijro: HLS (720p/480p, adaptiv) imzolangan URL bilan, like va ulashish. */
export default function HighlightScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const q = useHighlight(id);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {q.data?.media.playback ? (
        <Player h={q.data} />
      ) : (
        <View style={styles.center}>
          {q.isPending ? (
            <Loading color={colors.onPrimary} />
          ) : isApiError(q.error, 'NOT_FOUND') || (q.data && !q.data.media.playback) ? (
            <EmptyState icon="videocam-off-outline" title={t('highlights.notAvailable')} />
          ) : (
            <ErrorView error={q.error} onRetry={() => void q.refetch()} />
          )}
        </View>
      )}
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <IconButton icon="close" label={t('common.close')} variant="glass" onPress={() => router.back()} />
      </View>
    </View>
  );
}

function Player({ h }: { h: Highlight }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const like = useLike();
  const [sharing, setSharing] = useState(false);
  // Refetch yangi token'li URL beradi — player qayta boshlanmasin, birinchi URL bilan qoladi (6 soat amal qiladi)
  const [hlsUrl] = useState(h.media.playback!.hls_url);
  const player = useVideoPlayer({ uri: hlsUrl, contentType: 'hls' }, (p) => {
    p.loop = true;
    p.play();
  });

  const share = async () => {
    setSharing(true);
    try {
      await shareHighlight(h.id);
    } catch (err) {
      Alert.alert(t('highlights.share'), errorMessage(t, err));
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <VideoView testID="highlight-video" player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls allowsPictureInPicture={false} />
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]} pointerEvents="box-none">
        <View style={styles.meta} pointerEvents="none">
          <Text style={styles.title} numberOfLines={2}>
            {h.title || t('highlights.untitled')}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {[h.match.venue_name, formatDay(h.match.starts_at, h.match.timezone, currentLocale()), formatDuration(h.duration_ms)].join(' · ')}
          </Text>
          {h.tags.length ? (
            <View style={styles.tags}>
              <Ionicons name="pricetag" size={13} color={colors.onPrimaryMuted} />
              <Text style={styles.sub} numberOfLines={1}>
                {h.tags.map((x) => x.display_name).join(', ')}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.actions}>
          <Pressable
            testID="like"
            accessibilityRole="button"
            accessibilityState={{ selected: h.liked_by_me }}
            accessibilityLabel={h.liked_by_me ? t('highlights.unlike') : t('highlights.like')}
            onPress={() => like.mutate({ id: h.id, liked: !h.liked_by_me })}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Ionicons name={h.liked_by_me ? 'heart' : 'heart-outline'} size={30} color={h.liked_by_me ? colors.danger : colors.onPrimary} />
            <Text style={styles.actionText}>{h.likes_count}</Text>
          </Pressable>
          <Pressable
            testID="share"
            accessibilityRole="button"
            accessibilityLabel={t('highlights.share')}
            disabled={sharing}
            onPress={() => void share()}
            style={({ pressed }) => [styles.action, (pressed || sharing) && styles.pressed]}
          >
            <Ionicons name="paper-plane-outline" size={28} color={colors.onPrimary} />
            <Text style={styles.actionText}>{t('highlights.share')}</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', top: 0, right: 0, paddingHorizontal: space.lg },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 64,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  meta: { flex: 1, gap: 4, backgroundColor: colors.overlay, borderRadius: radius.md, padding: space.md },
  title: { fontFamily: fontFamily.display, fontSize: 22, lineHeight: 26, color: colors.onPrimary },
  sub: { fontFamily: fontFamily.medium, fontSize: 13, color: colors.onPrimaryMuted, flexShrink: 1 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { gap: space.lg, alignItems: 'center' },
  action: { alignItems: 'center', gap: 2, backgroundColor: colors.overlay, borderRadius: radius.lg, paddingHorizontal: 10, paddingVertical: 8, minWidth: 64 },
  actionText: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.onPrimary },
  pressed: { opacity: 0.6 },
});
