import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, colors, Divider, EmptyState, fontFamily, Footer, ListRow, radius, SheetScreen, space, type, useToast } from '@matchup/ui';
import { formatDuration, megabytes } from '@/features/Highlights';
import { useMatchControl } from '@/features/useMatchControl';
import { pendingClip } from '@/media/pendingClip';
import { uploadEngine } from '@/media/uploads';

/** Yangi highlight: sarlavha va teglar, keyin yuklash navbatga (fonda, davom ettiriladigan). */
export default function NewHighlightScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const ctl = useMatchControl(id);
  const [clip] = useState(() => pendingClip.take());
  const [title, setTitle] = useState('');
  const [tagged, setTagged] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Mehmonlar (akkauntsiz) teglanmaydi; check-in qilinganlar tepada
  const players = useMemo(
    () =>
      ctl.participants
        .filter((p) => !p.is_guest && p.status !== 'no_show')
        .sort((a, b) => Number(b.status === 'checked_in') - Number(a.status === 'checked_in') || a.display_name.localeCompare(b.display_name)),
    [ctl.participants],
  );

  const toggle = (pid: string) =>
    setTagged((s) => {
      const n = new Set(s);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });

  const upload = async () => {
    if (!clip) return;
    setBusy(true);
    try {
      await uploadEngine.enqueue({
        matchId: id,
        sourceUri: clip.uri,
        contentType: clip.contentType,
        sizeBytes: clip.sizeBytes,
        durationMs: clip.durationMs,
        recordedAt: clip.recordedAt,
        title,
        taggedParticipantIds: [...tagged],
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast({ message: t('highlights.queuedToast'), icon: 'cloud-upload-outline' });
      router.back();
    } catch (err) {
      console.warn('enqueue', err);
      toast({ message: t('highlights.failure.FILE_MISSING'), icon: 'alert-circle' });
      setBusy(false);
    }
  };

  return (
    <SheetScreen title={t('highlights.newTitle')} subtitle={clip ? `${formatDuration(clip.durationMs)} · ${megabytes(clip.sizeBytes)} MB` : undefined} onClose={() => router.back()}>
      {!clip ? (
        <EmptyState icon="videocam-off-outline" title={t('highlights.noClip')} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={type.smallStrong}>{t('highlights.titleLabel')}</Text>
            <TextInput
              testID="highlight-title"
              value={title}
              onChangeText={setTitle}
              placeholder={t('highlights.titlePlaceholder')}
              placeholderTextColor={colors.textMuted}
              maxLength={120}
              // O'zbekcha ismlar va so'zlar inglizcha avto-tuzatish bilan buziladi
              autoCorrect={false}
              style={styles.input}
              returnKeyType="done"
            />

            <View style={styles.tagHead}>
              <Text style={type.section}>{t('highlights.tagTitle')}</Text>
              {tagged.size ? <Text style={type.small}>{t('highlights.taggedCount', { count: tagged.size })}</Text> : null}
            </View>
            <Text style={type.caption}>{t('highlights.tagHint')}</Text>
            <Card tone="white" style={styles.list}>
              {players.length === 0 ? (
                <Text style={[type.small, styles.empty]}>{t('highlights.noPlayers')}</Text>
              ) : (
                players.map((p, i) => (
                  <View key={p.participant_id}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow
                      title={p.display_name}
                      subtitle={t(`match.participant.${p.status}`)}
                      accessory={tagged.has(p.participant_id) ? 'check' : 'radio'}
                      onPress={() => toggle(p.participant_id)}
                    />
                  </View>
                ))
              )}
            </Card>
          </ScrollView>
          <Footer>
            <Button testID="upload-highlight" title={t('highlights.upload')} icon="cloud-upload-outline" loading={busy} onPress={() => void upload()} />
          </Footer>
        </KeyboardAvoidingView>
      )}
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.sm },
  input: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  tagHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: space.lg },
  list: { paddingVertical: space.xs, gap: 0 },
  empty: { textAlign: 'center', paddingVertical: space.lg },
});
