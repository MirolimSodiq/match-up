# @matchup/ui — dizayn tizimi

Player va Host ilovalari uchun yagona dizayn tizimi: och asos, sport ranglari, Oswald + Inter, pill tugmalar, bottom sheet'lar va suzuvchi shisha tab bar.

| Import | Nima | Bog'liqlik |
|---|---|---|
| `@matchup/ui/tokens` | Ranglar, `sportColors()`, gradientlar, `space`, `radius`, `fontFamily` (+ web uchun `fontStacks`), matn uslublari (`type`), holatlar, soya darajalari, `navigationColors`, `readableOn()` | **Sof TypeScript** — RN/DOM'siz (web admin panel ham ishlatadi) |
| `@matchup/ui` | Tokenlar + React Native komponentlar | `react-native`, `expo-*` (peer) |

`tsconfig.tokens.json` tokenlarni DOM/RN tiplarisiz kompilyatsiya qiladi — `src/tokens` ga platforma importi tushib qolsa, `pnpm typecheck` yiqiladi.

## Komponentlar

- **Asos:** `Screen`, `ScreenGlow`, `Footer`, `PageTitle`, `SheetScreen` / `SheetHeader` (native modal ekranlar), `BottomSheet` (ekran ustidagi tezkor sheet).
- **Matn:** `Display`, `Title`, `H3`, `Body`, `Muted`, `Caption`, `Section`.
- **Boshqaruv:** `Button` (primary / secondary / light / glass / ghost / danger), `IconButton`, `Chip`, `SegmentedControl`, `Toggle`, `ListRow` (✓ / bo'sh doira / "+" / toggle), `Group`.
- **Ma'lumot:** `Card`, `Badge`, `Notice`, `Row`, `Divider` / `DashedLine`, `Avatar`, `Toast` (`ToastProvider` + `useToast`), `Loading`, `ErrorView`, `ErrorText`, `EmptyState`.
- **Navigatsiya:** `FloatingTabBar` (ikonalar xaritasi va ixtiyoriy badge'lar bilan; expo-router `Tabs` ning `tabBar` props'iga tushadi).
- **Sport:** `SportIcon`, `SportTexture`, `SportBlock` + `SportPill` (timeline'dagi sport rangidagi blok), `TimelineDay` / `DayColumn`, `Perforation` (chipta kesigi).
- **Kirish:** `AuthLayout` (to'q hero + oq sheet; `topRight` — til tanlash, `decor` — hero bezagi), `LanguageSwitch` (chips / hero / rows).
- **Boshqa:** `Markdown` (huquqiy matnlar), `shadow(level)`, `fontAssets` (`useFonts(fontAssets)`).

## i18n

Paket tarjimaga bog'lanmagan. Komponentlardagi umumiy matnlar ("Yopish", "Qayta urinish") va xato matni ilova ildizidagi `UIProvider` orqali beriladi:

```tsx
<UIProvider value={{ closeLabel: t('common.close'), retryLabel: t('common.retry'), formatError: (e) => errorMessage(t, e) }}>
```

## Qoidalar

- Ekranlarda hex rang yozilmaydi — faqat tokenlar. Server bergan ixtiyoriy rang (masalan, jamoa `bib_color`) ustidagi matn uchun `readableOn(hex)`.
- Kontrast (WCAG 2.1) hisob-kitobi `src/tokens/index.ts` boshida.
- Peer dependency'lar ilova bilan bir xil versiyada bo'lishi shart (pnpm ularni bitta nusxaga bog'laydi — aks holda Metro ikkita `react-native` yuklaydi).
