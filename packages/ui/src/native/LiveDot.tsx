import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, radius } from '../tokens';

/**
 * "Jonli" belgisi: WebSocket orqali yangilanayotgan ma'lumot yonida. Nuqta sekin pulsatsiya qiladi
 * (tizimda "harakatni kamaytirish" yoqilgan bo'lsa — qimirlamaydi).
 */
export function LiveDot({ label, onSport }: { label: string; onSport?: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  const fg = onSport ? colors.onSport : colors.success;
  return (
    <View
      style={[styles.pill, { backgroundColor: onSport ? colors.sportShade : colors.successSoft }]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <View style={styles.dotBox}>
        {reduceMotion ? null : (
          <Animated.View
            style={[
              styles.ring,
              {
                backgroundColor: fg,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
              },
            ]}
          />
        )}
        <View style={[styles.dot, { backgroundColor: fg }]} />
      </View>
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const DOT = 7;

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  dotBox: { width: DOT, height: DOT, alignItems: 'center', justifyContent: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  ring: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2 },
  label: { fontFamily: fontFamily.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
});
