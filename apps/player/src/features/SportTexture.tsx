import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';
import { colors } from '@/components/theme';

/**
 * Sport rangidagi blok fonidagi xira tekstura (dekor; ekran o'quvchilardan yashirilgan):
 * futbol — maydon chiziqlari, basketbol — to'p choklari, voleybol — to'p panellari.
 */
export function SportTexture({
  sport,
  opacity = 0.12,
  strokeWidth = 2,
  fadeBottom,
}: {
  sport: string;
  opacity?: number;
  strokeWidth?: number;
  /** Pastki qismi asta so'nadi — ostidagi kontent (matn) ustida chiziq qolmasin. */
  fadeBottom?: boolean;
}) {
  const stroke = { stroke: colors.sportTexture, strokeOpacity: opacity, strokeWidth, fill: 'none' } as const;
  // Bir ekranda bir nechta tekstura bo'lsa, gradient/mask id'lari to'qnashmasin (web'da id global)
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice">
        {fadeBottom ? (
          <Defs>
            <LinearGradient id={`fade${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.6" stopColor={colors.sportTexture} stopOpacity={1} />
              <Stop offset="0.82" stopColor={colors.sportTexture} stopOpacity={0} />
            </LinearGradient>
            <Mask id={`fadeMask${id}`} maskUnits="userSpaceOnUse" x="-200" y="-10" width="700" height="220">
              <Rect x="-200" y="-10" width="700" height="220" fill={`url(#fade${id})`} />
            </Mask>
          </Defs>
        ) : null}
        <G mask={fadeBottom ? `url(#fadeMask${id})` : undefined}>
          {sport === 'football' ? (
            <>
              <Line x1={150} y1={-10} x2={150} y2={210} {...stroke} />
              <Circle cx={150} cy={100} r={34} {...stroke} />
              <Rect x={-6} y={45} width={56} height={110} {...stroke} />
              <Rect x={250} y={45} width={56} height={110} {...stroke} />
              <Rect x={-6} y={75} width={22} height={50} {...stroke} />
              <Rect x={284} y={75} width={22} height={50} {...stroke} />
            </>
          ) : sport === 'basketball' ? (
            <>
              <Circle cx={235} cy={150} r={115} {...stroke} />
              <Line x1={235} y1={35} x2={235} y2={265} {...stroke} />
              <Line x1={120} y1={150} x2={350} y2={150} {...stroke} />
              <Path d="M150 70 C 195 110, 195 190, 150 230" {...stroke} />
              <Path d="M320 70 C 275 110, 275 190, 320 230" {...stroke} />
            </>
          ) : sport === 'volleyball' ? (
            <>
              <Circle cx={235} cy={140} r={110} {...stroke} />
              <Path d="M235 30 C 190 90, 200 160, 260 248" {...stroke} />
              <Path d="M127 160 C 190 140, 260 150, 335 100" {...stroke} />
              <Path d="M150 70 C 210 95, 250 150, 240 250" {...stroke} />
            </>
          ) : (
            <>
              <Line x1={0} y1={200} x2={200} y2={0} {...stroke} />
              <Line x1={60} y1={200} x2={260} y2={0} {...stroke} />
              <Line x1={120} y1={200} x2={320} y2={0} {...stroke} />
            </>
          )}
        </G>
      </Svg>
    </View>
  );
}
