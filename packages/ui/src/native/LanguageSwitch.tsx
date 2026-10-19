import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, radius, space, states } from '../tokens';
import { Chip, Divider, ListRow } from './primitives';

export interface LanguageOption<T extends string> {
  value: T;
  /** To'liq nom: "O'zbekcha", "Русский". */
  label: string;
  /** Qisqa kod: "UZ", "RU". */
  short: string;
}

export type LanguageSwitchVariant = 'chips' | 'hero' | 'rows';

/**
 * Til tanlash (faqat ko'rinish; saqlash va server sinxronlash — ilovada).
 * `chips` — oq pill'lar, `hero` — to'q fondagi ixcham kodlar (UZ/RU/EN), `rows` — sozlamalar ro'yxati.
 */
export function LanguageSwitch<T extends string>({
  options,
  value,
  onChange,
  variant = 'chips',
}: {
  options: readonly LanguageOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: LanguageSwitchVariant;
}) {
  if (variant === 'rows') {
    return (
      <View>
        {options.map((o, i) => (
          <View key={o.value}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              left={<Text style={styles.code}>{o.short}</Text>}
              title={o.label}
              accessory={o.value === value ? 'check' : 'radio'}
              onPress={() => onChange(o.value)}
            />
          </View>
        ))}
      </View>
    );
  }

  if (variant === 'hero') {
    return (
      <View style={[styles.row, styles.heroTrack]}>
        <Ionicons name="globe-outline" size={15} color={colors.onPrimaryMuted} style={styles.globe} />
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => [styles.heroItem, selected && styles.heroItemActive, pressed && { opacity: states.pressedOpacity }]}
            >
              <Text style={[styles.heroText, selected && styles.heroTextActive]}>{o.short}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={[styles.row, styles.wrap]}>
      {options.map((o) => (
        <Chip key={o.value} label={o.label} selected={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  code: { width: 28, fontFamily: fontFamily.bold, fontSize: 13, color: colors.textMuted },
  heroTrack: {
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.heroGlass,
    borderWidth: 1,
    borderColor: colors.heroGlassBorder,
  },
  globe: { marginHorizontal: 6 },
  heroItem: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  heroItemActive: { backgroundColor: colors.surface },
  heroText: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.onPrimary },
  heroTextActive: { color: colors.text },
});
