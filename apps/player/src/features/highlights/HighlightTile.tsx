import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Highlight } from '@matchup/contracts';
import { colors, fontFamily, radius, space, states } from '@matchup/ui';

export function formatDuration(ms: number | null | undefined): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function openHighlight(id: string) {
  router.push({ pathname: '/highlight/[id]', params: { id } });
}

/** 9:16 thumbnail kartochka: davomiylik, like soni, teglar. */
export function HighlightTile({ h, width = 128, onSport }: { h: Highlight; width?: number; onSport?: boolean }) {
  const { t } = useTranslation();
  const label = h.title || t('highlights.untitled');
  return (
    <Pressable
      testID={`highlight-${h.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${formatDuration(h.duration_ms)}`}
      onPress={() => openHighlight(h.id)}
      style={({ pressed }) => [{ width }, pressed && { opacity: states.pressedOpacity }]}
    >
      <View style={[styles.thumbBox, { width, height: Math.round((width * 16) / 9) }]}>
        {h.media.thumbnail_url ? <Image source={{ uri: h.media.thumbnail_url }} style={StyleSheet.absoluteFill} /> : null}
        <View style={styles.play}>
          <Ionicons name="play" size={22} color={colors.onPrimary} />
        </View>
        <View style={styles.bottomBar}>
          <Text style={styles.duration}>{formatDuration(h.duration_ms)}</Text>
          <View style={styles.likes}>
            <Ionicons name={h.liked_by_me ? 'heart' : 'heart-outline'} size={13} color={colors.onPrimary} />
            <Text style={styles.duration}>{h.likes_count}</Text>
          </View>
        </View>
      </View>
      <Text style={[styles.title, onSport && styles.onSport]} numberOfLines={1}>
        {label}
      </Text>
      {h.tags.length ? (
        <Text style={[styles.tags, onSport && styles.onSportMuted]} numberOfLines={1}>
          {h.tags.map((x) => x.display_name).join(', ')}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Gorizontal tasma (match sahifasi, profil). */
export function HighlightStrip({ items, onSport }: { items: Highlight[]; onSport?: boolean }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {items.map((h) => (
        <HighlightTile key={h.id} h={h} onSport={onSport} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: space.md, paddingRight: space.lg },
  thumbBox: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.overlay,
  },
  likes: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  duration: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.onPrimary, fontVariant: ['tabular-nums'] },
  title: { fontFamily: fontFamily.semibold, fontSize: 14, color: colors.text, marginTop: 6 },
  tags: { fontFamily: fontFamily.regular, fontSize: 12, color: colors.textMuted },
  onSport: { color: colors.onSport },
  onSportMuted: { color: colors.onSport, opacity: 0.75 },
});
