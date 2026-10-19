# Match Up — Player ilovasi

Expo (React Native, TypeScript) — o'yinchi ilovasi: login, discovery, waiver, to'lov, QR chipta.

| | |
|---|---|
| Navigatsiya | Expo Router (`src/app/` — har fayl ekran), `Stack.Protected` bilan auth/onboarding guard'lari |
| API | `openapi-fetch` + `@matchup/contracts` (`api/openapi.yaml` dan generatsiya qilingan tiplar) |
| Server state | TanStack Query (`src/api/queries.ts`) |
| i18n | i18next: `uz-Latn`, `ru`, `en` (`src/i18n/locales`); har so'rovda `Accept-Language` |
| Token'lar | `expo-secure-store` (web dev preview'da `localStorage`) |
| Dizayn | [`@matchup/ui`](../../packages/ui) — och asos + sport ranglari: barcha rang, shrift, radius, soya va holatlar tokenlarda (`@matchup/ui/tokens`); ekranlarda hex rang yo'q |

## Dizayn tizimi

- **Asos** — och fon `#F6F7FB` (tepasida yumshoq rangli gradient), oq va och kulrang konteynerlar (radius 16–20), asosiy pill tugma — to'q navy `#161B33`, matn `#12141A` / `#5F6675`.
- **Sport ranglari** (`sportColors(sport)`): futbol — ko'k `#1F4FD8`, basketbol — to'q sariq `#C2410C`, voleybol — binafsha `#6D28D9`. O'yin bloklari, match detail, booking va QR chipta shu rangda, oq matn va xira sport teksturasi (`SportTexture`: maydon chiziqlari / to'p choklari) bilan.
- Kontrast (WCAG AA) `packages/ui/src/tokens/index.ts` boshida hisoblab yozilgan: oq matn barcha sport ranglarida ≥ 5.2; sport fonidagi kichik pill'lar oqartirilmaydi, aksincha `sportShade` (to'qroq qatlam) bilan ≥ 7.
- **Shriftlar**: katta UPPERCASE sarlavha, vaqt va summalar — Oswald (`@expo-google-fonts/oswald`, lotin + kirill, `o'`/`g'` va `ПРОФИЛЬ` tekshirilgan); matn — Inter (`@expo-google-fonts/inter`).
- **Navigatsiya**: pastda suzuvchi shisha pill tab bar (`expo-blur`, faqat ikonalar, faol ikona to'q pill ichida); match detail, waiver, checkout va QR chipta — native bottom sheet (modal); booking — sport rangidagi sahifa.
- Umumiy komponentlar `@matchup/ui` da (Host ilovasi bilan umumiy): `PageTitle`, `SheetScreen`/`SheetHeader`, `Button` (primary/secondary/light/glass/ghost/danger, uzun matn sig'masa biroz kichrayadi), `IconButton`, `Card`, `Chip` (ikonali), `Badge`, `Notice`, `ListRow` (✓ / bo'sh doira / "+" / toggle), `Group`, `SegmentedControl`, `Avatar`, `Toast` (to'q pill), `DashedLine`.
- Discovery va "Bandlarim" — sana bo'yicha timeline (`groupByDay` + `DayGroup` + `MatchBlock`): chapda hafta kuni va sana doirada, o'ngda sport rangidagi bloklar.
- QR kod doim oq quti ichida, atrofida tinch zona bilan (skaner uchun); status bar — och ekranlarda to'q, login hero va booking sahifasida oq.

## Ishga tushirish

Avval backend ([apps/api](../api), port 3000) ishlab turgan bo'lsin. So'ng repo ildizida:

```bash
corepack pnpm install
```

```bash
cd apps/player && corepack pnpm exec expo start --ios
```

iOS Simulator uchun to'liq Xcode kerak (Command Line Tools yetarli emas). Ilova Expo Go'da ishlaydi.

API manzili avtomatik aniqlanadi: Metro qaysi kompyuterda bo'lsa, `http://<o'sha host>:3000`. Boshqa manzil kerak bo'lsa — `EXPO_PUBLIC_API_URL`.

Dev'da OTP kodi API logida `[DEV OTP]` qatorida chiqadi. Seed o'yinchilar: `+998 90 200 00 01` … `30` (waiver imzolangan).

### Payme to'lovini lokal tasdiqlash

Test kassa sahifasi lokal booking'ni ko'rmaydi, shuning uchun Payme chaqiruvlarini qo'lda yuboring (`<BOOKING_ID>` va `amount` — `POST /v1/bookings` javobidagi `booking.id` va `booking.total.amount`):

```bash
curl -s localhost:3000/v1/webhooks/payme -H "Authorization: Basic $(printf 'Paycom:payme_test_key' | base64)" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"CreateTransaction","params":{"id":"dev-<BOOKING_ID>","time":1760000000000,"amount":4500000,"account":{"booking_id":"<BOOKING_ID>"}}}'
```

```bash
curl -s localhost:3000/v1/webhooks/payme -H "Authorization: Basic $(printf 'Paycom:payme_test_key' | base64)" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"PerformTransaction","params":{"id":"dev-<BOOKING_ID>"}}'
```

To'lov sahifasi native'da ilova ichidagi WebView'da (`/booking/[id]/pay`) ochiladi. `return_url` ga yo'naltirish ushlanadi. `payme://`, `click://` va bank ilovalari havolalari tizimga beriladi, sahifa ochilmasa — tashqi brauzerga fallback. Ekran holatni har 2 soniyada so'raydi va `confirmed` bo'lgach o'zi yopiladi. Web build'da sahifa avvalgidek yangi oynada ochiladi.

## Tekshiruv

```bash
cd apps/player && corepack pnpm typecheck
```

API kontrakti o'zgarsa tiplarni qayta generatsiya qiling:

```bash
corepack pnpm --filter @matchup/contracts generate
```

## Ma'lum cheklovlar

- `GET /v1/bookings/{id}` checkout URL'ni qaytarmaydi — "To'lov sahifasini ochish" faqat shu sessiyada yaratilgan booking uchun ishlaydi.
- Stripe (`checkout.type = sdk`), social login, push va WebSocket — keyingi iteratsiya.
- "Kalendarga qo'shish" tizim oynasi orqali (`expo-calendar/legacy`, ruxsat so'ramaydi); web build'da tugma yashirilgan.
- Lint sozlanmagan (ESLint konfiguratsiyasi yo'q) — tekshiruv `typecheck` va `expo-doctor` orqali.
