# Match Up — Player ilovasi

Expo (React Native, TypeScript) — o'yinchi ilovasi: login, discovery, waiver, to'lov, QR chipta.

| | |
|---|---|
| Navigatsiya | Expo Router (`src/app/` — har fayl ekran), `Stack.Protected` bilan auth/onboarding guard'lari |
| API | `openapi-fetch` + `@matchup/contracts` (`api/openapi.yaml` dan generatsiya qilingan tiplar) |
| Server state | TanStack Query (`src/api/queries.ts`) |
| i18n | i18next: `uz-Latn`, `ru`, `en` (`src/i18n/locales`); har so'rovda `Accept-Language` |
| Token'lar | `expo-secure-store` (web dev preview'da `localStorage`) |

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

Booking ekrani holatni har 2 soniyada so'raydi va `confirmed` bo'lgach to'lov brauzerini o'zi yopadi.

## Tekshiruv

```bash
cd apps/player && corepack pnpm typecheck
```

API kontrakti o'zgarsa tiplarni qayta generatsiya qiling:

```bash
corepack pnpm --filter @matchup/contracts generate
```

## Ma'lum cheklovlar

- API'da hamyon balansi uchun alohida endpoint yo'q — profil balansni `GET /v1/payment-methods?match_id=…` orqali oladi.
- `GET /v1/bookings/{id}` checkout URL'ni qaytarmaydi — "To'lov sahifasini ochish" faqat shu sessiyada yaratilgan booking uchun ishlaydi.
- Stripe (`checkout.type = sdk`), social login, push va WebSocket — keyingi iteratsiya.
