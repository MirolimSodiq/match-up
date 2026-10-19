import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../tokens';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
const SPORT_ICONS: Record<string, IconName> = { football: 'soccer', basketball: 'basketball', volleyball: 'volleyball' };

export function SportIcon({ sport, size = 20, color = colors.text }: { sport: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={sport === 'all' ? 'view-grid' : (SPORT_ICONS[sport] ?? 'whistle')} size={size} color={color} />;
}
