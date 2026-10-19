import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button, colors, fontFamily, IconButton, type IconName, radius, space, type } from '@matchup/ui';
import { useMatchControl } from '@/features/useMatchControl';
import { verifyTicket } from '@/offline/qr';
import { enqueueCheckin } from '@/offline/sync';

type ScanResult =
  | { kind: 'ok'; name?: string; unknown: boolean }
  | { kind: 'already'; name: string }
  | { kind: 'error'; message: string };

/** Bir xil QR'ni kamera ketma-ket ko'p marta beradi — shu vaqt ichida takrorini e'tiborsiz qoldiramiz. */
const SAME_CODE_COOLDOWN_MS = 4000;

export default function ScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const ctl = useMatchControl(id);
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<ScanResult>();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState('');
  const last = useRef<{ data: string; at: number }>(undefined);
  useKeepAwake();

  // Har skanerda eng so'nggi roster/navbat holati kerak — ref orqali (kamera callback'i qayta yaratilmasin)
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;

  const handle = useCallback(
    (raw: string) => {
      const { publicKey, participants } = ctlRef.current;
      if (!publicKey) {
        setResult({ kind: 'error', message: t('scan.noKey') });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      // Internetsiz: imzo (Ed25519, roster.qr_public_key) -> match -> muddat
      const check = verifyTicket(raw, { publicKey, matchId: id });
      if (!check.ok) {
        setResult({ kind: 'error', message: t(`scan.reasons.${check.reason}`) });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      const p = participants.find((x) => x.participant_id === check.claims.p);
      if (p?.status === 'checked_in') {
        setResult({ kind: 'already', name: p.display_name });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      enqueueCheckin({
        matchId: id,
        action: 'check_in',
        method: 'qr',
        participantId: check.claims.p,
        qrPayload: check.token,
        displayName: p?.display_name,
      });
      setResult({ kind: 'ok', name: p?.display_name, unknown: !p });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [id, t],
  );

  const onScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      const now = Date.now();
      if (last.current && last.current.data === data && now - last.current.at < SAME_CODE_COOLDOWN_MS) return;
      last.current = { data, at: now };
      handle(data);
    },
    [handle],
  );

  const granted = permission?.granted;
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          // Natija ko'rsatilayotganda skaner to'xtaydi ("Keyingisi" bosilguncha)
          onBarcodeScanned={result ? undefined : onScanned}
        />
      ) : null}

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
          <IconButton icon="close" label={t('common.close')} variant="glass" onPress={() => router.back()} />
          <View style={styles.counter}>
            <Ionicons name="people" size={14} color={colors.onPrimary} />
            <Text style={styles.counterText}>
              {ctl.counts.checked}/{ctl.counts.total}
            </Text>
          </View>
          {granted ? <IconButton icon={torch ? 'flashlight' : 'flashlight-outline'} label={t('scan.torch')} variant="glass" onPress={() => setTorch((v) => !v)} /> : <View style={styles.spacer} />}
        </View>

        <View style={styles.center}>
          {granted ? (
            <>
              <View style={styles.frame} accessibilityElementsHidden>
                <View style={[styles.corner, styles.tl]} />
                <View style={[styles.corner, styles.tr]} />
                <View style={[styles.corner, styles.bl]} />
                <View style={[styles.corner, styles.br]} />
              </View>
              <Text style={styles.hint}>{t('scan.hint')}</Text>
            </>
          ) : (
            <View style={styles.permission}>
              <Ionicons name="camera-outline" size={40} color={colors.onPrimary} />
              <Text style={[type.title, styles.onDark]}>{t('scan.permissionTitle')}</Text>
              <Text style={[type.small, styles.onDarkMuted]}>{t('scan.permissionBody')}</Text>
              <Button title={t('scan.grant')} variant="light" onPress={() => void requestPermission()} />
            </View>
          )}
        </View>

        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          {result ? <ResultCard result={result} onNext={() => setResult(undefined)} /> : null}
          {__DEV__ && !result ? (
            <View style={styles.dev}>
              <Text style={styles.devTitle}>{t('scan.devTitle')}</Text>
              <Text style={styles.devHint}>{t('scan.devHint')}</Text>
              <View style={styles.devRow}>
                <TextInput
                  testID="qr-manual-input"
                  value={manual}
                  onChangeText={setManual}
                  placeholder={t('scan.devPlaceholder')}
                  placeholderTextColor={colors.onPrimaryMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.devInput}
                  returnKeyType="done"
                  onSubmitEditing={() => manual && handle(manual)}
                />
                <Button
                  testID="qr-manual-submit"
                  title={t('scan.devSubmit')}
                  variant="light"
                  disabled={!manual.trim()}
                  onPress={() => {
                    handle(manual);
                    setManual('');
                  }}
                  style={styles.devButton}
                />
              </View>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function ResultCard({ result, onNext }: { result: ScanResult; onNext: () => void }) {
  const { t } = useTranslation();
  const look: { icon: IconName; bg: string; title: string; body?: string } =
    result.kind === 'ok'
      ? { icon: 'checkmark-circle', bg: colors.success, title: result.name ?? t('scan.ok'), body: result.unknown ? t('scan.okUnknown') : t('scan.ok') }
      : result.kind === 'already'
        ? { icon: 'information-circle', bg: colors.warning, title: result.name, body: t('scan.already') }
        : { icon: 'close-circle', bg: colors.danger, title: result.message };
  return (
    <View style={[styles.result, { backgroundColor: look.bg }]} accessibilityRole="alert" testID={`scan-result-${result.kind}`}>
      <View style={styles.resultRow}>
        <Ionicons name={look.icon} size={36} color={colors.onPrimary} />
        <View style={styles.flex}>
          <Text style={styles.resultTitle}>{look.title}</Text>
          {look.body ? <Text style={styles.resultBody}>{look.body}</Text> : null}
        </View>
      </View>
      <Pressable accessibilityRole="button" onPress={onNext} style={({ pressed }) => [styles.next, pressed && { opacity: 0.85 }]}>
        <Text style={styles.nextText}>{t('scan.next')}</Text>
        <Ionicons name="scan-outline" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

const FRAME = 250;
const CORNER = 34;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  flex: { flex: 1 },
  spacer: { width: 40 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.heroGlass,
    borderWidth: 1,
    borderColor: colors.heroGlassBorder,
  },
  counterText: { fontFamily: fontFamily.display, fontSize: 18, color: colors.onPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: space.xl },
  frame: { width: FRAME, height: FRAME },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: colors.onPrimary },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: radius.md },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: radius.md },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: radius.md },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: radius.md },
  hint: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.onPrimary, textAlign: 'center' },
  permission: { alignItems: 'center', gap: space.md },
  onDark: { color: colors.onPrimary, textAlign: 'center' },
  onDarkMuted: { color: colors.onPrimaryMuted, textAlign: 'center' },
  bottom: { paddingHorizontal: space.lg, gap: space.md },
  result: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  resultTitle: { fontFamily: fontFamily.bold, fontSize: 20, lineHeight: 26, color: colors.onPrimary },
  resultBody: { fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 20, color: colors.onPrimary },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  nextText: { fontFamily: fontFamily.semibold, fontSize: 16, color: colors.text },
  dev: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.heroGlass,
    borderWidth: 1,
    borderColor: colors.heroGlassBorder,
  },
  devTitle: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.onPrimary },
  devHint: { fontFamily: fontFamily.regular, fontSize: 12, color: colors.onPrimaryMuted },
  devRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center', marginTop: space.xs },
  devInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: colors.onPrimary,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.heroGlassBorder,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  devButton: { minHeight: 44, paddingHorizontal: space.lg },
});
