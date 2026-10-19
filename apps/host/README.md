# Match Up — Host ilovasi

Expo (React Native, TypeScript) — freelance Match Host'lar uchun: takliflar, o'yinlar, maydonda QR check-in (internetsiz ham), jamoalar va o'yinni yakunlash. Player ilovasidan alohida: kamera, joylashuv va offline saqlash ruxsatlari player'ga kerak emas.

| | |
|---|---|
| Bundle id | `uz.matchup.host` (iOS va Android), sxema `matchuphost` |
| Navigatsiya | Expo Router (`src/app/`), `Stack.Protected`: `login` / `not-host` / asosiy ilova |
| API | `openapi-fetch` + `@matchup/contracts`, 15 s timeout, refresh token rotation (player bilan bir xil) |
| Dizayn | `@matchup/ui` — player bilan bir xil tokenlar va komponentlar |
| i18n | `uz-Latn`, `ru`, `en` (`src/i18n/locales`) |
| Offline | `src/offline/` — QR tekshiruvi, event navbati, sinxron, disk keshi |

## Ekranlar

- **Login** — telefon + OTP. Kirgach `GET /v1/me` → `roles` da `host` bo'lmasa `not-host` ekrani ("Qayta tekshirish" / "Boshqa raqam bilan kirish").
- **Takliflar** (`GET /v1/host/offers`, har 20 s) — `offer_expires_at` gacha taymer, qabul / rad (sabab bilan). `OFFER_TAKEN`, `OFFER_EXPIRED`, `SCHEDULE_CONFLICT` — lokal matnlar.
- **O'yinlar** — `today | upcoming | past`. Yaqin 24 soatdagi o'yinlar roster'i oldindan diskka yuklanadi.
- **O'yin boshqaruvi** — "Maydondaman" (`POST .../arrive`, expo-location; `OUTSIDE_GEOFENCE` da masofa), sinxron banneri, QR skaner, jamoalar, yakunlash, ism bo'yicha check-in / undo / no-show.
- **QR skaner** — `expo-camera` (faqat QR). Dev rejimida payload'ni qo'lda kiritish maydoni (simulyator kamerasi QR o'qiy olmaydi).
- **Jamoalar** — bib rangidagi tugmalar, `PATCH .../participants/{pid}` (`side_no`), daraja bo'yicha avtomatik bo'lish.
- **Yakunlash** — har jamoa hisobi, MVP, incident'lar (`POST .../complete`). O'yin boshlanmaguncha yopiq; navbatda yuborilmagan check-in bo'lsa ham yopiq (aks holda server ularni no-show qilardi).
- **Sinxron jurnali** — har event natijasi: qabul / takror (`duplicate`) / rad (`rejected` + sabab).
- Highlight video — backend `501`, UI'da o'chirilgan "Tez orada" tugmasi.

## Offline check-in

1. **Roster keshi** — `GET .../roster` javobi (`qr_public_key`, `roster_version` bilan) `Documents/matchup-host/rosters.json` ga yoziladi; tarmoq bo'lmasa shu nusxa ishlatiladi.
2. **QR tekshiruvi** (`src/offline/qr.ts`) — `mu1.<base64url(JSON {p, m, e})>.<base64url(sig)>`, Ed25519 (`@noble/ed25519`, RFC 8032 qat'iy rejim — server/OpenSSL bilan bir xil), imzolangan xabar `"mu1.<body>"`. Tartib server bilan bir xil: imzo → match → muddat.
3. **Navbat** (`src/offline/store.ts`) — har amal `client_event_id` (UUID) va `occurred_at` bilan `queue.json` ga yoziladi va darhol lokal holatga qo'llanadi.
4. **Sinxron** (`src/offline/sync.ts`) — `POST .../checkins` ga 100 tadan batch; tarmoq/5xx/429 da backoff (2 s → 60 s), internet qaytsa, ilova ochilsa yoki har 30 s da qayta urinadi. Idempotent: qayta yuborilgan event serverda `duplicate`.
5. **Ekrandagi holat** (`src/offline/core.ts`, `applyEvents`) = server roster + hali roster'ga kirmagan event'lar (pending yoki roster olingandan keyin qabul qilinganlar). Rad etilganlari qo'llanmaydi, sababi ko'rsatiladi.

Ilova internetsiz ochilsa ham ishlaydi: oxirgi profil, o'yinlar ro'yxati va roster diskdan olinadi.

## Ishga tushirish

Backend ([apps/api](../api)) ishlab turgan bo'lsin. Repo ildizida `corepack pnpm install`, so'ng:

```bash
cd apps/host && corepack pnpm start
```

Dev server 8082-portda (player — 8081). API manzili Metro host'idan (`:3000`) olinadi; boshqa manzil kerak bo'lsa:

```bash
cd apps/host && EXPO_PUBLIC_API_URL=http://localhost:3002 corepack pnpm start
```

Expo Go'da ishlaydi (expo-camera, expo-location, expo-file-system, expo-network Expo Go'da bor). Seed host: `+998 90 111 00 02`, OTP — API logida `[DEV OTP]`.

### Simulyatorda sinash

- Joylashuv: `xcrun simctl location booted set 41.2756,69.2034` (Chilonzor Arena).
- QR: chipta matnini (`GET /v1/bookings/{id}/ticket` → `qr_payload`) skaner ekranidagi dev maydoniga qo'ying (`xcrun simctl pbcopy booted` + Paste).
- Internetsiz rejim: API'ni to'xtating yoki Profil → "Offline rejim (sinov)" (faqat dev).

## Tekshiruv

```bash
cd apps/host && corepack pnpm typecheck
```

```bash
cd apps/host && corepack pnpm test
```

Unit testlar (vitest) — `src/offline/*.test.ts`: QR tekshiruvi backend'dan olingan haqiqiy chipta bilan (`__fixtures__/ticket.json`), soxta/buzilgan/eskirgan/boshqa o'yin chiptalari, navbat holati, sinxron natijalari, backoff.

## Ma'lum cheklovlar

- Jamoaga bo'lish (`PATCH`) va "Maydondaman" internet talab qiladi (server tekshiruvi kerak).
- Ikonka va splash player'dagi standart Expo shablonidan — brend ikonkasi keyin.
- Auth (telefon/OTP qadamlari), API client va `lib/` player bilan takrorlanadi — umumiy paketga ajratish keyingi qadam.
