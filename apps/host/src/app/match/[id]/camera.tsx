import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, colors, Divider, Group, ListRow, Notice, SheetScreen, space, type } from '@matchup/ui';
import { useHostRecording } from '@/api/queries';
import { useUploads } from '@/media/uploads';
import { busyPositions, CAMERA_POSITIONS, type CameraPosition, minutesAvailable, RECOMMENDED_MINUTES } from '@/recording/core';

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

/**
 * Kamera rejimi (1-qadam): telefon pozitsiyasi va tekshiruv ro'yxati. Boshqa telefon yozayotgan pozitsiya
 * "band" (internet bo'lsa); oflayn — tanlov erkin, server keyin ro'yxatga oladi.
 */
export default function CameraSetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const recording = useHostRecording(id);
  const mine = useUploads(id, 'recording');
  const busy = useMemo(
    () => busyPositions(recording.data, new Set(mine.map((j) => j.camera?.clientCameraId).filter((x): x is string => !!x))),
    [recording.data, mine],
  );
  const [position, setPosition] = useState<CameraPosition>(() => CAMERA_POSITIONS.find((p) => !busy.has(p)) ?? 'left');
  const free = Paths.availableDiskSpace;
  const minutes = minutesAvailable(free, 'hevc');

  return (
    <SheetScreen title={t('recording.setup.title')} subtitle={t('recording.hint')} onClose={() => router.back()}>
      <ScrollView contentContainerStyle={styles.content}>
        <Group title={t('recording.setup.choose')}>
          <Card tone="white" style={styles.list}>
            {CAMERA_POSITIONS.map((p, i) => (
              <View key={p}>
                {i > 0 ? <Divider /> : null}
                <ListRow
                  title={t(`recording.position.${p}`)}
                  subtitle={busy.has(p) ? t('recording.setup.busy') : undefined}
                  icon={p === 'wide' ? 'scan-outline' : p === 'left' ? 'arrow-back-circle-outline' : 'arrow-forward-circle-outline'}
                  accessory={position === p ? 'check' : 'radio'}
                  onPress={() => setPosition(p)}
                />
              </View>
            ))}
          </Card>
        </Group>

        {minutes < RECOMMENDED_MINUTES ? (
          <Notice tone="warning" icon="alert-circle">
            {t('recording.setup.lowSpace')}
          </Notice>
        ) : null}
        <Text style={type.small}>{t('recording.setup.free', { gb: gb(free), minutes })}</Text>

        <Group title={t('recording.setup.checkTitle')}>
          <Card tone="white" style={styles.checks}>
            {(['checkTripod', 'checkLandscape', 'checkPower', 'checkTouch'] as const).map((k) => (
              <View key={k} style={styles.check}>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.textMuted} />
                <Text style={[type.body, styles.flex]}>{t(`recording.setup.${k}`)}</Text>
              </View>
            ))}
          </Card>
        </Group>

        <Button
          testID="camera-next"
          title={t('recording.setup.next')}
          icon="videocam"
          disabled={minutes <= 0}
          onPress={() => router.replace({ pathname: '/match/[id]/camera-record', params: { id, position } })}
        />
      </ScrollView>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.md },
  list: { paddingVertical: space.xs, gap: 0 },
  checks: { gap: space.md },
  check: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
});
