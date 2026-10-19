import { StyleSheet, View } from 'react-native';
import { colors, space } from '@/components/theme';
import { DashedLine } from '@/components/ui';

const NOTCH = 22;

/**
 * Chipta/chek "yirtish chizig'i": ikki chetda yarim doira kesik va o'rtada punktir.
 * `inset` — ota konteynerning gorizontal padding'i (kesiklar uning chetiga yopishadi).
 * Ota konteynerda `overflow: 'hidden'` bo'lsin — kesikning tashqi yarmi kesilib, haqiqiy yarim doira ko'rinadi.
 */
export function Perforation({
  inset = space.lg,
  notchColor = colors.bg,
  edgeColor = colors.border,
  lineColor,
}: {
  inset?: number;
  notchColor?: string;
  edgeColor?: string;
  lineColor?: string;
}) {
  return (
    <View style={[styles.wrap, { marginHorizontal: -inset }]} accessibilityElementsHidden importantForAccessibility="no">
      <View style={[styles.notch, styles.left, { backgroundColor: notchColor, borderColor: edgeColor }]} />
      <View style={{ marginHorizontal: NOTCH / 2 + space.sm }}>
        <DashedLine color={lineColor} />
      </View>
      <View style={[styles.notch, styles.right, { backgroundColor: notchColor, borderColor: edgeColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: NOTCH, justifyContent: 'center', marginVertical: space.xs },
  notch: { position: 'absolute', width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, borderWidth: 1 },
  left: { left: -NOTCH / 2 - 1 },
  right: { right: -NOTCH / 2 - 1 },
});
