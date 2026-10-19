import { type ComponentRef, useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, colors, ErrorText, ErrorView, Footer, Loading, Markdown, SheetScreen, space, type } from '@matchup/ui';
import { api, call } from '@/api/client';
import { isApiError } from '@/api/errors';
import { qk, useRequiredWaiver } from '@/api/queries';

/** Pastki chegaraga shuncha px qolganda "oxirigacha o'qildi" hisoblanadi. */
const END_THRESHOLD = 24;

export default function WaiverScreen() {
  const { t } = useTranslation();
  const { id: matchId } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const waiver = useRequiredWaiver(matchId);

  // Qaysi hujjat versiyasi (hash) oxirigacha o'qilgani: yangi versiya kelsa qayta o'qish kerak
  const [readHash, setReadHash] = useState<string>();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const endRef = useRef<ComponentRef<typeof View>>(null);

  const template = waiver.data?.template;
  const reachedEnd = !!template?.document_sha256 && readHash === template.document_sha256;

  // Allaqachon imzolangan (joriy versiya) — to'g'ridan-to'g'ri to'lovga
  useEffect(() => {
    if (waiver.data?.signed) router.replace({ pathname: '/match/[id]/checkout', params: { id: matchId } });
  }, [waiver.data?.signed, matchId]);

  /**
   * Matn oxiridagi belgi ScrollView'ning ko'rinadigan pastki chegarasiga yetdimi — oynadagi koordinatalar
   * bo'yicha, shuning uchun sheet ichidagi inset'lar natijaga ta'sir qilmaydi.
   * Qisqa matnda oxiri skrollsiz ham ko'rinadi — shunda darhol faollashadi.
   */
  const check = () => {
    const hash = template?.document_sha256;
    if (!hash || readHash === hash) return;
    endRef.current?.measureInWindow((_x, endY) => {
      scrollRef.current?.measureInWindow((_sx, top, _w, height) => {
        if (height > 0 && endY <= top + height + END_THRESHOLD) setReadHash(hash);
      });
    });
  };

  const sign = useMutation({
    mutationFn: () =>
      call(
        api.POST('/v1/waivers/{templateId}/signatures', {
          params: { path: { templateId: template!.id! } },
          body: {
            accepted: true,
            method: 'clickwrap',
            // Server bergan hash o'zgartirilmasdan qaytariladi — foydalanuvchi aynan shu matnni ko'rdi
            document_sha256: template!.document_sha256!,
            match_id: matchId,
          },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.waiver(matchId) }),
        queryClient.invalidateQueries({ queryKey: ['match'] }),
      ]);
      router.replace({ pathname: '/match/[id]/checkout', params: { id: matchId } });
    },
    onError: (err) => {
      if (isApiError(err, 'WAIVER_OUTDATED')) void waiver.refetch();
    },
  });

  if (waiver.isPending || waiver.data?.signed || (!waiver.error && !template)) {
    return (
      <SheetScreen onClose={() => router.back()}>
        <Loading />
      </SheetScreen>
    );
  }
  if (waiver.error || !template) {
    return (
      <SheetScreen onClose={() => router.back()}>
        <ErrorView error={waiver.error} onRetry={() => void waiver.refetch()} />
      </SheetScreen>
    );
  }

  return (
    <SheetScreen
      title={t('waiver.title')}
      subtitle={`${t('waiver.version', { version: template.version })} · ${template.locale}`}
      onClose={() => router.back()}
    >
      <ScrollView
        key={template.document_sha256}
        ref={scrollRef}
        testID="waiver-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.content}
        scrollEventThrottle={16}
        onLayout={check}
        onContentSizeChange={check}
        onScroll={check}
      >
        {template.title ? <Text style={type.title}>{template.title}</Text> : null}
        <Markdown source={template.body_md ?? ''} />
        <View ref={endRef} collapsable={false} style={styles.end} />
      </ScrollView>

      <Footer transparent>
        {!reachedEnd ? (
          <View style={styles.hint}>
            <Ionicons name="arrow-down" size={14} color={colors.textMuted} />
            <Text style={type.small}>{t('waiver.scrollHint')}</Text>
          </View>
        ) : null}
        <ErrorText error={sign.error} />
        <Button
          testID="waiver-agree"
          title={t('waiver.agree')}
          icon="checkmark-done"
          disabled={!reachedEnd}
          loading={sign.isPending}
          onPress={() => sign.mutate()}
        />
      </Footer>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.md },
  hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  end: { height: 1 },
});
