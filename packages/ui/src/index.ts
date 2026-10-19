/**
 * Match Up dizayn tizimi (React Native).
 *
 * - `@matchup/ui/tokens` — sof TS tokenlar (ranglar, sport ranglari, radius, spacing, tipografiya); RN'ga bog'lanmagan.
 * - `@matchup/ui` — tokenlar + RN komponentlar (tugmalar, chip'lar, segmented control, kartalar, bottom sheet, tab bar ...).
 */
export * from './tokens';
export { fontAssets, shadow } from './native/theme';
export { type UIConfig, UIProvider, useUI } from './native/UIProvider';
export * from './native/primitives';
export { AuthLayout } from './native/AuthLayout';
export { BottomSheet } from './native/BottomSheet';
export { FloatingTabBar, type FloatingTabBarProps } from './native/TabBar';
export { type LanguageOption, LanguageSwitch, type LanguageSwitchVariant } from './native/LanguageSwitch';
export { Markdown } from './native/Markdown';
export { Perforation } from './native/Perforation';
export { DayColumn, SportBlock, SportPill, TimelineDay } from './native/SportBlock';
export { SportIcon } from './native/SportIcon';
export { SportTexture } from './native/SportTexture';
