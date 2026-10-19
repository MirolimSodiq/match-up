import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { Oswald_600SemiBold, Oswald_700Bold } from '@expo-google-fonts/oswald';
import { Platform, type ViewStyle } from 'react-native';
import { type fontFamily, type ShadowLevel, shadowColor, shadows } from '../tokens';

type Shadow = Pick<ViewStyle, 'shadowColor' | 'shadowOpacity' | 'shadowRadius' | 'shadowOffset' | 'elevation'>;

/** Yumshoq soya (och mavzu): suzuvchi tab bar, faol segment, bottom sheet. */
export function shadow(level: ShadowLevel = 1): Shadow {
  const s = shadows[level];
  if (Platform.OS === 'android') return { elevation: s.elevation };
  return { shadowColor, shadowOpacity: s.opacity, shadowRadius: s.radius, shadowOffset: { width: 0, height: s.offsetY } };
}

/** `useFonts(fontAssets)` — `fontFamily` tokenlaridagi barcha shriftlar (Oswald + Inter, lotin va kirill). */
export const fontAssets = {
  Oswald_600SemiBold,
  Oswald_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} satisfies Record<(typeof fontFamily)[keyof typeof fontFamily], number>;
