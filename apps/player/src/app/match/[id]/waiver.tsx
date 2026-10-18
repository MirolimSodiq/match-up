import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, call } from '@/api/client';
import { isApiError } from '@/api/errors';
import { qk, useRequiredWaiver } from '@/api/queries';
import { Markdown } from '@/components/Markdown';
import { colors, space } from '@/components/theme';
import { Button, ErrorText, ErrorView, Footer, H2, Loading, Muted } from '@/components/ui';

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
   * bo'yicha, shuning uchun shaffof header ostidagi inset'lar (iOS 26) natijaga ta'sir qilmaydi.
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

  if (waiver.isPending || waiver.data?.signed) return <Loading />;
  if (waiver.error) return <ErrorView error={waiver.error} onRetry={() => void waiver.refetch()} />;
  if (!template) return <Loading />;

  return (
    <View style={styles.flex}>
      <ScrollView
        key={template.document_sha256}
        ref={scrollRef}
        testID="waiver-scroll"
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        scrollEventThrottle={16}
        onLayout={check}
        onContentSizeChange={check}
        onScroll={check}
      >
        <H2>{template.title}</H2>
        <Muted>
          {t('waiver.version', { version: template.version })} · {template.locale}
        </Muted>
        <View style={styles.body}>
          <Markdown source={template.body_md ?? ''} />
        </View>
        <View ref={endRef} collapsable={false} style={styles.end} />
      </ScrollView>
      <Footer>
        {!reachedEnd ? <Muted style={styles.hint}>{t('waiver.scrollHint')}</Muted> : null}
        <ErrorText error={sign.error} />
        <Button
          testID="waiver-agree"
          title={t('waiver.agree')}
          disabled={!reachedEnd}
          loading={sign.isPending}
          onPress={() => sign.mutate()}
        />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  body: {
    marginTop: space.md,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  hint: { textAlign: 'center' },
  end: { height: 1 },
});
