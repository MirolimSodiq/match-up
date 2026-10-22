import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, states } from '@matchup/ui';

/** 1–5 yulduz. Har yulduz alohida tugma (ekran o'quvchida "4 yulduz"), tanlanganini qayta bosish o'zgartirmaydi. */
export function Stars({
  value,
  onChange,
  size = 30,
  label,
  disabled,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  /** Ekran o'quvchi uchun: nima baholanmoqda. */
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row} accessibilityLabel={label} accessible={disabled}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${t('rate.stars', { count: n })}`}
          accessibilityState={{ selected: n <= value, disabled }}
          disabled={disabled || !onChange}
          hitSlop={4}
          onPress={() => onChange?.(n)}
          style={({ pressed }) => pressed && { opacity: states.pressedOpacity }}
        >
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? colors.warning : colors.borderStrong} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
});
