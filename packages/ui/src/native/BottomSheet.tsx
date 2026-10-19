import { type PropsWithChildren, useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '../tokens';
import { SheetHeader } from './primitives';
import { shadow } from './theme';
import { useUI } from './UIProvider';

/**
 * Ekran ustidagi oq bottom sheet (tez amallar uchun: o'yinchi amallari, sabab tanlash).
 * Katta oqimlar uchun native modal ekran (`SheetScreen`) afzal.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: PropsWithChildren<{ visible: boolean; onClose: () => void; title?: string; subtitle?: string }>) {
  const insets = useSafeAreaInsets();
  const { closeLabel } = useUI();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible, progress]);

  if (!mounted) return null;
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [480, 0] });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} />
      </Animated.View>
      <KeyboardAvoidingView style={styles.bottom} behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
        <Animated.View
          style={[styles.sheet, shadow(3), { paddingBottom: Math.max(insets.bottom, space.lg), transform: [{ translateY }] }]}
          accessibilityViewIsModal
        >
          <View style={styles.grabber} />
          {title ? (
            <View style={styles.header}>
              <SheetHeader title={title} subtitle={subtitle} onClose={onClose} />
            </View>
          ) : null}
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: radius.pill, backgroundColor: colors.borderStrong, marginTop: space.sm },
  header: { paddingTop: space.xs },
});
