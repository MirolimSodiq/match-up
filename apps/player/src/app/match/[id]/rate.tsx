import { type ReactNode, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { MatchFeedback } from '@matchup/contracts';
import { Avatar, Button, Card, Chip, colors, EmptyState, ErrorText, ErrorView, fontFamily, Footer, Loading, Notice, radius, SheetScreen, space, type, useToast } from '@matchup/ui';
import { isApiError } from '@/api/errors';
import { useMatch } from '@/api/queries';
import { currentLocale } from '@/i18n';
import { formatDay } from '@/lib/datetime';
import { type FeedbackItem, feedbackKey, type FeedbackTarget, useMatchFeedback, useSubmitFeedback } from '@/features/feedback/api';
import { Stars } from '@/features/feedback/Stars';

/** Tez belgilar (server istalgan `[a-z_]` tegni qabul qiladi; tarjima — `rate.tag.*`). */
const TAGS: Partial<Record<FeedbackTarget, string[]>> = {
  match: ['fair_teams', 'good_level', 'fun'],
  venue: ['good_pitch', 'clean', 'good_lighting'],
  host: ['on_time', 'organized', 'friendly'],
};

interface Draft {
  rating: number;
  tags: string[];
}

/** `match.rate` push'idan (`/match/{id}?rate=1`) yoki match sahifasidagi kartadan: o'yin, maydon, host va o'yinchilarni baholash. */
export default function RateScreen() {
  const { t } = useTranslation();
  const { id: matchId } = useLocalSearchParams<{ id: string }>();
  const feedback = useMatchFeedback(matchId);
  const match = useMatch(matchId);
  const close = () => router.back();

  if (feedback.isPending) {
    return (
      <SheetScreen onClose={close}>
        <Loading />
      </SheetScreen>
    );
  }
  if (feedback.error) {
    // 403 — o'yinga kelmagan, 409 — o'yin hali tugamagan: bular xato emas, tushuntirish
    const forbidden = isApiError(feedback.error, 'FORBIDDEN');
    const notFinished = isApiError(feedback.error, 'INVALID_STATE');
    return (
      <SheetScreen onClose={close}>
        {forbidden || notFinished ? (
          <EmptyState icon="star-outline" title={t(forbidden ? 'rate.notParticipant' : 'rate.notFinished')} hint={t(forbidden ? 'rate.notParticipantHint' : 'rate.notFinishedHint')} />
        ) : (
          <ErrorView error={feedback.error} onRetry={() => void feedback.refetch()} />
        )}
      </SheetScreen>
    );
  }

  const m = match.data;
  const subtitle = m ? [m.title || m.venue.name, formatDay(m.starts_at, m.timezone, currentLocale())].filter(Boolean).join(' · ') : undefined;
  return <RateForm feedback={feedback.data} matchId={matchId} subtitle={subtitle} />;
}

function RateForm({ feedback: f, matchId, subtitle }: { feedback: MatchFeedback; matchId: string; subtitle?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const submit = useSubmitFeedback(matchId);

  // Avval qoldirilgan baholar forma boshlang'ich qiymati
  const initial = useMemo(() => {
    const drafts: Record<string, Draft> = {};
    for (const g of f.given) drafts[feedbackKey(g.target, g.to_user_id)] = { rating: g.rating, tags: g.tags };
    const comment = f.given.find((g) => g.target === 'match')?.comment ?? '';
    return { drafts, comment };
  }, [f.given]);
  // Forma bir marta to'ldiriladi: fonda qayta yuklangan holat foydalanuvchi o'zgartirayotgan baholarni bosmasin
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial.drafts);
  const [comment, setComment] = useState(initial.comment);

  const readOnly = !f.open;
  const draft = (target: FeedbackTarget, userId?: string) => drafts[feedbackKey(target, userId)] ?? { rating: 0, tags: [] };
  const setRating = (target: FeedbackTarget, userId: string | undefined, rating: number) =>
    setDrafts((d) => ({ ...d, [feedbackKey(target, userId)]: { tags: [], ...d[feedbackKey(target, userId)], rating } }));
  const toggleTag = (target: FeedbackTarget, tag: string) =>
    setDrafts((d) => {
      const cur = d[feedbackKey(target)] ?? { rating: 0, tags: [] };
      const tags = cur.tags.includes(tag) ? cur.tags.filter((x) => x !== tag) : [...cur.tags, tag];
      return { ...d, [feedbackKey(target)]: { ...cur, tags } };
    });

  const items: FeedbackItem[] = [];
  for (const target of ['match', 'venue', 'host'] as const) {
    const d = draft(target);
    if (target === 'host' && !f.host) continue;
    if (d.rating > 0) {
      items.push({ target, rating: d.rating, ...(d.tags.length ? { tags: d.tags } : {}), ...(target === 'match' && comment.trim() ? { comment: comment.trim() } : {}) });
    }
  }
  for (const p of f.players) {
    const d = draft('player', p.user_id);
    if (d.rating > 0) items.push({ target: 'player', to_user_id: p.user_id, rating: d.rating });
  }

  const send = () =>
    submit.mutate(items, {
      onSuccess: () => {
        toast({ message: t('rate.thanks'), icon: 'star' });
        router.back();
      },
    });

  // Jamoalar bo'yicha: avval o'z tartibi (side_no), so'ng ism
  const players = [...f.players].sort((a, b) => (a.side_no ?? 99) - (b.side_no ?? 99) || a.display_name.localeCompare(b.display_name));

  return (
    <SheetScreen title={t('rate.title')} subtitle={subtitle} onClose={() => router.back()}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {readOnly ? (
            <Notice icon="time-outline">{t('rate.closed')}</Notice>
          ) : (
            <Text style={type.small}>{t('rate.hint')}</Text>
          )}

          <TargetCard
            title={t('rate.match')}
            target="match"
            draft={draft('match')}
            readOnly={readOnly}
            onRate={(r) => setRating('match', undefined, r)}
            onTag={(tag) => toggleTag('match', tag)}
          >
            <TextInput
              testID="rate-comment"
              style={styles.comment}
              value={comment}
              onChangeText={setComment}
              editable={!readOnly}
              placeholder={t('rate.commentPlaceholder')}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.primary}
              multiline
              maxLength={500}
            />
            {comment.trim() && !draft('match').rating && !readOnly ? <Text style={type.small}>{t('rate.commentNeedsRating')}</Text> : null}
          </TargetCard>

          <TargetCard
            title={t('rate.venue')}
            target="venue"
            draft={draft('venue')}
            readOnly={readOnly}
            onRate={(r) => setRating('venue', undefined, r)}
            onTag={(tag) => toggleTag('venue', tag)}
          />

          {f.host ? (
            <TargetCard
              title={t('rate.host')}
              subtitle={f.host.display_name}
              target="host"
              draft={draft('host')}
              readOnly={readOnly}
              onRate={(r) => setRating('host', undefined, r)}
              onTag={(tag) => toggleTag('host', tag)}
            />
          ) : null}

          {players.length ? (
            <Card tone="white" style={styles.card}>
              <Text style={type.section}>{t('rate.players')}</Text>
              <Text style={type.small}>{t('rate.playersHint')}</Text>
              {players.map((p, i) => (
                <View key={p.user_id} style={[styles.player, i > 0 && styles.playerBorder]} testID={`rate-player-${i}`}>
                  <Avatar name={p.display_name} size={36} />
                  <View style={styles.playerText}>
                    <Text style={type.bodyStrong} numberOfLines={1}>
                      {p.display_name}
                    </Text>
                    {p.side_no ? <Text style={type.caption}>{t('rate.team', { n: p.side_no })}</Text> : null}
                  </View>
                  <Stars
                    size={22}
                    label={p.display_name}
                    value={draft('player', p.user_id).rating}
                    disabled={readOnly}
                    onChange={(r) => setRating('player', p.user_id, r)}
                  />
                </View>
              ))}
            </Card>
          ) : null}
        </ScrollView>

        {readOnly ? null : (
          <Footer transparent>
            <ErrorText error={submit.error} />
            <Button testID="rate-submit" title={t('rate.submit')} icon="star" disabled={!items.length} loading={submit.isPending} onPress={send} />
          </Footer>
        )}
      </KeyboardAvoidingView>
    </SheetScreen>
  );
}

function TargetCard({
  title,
  subtitle,
  target,
  draft,
  readOnly,
  onRate,
  onTag,
  children,
}: {
  title: string;
  subtitle?: string;
  target: FeedbackTarget;
  draft: Draft;
  readOnly: boolean;
  onRate: (rating: number) => void;
  onTag: (tag: string) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const tags = TAGS[target] ?? [];
  return (
    <Card tone="white" style={styles.card}>
      <View testID={`rate-${target}`}>
        <Text style={type.section}>{title}</Text>
        {subtitle ? <Text style={type.small}>{subtitle}</Text> : null}
      </View>
      <Stars label={title} value={draft.rating} onChange={onRate} disabled={readOnly} />
      {draft.rating > 0 && tags.length ? (
        <View style={styles.tags}>
          {tags.map((tag) => (
            <Chip key={tag} label={t(`rate.tag.${tag}`)} selected={draft.tags.includes(tag)} onPress={readOnly ? undefined : () => onTag(tag)} />
          ))}
        </View>
      ) : null}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.md },
  card: { gap: space.md },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  comment: {
    minHeight: 72,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    color: colors.text,
    textAlignVertical: 'top',
  },
  player: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  playerBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  playerText: { flex: 1, minWidth: 0 },
});
