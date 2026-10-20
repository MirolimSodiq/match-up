# Match Up — Texnik arxitektura

> Pickup sports platformasi: admin maydon slotini ijaraga oladi → match yaratadi → o'yinchilar bittadan joy sotib oladi → match to'lganda freelance **Match Host** chaqiriladi → host check-in qiladi, o'yinni boshqaradi, highlight yozadi.
> Birinchi bozor: **O'zbekiston** (UZS, Payme / Click / Uzum). Keyin xalqaro (Stripe, Apple Pay, PayPal) va Super App (Teams, Leagues, Tournaments, AI highlight).

| Artefakt | Fayl | Holat |
|---|---|---|
| MVP DB sxemasi | [`db/migrations/0001_core_mvp.sql`](../db/migrations/0001_core_mvp.sql) | PostgreSQL 18 + PostGIS 3.6'da tekshirilgan |
| Phase 2 migratsiyasi | [`db/migrations/0002_phase2_competitions.sql`](../db/migrations/0002_phase2_competitions.sql) | Mavjud ma'lumotlar ustiga tekshirilgan |
| Kritik query'lar | [`db/queries/`](../db/queries/) | discovery, hold, confirm, expire, cancel, dispatch |
| Avtomatik tekshiruv | [`db/tests/verify.sh`](../db/tests/verify.sh) | oversell race, constraint'lar, Phase 2 |
| API kontrakti | [`api/openapi.yaml`](../api/openapi.yaml) | OpenAPI 3.1, 45 ta operation, Redocly lint toza |

---

## 0. Asosiy qarorlar (qisqacha)

| # | Qaror | Nima uchun |
|---|---|---|
| 1 | **React Native (Expo) + NestJS — hammasi TypeScript** | Bitta til: tiplar, validatsiya (zod) va API client mobile ↔ backend o'rtasida umumiy. Kichik jamoa uchun eng tez MVP. |
| 2 | **Modular monolith**, microservice emas | 3–6 dasturchili jamoaga microservice'lar operatsion yuk. Modul chegaralari + outbox event'lar keyinroq ajratishni arzon qiladi. |
| 3 | **Video/AI — alohida Python servisi** birinchi kundan | FFmpeg/PyTorch ekotizimi Python'da; og'ir CPU/GPU ishi API latency'siga ta'sir qilmasligi kerak. |
| 4 | **PostgreSQL + PostGIS** yagona haqiqat manbai | Pul va joylar uchun ACID; oversell, ikki marta ijara, ikki marta to'lov DB constraint'lari bilan imkonsiz. |
| 5 | **Joy band qilish = atomik shartli UPDATE** (Redis lock emas) | 30 parallel so'rovda 14 joyga aniq 14 booking — test bilan isbotlangan. Bitta komponent kam = bitta nosozlik nuqtasi kam. |
| 6 | **MVP — managed AWS (Frankfurt), dizayn — cell-based** | 2026-yil mart o'zgarishidan keyin UZ foydalanuvchilarining (biometrikdan tashqari) ma'lumotlarini adekvat davlatda saqlash mumkin; Germaniya ro'yxatda. Cell pattern boshqa davlatlarning lokalizatsiya talablari uchun saqlanadi (§4.3). |
| 7 | **Payment adapter pattern** | Payme/Click/Uzum (merchant-API) va Stripe (async webhook) bitta ichki state machine'ga normalizatsiya. |
| 8 | **Roster ≠ to'lov** (`match_participants` ≠ `bookings`) | Mehmonlar, admin taklifi, walk-in va Phase 2 jamoa roster'i — hammasi bitta check-in oqimidan o'tadi. |

---

## 1. Tech stack

### 1.1 Mobile: React Native vs Flutter

| Mezon | React Native (Expo, TS) | Flutter (Dart) |
|---|---|---|
| Backend bilan kod ulashish | ✅ tiplar, zod sxemalar, OpenAPI'dan generatsiya qilingan client | ❌ alohida til, alohida modellar |
| OTA hotfix (store review'siz) | ✅ EAS Update | ⚠️ rasmiy yechim yo'q (Shorebird — 3rd party) |
| QR skaner + video yozish | ✅ `react-native-vision-camera` (code scanner + recording) | ✅ `camera`, `mobile_scanner` |
| Performance | ✅ New Architecture (Fabric/JSI) — bu ilova uchun yetarli (ro'yxat, xarita, forma) | ✅ biroz yaxshiroq animatsiya |
| O'zbekistonda yollash | ✅ JS/TS dasturchilar ko'p | ⚠️ kamroq |
| Admin panel bilan umumiy | ✅ React (Next.js) | ❌ |

**Tanlov: React Native + Expo (TypeScript).** Ikki app bitta monorepoda:

- **Player app** — discovery, booking, to'lov, chipta, highlight feed.
- **Host app** — offer'lar, offline roster, QR check-in, geofence, video yozish/yuklash. Alohida app, chunki kamera, background location va offline storage ruxsatlari player'ga kerak emas (App Store/Play review shuni so'raydi) va host oqimi butunlay boshqa.

### 1.2 Backend: Node.js (NestJS) vs Python (FastAPI)

| Mezon | NestJS (TS) | FastAPI (Python) |
|---|---|---|
| Mobile/admin bilan bitta til | ✅ | ❌ |
| Modul chegaralari, DI, guard'lar | ✅ framework'ning asosi | ⚠️ qo'lda tuziladi |
| I/O-heavy API (booking, webhook, WebSocket) | ✅ event loop'ga mos | ✅ async |
| Video / ML / AI | ❌ zaif ekotizim | ✅ FFmpeg, PyTorch, OpenCV |

**Tanlov: ikkalasi, har biri o'z joyida.**
- **Core API — NestJS (Node 22 LTS)** + **Drizzle ORM** (SQL-first: PostGIS, `FOR UPDATE`, partial index, CTE'larni yashirmaydi). Migratsiyalar — toza SQL fayllar (`db/migrations`).
- **Media worker'lar — Python** (FastAPI faqat health/admin endpointlari uchun; asosiy ish — navbatdan job olish). Core bilan faqat navbat (SQS / Redis Streams) va object storage orqali gaplashadi.

### 1.3 Ma'lumotlar, kesh, real-time

| Qatlam | Tanlov | Vazifasi |
|---|---|---|
| Asosiy DB | **PostgreSQL 18 + PostGIS 3.6** | Barcha biznes ma'lumotlar. Native `uuidv7()`, `EXCLUDE` constraint, composite GiST (geo + vaqt). |
| Kesh / navbat / rate-limit | **Valkey (Redis-mos)** + **BullMQ** | OTP challenge'lar (TTL), rate limit, discovery keshi, delayed job'lar (hold expiry, dispatch timeout, eslatmalar). |
| Real-time | **Socket.IO** (NestJS gateway + Redis adapter) | `match:{id}` → bo'sh joylar soni; `booking:{id}` → to'lov holati; host'ga offer'lar. |
| Push / SMS / OTP | Expo Push (FCM/APNs), **Eskiz.uz** SMS, **Telegram Gateway API** | O'zbekistonda Telegram orqali OTP SMS'dan arzon va ishonchli; SMS — zaxira. |
| Object storage | **AWS S3 + CloudFront** (Frankfurt); biometrik ma'lumot paydo bo'lsa — O'zbekiston ichidagi S3-mos storage | S3 API standart — kod o'zgarmasdan boshqa storage'ga ko'chiriladi. |
| Qidiruv | PostGIS (MVP) → OpenSearch (faqat full-text/feed kerak bo'lganda) | MVP'da alohida qidiruv klasteri keraksiz. |
| Observability | OpenTelemetry → Grafana (Prometheus, Loki, Tempo), Sentry, PostHog (EU Cloud) | Analytics ham shaxsiy ma'lumot — adekvat ro'yxatdagi davlatda (EU) saqlanadi. |

### 1.4 Monorepo tuzilmasi

```
matchup/
├── apps/
│   ├── api/            # NestJS modular monolith
│   ├── player/         # Expo (React Native) — o'yinchi app
│   ├── host/           # Expo — host app (offline-first)
│   └── admin/          # Next.js (App Router) + TanStack Query/Table — ichki panel, BFF (httpOnly cookie)
├── services/
│   └── media-worker/   # Python: FFmpeg transcode, keyin AI highlight
├── packages/
│   ├── contracts/      # openapi.yaml → generatsiya qilingan TS client + zod
│   ├── ui/             # umumiy dizayn tizimi: sof TS tokenlar (/tokens, web ham) + RN komponentlar
│   └── i18n/           # tarjima kalitlari (uz-Latn, uz-Cyrl, ru, en)
├── db/                 # SQL migratsiyalar, seed, query'lar, testlar
└── infra/              # Terraform + Helm (har cell uchun)
```

pnpm workspaces + Turborepo. API kontrakti o'zgarsa — client bitta PR'da qayta generatsiya qilinadi, CI tiplar mos kelmasa yiqiladi.

---

## 2. Ma'lumotlar bazasi

### 2.1 Konvensiyalar

| Mavzu | Qoida |
|---|---|
| Primary key | `uuid DEFAULT uuidv7()` — vaqt bo'yicha tartiblangan (B-tree'ga do'st, ID'dan yaratilish vaqti ko'rinadi, taxmin qilib bo'lmaydi). Reference jadvallar: `smallint`/`integer` identity. |
| Pul | `bigint` **minor units** + `char(3)` valyuta. UZS → tiyin (Payme ham tiyin'da ishlaydi). Hech qachon `float`/`numeric` emas. |
| Vaqt | `timestamptz` (UTC). Ko'rsatish — venue `timezone` bo'yicha, qurilma vaqt zonasi bo'yicha emas. |
| Tarjima | `jsonb`: `{"uz-Latn": "...", "uz-Cyrl": "...", "ru": "...", "en": "..."}`. O'qish: `coalesce(title->>$locale, title->>'uz-Latn')`. |
| Status | Postgres `ENUM` (tartibli: `skill_level` uchun `<`/`>` ishlaydi). |
| Invariantlar | App kodida emas, **DB constraint**'larida: CHECK, partial UNIQUE, EXCLUDE, FK. App xatoni Problem `code`'ga o'giradi. |
| Append-only | `waiver_signatures`, `consents`, `checkin_events`, `wallet_transactions`, `audit_logs` — UPDATE/DELETE trigger bilan bloklangan. |
| Modul egaligi | Har jadval bitta NestJS moduliga tegishli; boshqa modullar unga faqat o'sha modulning service'i orqali yozadi. |

### 2.2 ER diagramma (MVP yadrosi)

```mermaid
erDiagram
    USERS ||--o{ USER_ROLES : has
    USERS ||--o{ AUTH_IDENTITIES : "logs in via"
    USERS ||--o{ PLAYER_SPORT_PROFILES : "plays at level"
    USERS ||--o| HOST_PROFILES : "may be"
    CITIES ||--o{ VENUES : contains
    VENUES ||--o{ PITCHES : has
    PITCHES ||--o{ FIELD_LEASES : "leased as"
    FIELD_LEASES ||--o| MATCHES : "hosts"
    PITCHES ||--o{ MATCHES : "played on"
    MATCHES ||--|{ MATCH_SIDES : "split into"
    MATCHES ||--o{ BOOKINGS : "sold via"
    USERS ||--o{ BOOKINGS : pays
    WAIVER_TEMPLATES ||--o{ WAIVER_SIGNATURES : "signed as"
    WAIVER_SIGNATURES ||--o{ BOOKINGS : "required by"
    BOOKINGS ||--o{ PAYMENTS : "paid by"
    PAYMENTS ||--o{ PAYMENT_EVENTS : "webhooks"
    BOOKINGS ||--o{ REFUNDS : "refunded by"
    BOOKINGS ||--o{ MATCH_PARTICIPANTS : "creates seats"
    MATCHES ||--o{ MATCH_PARTICIPANTS : roster
    MATCH_SIDES ||--o{ MATCH_PARTICIPANTS : "team of"
    MATCHES ||--o{ HOST_ASSIGNMENTS : "dispatched to"
    HOST_PROFILES ||--o{ HOST_ASSIGNMENTS : accepts
    MATCH_PARTICIPANTS ||--o{ CHECKIN_EVENTS : "checked in"
    MATCHES ||--o{ HIGHLIGHTS : has
    MEDIA_ASSETS ||--|| HIGHLIGHTS : "stored as"
    HIGHLIGHTS ||--o{ HIGHLIGHT_REACTIONS : liked
```

### 2.3 Jadvallar ma'lumotnomasi (MVP — 47 jadval)

| Modul | Jadval | PK | Asosiy FK / constraint | Vazifa |
|---|---|---|---|---|
| Reference | `currencies` | `code char(3)` | — | `minor_unit` (UZS=2) |
| | `countries` | `code char(2)` | → currencies | `data_region` (qaysi cell), default locale |
| | `cities` | `id int` | → countries, currencies | IANA `timezone`, `center geography` |
| | `sports` | `id smallint` | `code` UNIQUE | default jamoa hajmi |
| | `fx_rates` | (base, quote, as_of) | → currencies | faqat hisobot |
| Identity | `users` | uuid | → countries, cities, media_assets | `phone_e164` UNIQUE, `data_region`, soft delete + `anonymized_at` |
| | `user_roles` | (user_id, role) | → users | M:N: player + host + admin |
| | `auth_identities` | uuid | UNIQUE (provider, provider_uid) | phone / google / apple / telegram |
| | `user_sessions` | uuid | `refresh_token_hash` UNIQUE, `family_id` | rotation + reuse detection |
| | `device_tokens` | uuid | `push_token` UNIQUE | push, locale |
| Profile | `player_sport_profiles` | (user_id, sport_id) | → users, sports | self_level, Glicko `rating`, no_show_count |
| Catalog | `venues` | uuid | → cities; GiST(location) | stadion, partner kontakti |
| | `amenities`, `venue_amenities` | id / (venue, amenity) | | filtr: parking, shower... |
| | `pitches`, `pitch_sports` | uuid / (pitch, sport) | UNIQUE (venue_id, name) | maydon: sirt, indoor, o'lcham |
| | `field_leases` | uuid | → pitches; **EXCLUDE (pitch_id =, period &&)** | ijara, `cost_amount` (unit economics) |
| Matches | `cancellation_policies` | smallint | `rules jsonb` | refund qoidalari |
| | `waiver_templates` | uuid | UNIQUE (code, version, locale) | matn o'zgarmas, `body_sha256` trigger |
| | `matches` | uuid | → sports, pitches, field_leases, cities; **CHECK held+confirmed ≤ max**; GiST (location, starts_at) | narx, sig'im, status, deadline'lar |
| | `match_sides` | (match_id, side_no) | → matches | Oranges/Blues, bib rangi, hisob |
| | `waiver_signatures` | uuid | → users, waiver_templates; append-only | hash snapshot, IP, UA, guardian |
| | `match_participants` | uuid | → matches, bookings, users, (match, side); **partial UNIQUE (match_id, user_id)** | roster: held → confirmed → checked_in |
| | `match_waitlist` | uuid | partial UNIQUE (match, user) | navbat |
| Booking | `bookings` | uuid | → users, matches, waiver_signatures; **exclusive-arc CHECK**, summa CHECK, waiver CHECK | to'lovchi, hold `expires_at` |
| Payments | `payment_provider_configs` | smallint | UNIQUE (country, provider) | routing, `secret_ref` (secret DB'da emas) |
| | `payments` | uuid | → bookings; UNIQUE (provider, provider_transaction_id); partial UNIQUE bitta muvaffaqiyatli to'lov | `provider_state jsonb` (Payme vaqtlari) |
| | `payment_events` | uuid | **UNIQUE (provider, provider_event_id)** | webhook inbox, dedupe |
| | `refunds` | uuid | → payments, bookings | original_method / wallet |
| | `wallet_accounts`, `wallet_transactions` | uuid | balance ≥ 0; append-only ledger | tezkor refund, kredit |
| Compliance | `consents` | uuid | append-only; view `user_current_consents` | marketing, analytics, **media_appearance** |
| | `data_subject_requests` | uuid | `due_at = +30 kun` | GDPR export / erasure |
| | `audit_logs` | bigint | append-only | admin harakatlari |
| Host ops | `host_profiles` | user_id | → users; GiST(base_location) | kit, reyting, payout (tokenized) |
| | `host_sports` | (user, sport) | | qaysi sportlarni olib boradi |
| | `host_assignments` | uuid | **partial UNIQUE (match_id) faol statuslar** | offer → accept → arrive → complete |
| | `checkin_events` | uuid | `client_event_id` UNIQUE; append-only | offline sync, GPS |
| | `host_payouts` | uuid | UNIQUE (host, period) | davriy to'lov |
| | `match_feedback` | uuid | UNIQUE NULLS NOT DISTINCT | host/o'yinchi/venue reytingi |
| Media | `media_assets` | uuid | UNIQUE (bucket, object_key) | `storage_region`, multipart `upload_id` |
| | `highlights` | uuid | → matches, media_assets (1:1) | offset, visibility, moderatsiya, counter'lar |
| | `highlight_tags`, `highlight_reactions`, `highlight_shares` | composite / uuid | | teg (consent bilan), like, share |
| Platform | `notifications` | uuid | | yuborilgan xabarlar tarixi |
| | `outbox_events` | uuid | partial index unpublished | transactional outbox |

To'liq DDL (har bir ustun, tip, default, index): [`0001_core_mvp.sql`](../db/migrations/0001_core_mvp.sql).

### 2.4 Kritik mexanizmlar

#### a) Oversell'ning oldini olish — atomik seat hold

```sql
WITH hold AS (
  UPDATE matches
     SET held_slots = held_slots + :seats
   WHERE id = :match_id
     AND status = 'open'
     AND now() < booking_closes_at
     AND held_slots + confirmed_slots + :seats <= max_players     -- shart row lock ostida qayta tekshiriladi
  RETURNING id, price_amount, currency
), b AS (
  INSERT INTO bookings (..., expires_at) SELECT ..., now() + interval '15 minutes' FROM hold
  RETURNING id, match_id, user_id
)
INSERT INTO match_participants (match_id, booking_id, user_id, status) SELECT match_id, id, user_id, 'held' FROM b;
```

- READ COMMITTED'da parallel UPDATE'lar `matches` qatorida navbatga turadi; har biri WHERE'ni **yangi** qiymat bilan qayta baholaydi (EvalPlanQual). Natija: 0 qator → `409 MATCH_FULL`.
- Ikkinchi himoya: `CHECK (held_slots + confirmed_slots <= max_players)`.
- Bitta odam ikki marta yozilsa — partial UNIQUE index → butun statement rollback → `409 ALREADY_BOOKED`.
- **Isbot:** `verify.sh` 30 ta parallel client'ni 14 joyli match'ga yuboradi → aniq 14 booking, 14 roster qatori; ikkinchi to'lqinda 3 bo'sh joyga aniq 3 ta.
- Hot row: bitta match'ga daqiqasiga yuzlab so'rov bo'lmaydi (max 14–22 joy), shuning uchun bitta qator lock'i muammo emas. Redis lock qo'shish faqat yangi nosozlik nuqtasi bo'lardi.

#### b) Hold → to'lov → tasdiqlash / muddat o'tishi

| Hodisa | Query | Natija |
|---|---|---|
| To'lov muvaffaqiyatli | [`confirm_payment.sql`](../db/queries/confirm_payment.sql) | `held → confirmed`, `confirmed_slots == max` bo'lsa `status = full` + `MatchFull` outbox event |
| Takroriy webhook | o'sha query | `status IN ('created','pending')` sharti → 0 qator, holat o'zgarmaydi (idempotent, test qilingan) |
| 15 daqiqa o'tdi | [`expire_holds.sql`](../db/queries/expire_holds.sql) (BullMQ, har 30 s) | `expired`, joylar qaytadi, `SlotsReleased` → waitlist |
| Sweeper va webhook poygasi | ikkalasi `WHERE status = 'pending_payment'` | faqat bittasi yutadi; webhook yutqazsa → "late payment" yo'li |
| O'yinchi bekor qildi | [`cancel_booking.sql`](../db/queries/cancel_booking.sql) | joy qaytadi, `full → open`, refund policy bo'yicha |

**Late payment** (pul yechildi, lekin hold allaqachon o'tgan): joy bo'lsa qayta hold + confirm; bo'lmasa avtomatik refund (wallet'ga darhol yoki kartaga) + push. Payme/Click/Uzum'da bu deyarli bo'lmaydi — ular pul yechishdan **oldin** bizdan so'raydi (`CheckPerformTransaction` / `Prepare`), va biz shu yerda hold'ni qayta tekshiramiz.

#### c) Ikki marta ijaraga olishning oldini olish

```sql
CONSTRAINT field_leases_no_overlap EXCLUDE USING gist (pitch_id WITH =, period WITH &&)
  WHERE (status <> 'cancelled')
```
`[19:00, 20:30)` va `[20:30, 22:00)` — ruxsat (tutash), `[19:30, 21:00)` — rad etiladi. Ikkalasi testda tekshirilgan.

#### d) Roster to'lovdan alohida

`bookings` — **kim to'ladi** (1 ta checkout, 1–4 joy). `match_participants` — **kim o'ynaydi** (har joy uchun bitta qator: o'zi, mehmon `guest_name` bilan, admin taklifi, host walk-in, Phase 2'da jamoa a'zosi). Check-in, no-show statistikasi, jamoalarga bo'lish, reyting — hammasi roster ustida ishlaydi va to'lov turidan bexabar.

#### e) Compliance DB darajasida

- `bookings_waiver_required`: imzosiz match booking'i **yaratib bo'lmaydi** (app'dagi bug ham buni chetlab o'ta olmaydi).
- `waiver_templates` matni o'zgarmas — o'zgartirish faqat yangi `version` orqali; imzoda `document_sha256` snapshot.
- `consents` append-only — "foydalanuvchi qachon nimaga rozi bo'lgan" tarixi yo'qolmaydi.

### 2.5 State machine'lar

```mermaid
stateDiagram-v2
    direction LR
    state "Match" as M {
        [*] --> draft
        draft --> open: admin publish
        open --> full: confirmed = max
        full --> open: bekor qilish
        open --> in_progress: kick-off
        full --> in_progress: kick-off
        in_progress --> completed: host complete
        draft --> cancelled
        open --> cancelled: admin / min_players deadline
        full --> cancelled: admin (ob-havo, venue)
    }
```

```mermaid
stateDiagram-v2
    direction LR
    state "Booking" as B {
        [*] --> pending_payment: hold (15 daq)
        pending_payment --> confirmed: payment succeeded
        pending_payment --> expired: hold muddati
        pending_payment --> cancelled: provider cancel
        confirmed --> cancelled: user / match bekor
        confirmed --> completed: match completed
    }
    state "Payment" as P {
        [*] --> created
        created --> pending: provider tranzaksiya ochdi
        pending --> succeeded
        pending --> failed
        pending --> cancelled
        created --> expired
        succeeded --> partially_refunded
        succeeded --> refunded
        partially_refunded --> refunded
    }
```

```mermaid
stateDiagram-v2
    direction LR
    state "HostAssignment" as H {
        [*] --> offered: dispatch
        offered --> accepted: birinchi accept yutadi
        offered --> declined
        offered --> expired: 10 daqiqa
        accepted --> arrived: geofence ≤ 200 m
        accepted --> no_show
        accepted --> cancelled
        arrived --> completed: natija kiritildi
    }
```

Har bir o'tish — bitta servis metodi, bitta tranzaksiya, bitta outbox event. Ruxsat etilmagan o'tish → `409 Conflict`.

### 2.6 Phase 2: Teams, Leagues, Tournaments — core'ni qayta yozmasdan

[`0002_phase2_competitions.sql`](../db/migrations/0002_phase2_competitions.sql) **faqat qo'shadi**:

```mermaid
erDiagram
    TEAMS ||--o{ TEAM_MEMBERS : has
    USERS ||--o{ TEAM_MEMBERS : "member of"
    COMPETITIONS ||--o{ COMPETITION_ENTRIES : registers
    TEAMS ||--o{ COMPETITION_ENTRIES : enters
    COMPETITION_ENTRIES ||--o{ BOOKINGS : "entry fee via (same table)"
    COMPETITIONS ||--o{ MATCHES : "fixtures (same table)"
    TEAMS ||--o{ MATCH_SIDES : "plays as (same table)"
    MATCHES ||--o{ MATCH_EVENTS : "goals, cards"
    MEDIA_ASSETS ||--o{ MEDIA_PROCESSING_JOBS : "AI jobs"
```

| Phase 2 ehtiyoji | Qanday yechiladi | Core'dagi o'zgarish |
|---|---|---|
| Liga o'yini | oddiy `matches` qatori + `competition_id`, `round_label` | 2 ta nullable ustun |
| Jamoa vs jamoa | `match_sides.team_id` | 1 ta nullable ustun |
| Jamoa ro'yxatdan o'tish to'lovi | `bookings.bookable_type = 'competition_entry'` | enum qiymati + ustun + CHECK almashtirish |
| Jamoa a'zolari check-in | `match_participants.source = 'team_roster'` | enum qiymati |
| Statistika, AI timestamp | yangi `match_events` | — |
| Turnir jadvali | `competition_standings` view | — |

Checkout servisi `Bookable` interfeysi orqali ishlaydi — yangi tur = yangi strategiya klassi, booking/payment kodi tegilmaydi:

```ts
interface Bookable {
  readonly type: 'match_slot' | 'competition_entry';
  quote(ctx: QuoteCtx): Promise<{ unitPrice: Money; seats: number; waiverRequired: boolean }>;
  hold(tx: Tx, booking: NewBooking): Promise<void>;     // match: atomik seat hold; entry: entry status
  confirm(tx: Tx, bookingId: string): Promise<void>;
  release(tx: Tx, bookingId: string, reason: ReleaseReason): Promise<void>;
}
```

**Tekshirilgan:** `0002` seed ma'lumotlari ustiga qo'llandi → mavjud booking'larning md5 hash'i o'zgarmadi; `competition_entry` booking + payment o'sha jadvallarda yaratildi; exclusive-arc noto'g'ri kombinatsiyani rad etdi; standings view g'olibga 3 ochko berdi.

### 2.7 Index va masshtab

| Query | Index | O'lchov |
|---|---|---|
| Discovery (geo + vaqt + status) | `matches_discovery_gix` — GiST `(location, starts_at)`, partial `status IN ('open','full') AND visibility='public'` | 50 000 match'da index ishlatiladi (verify.sh tekshiradi) |
| Mening booking'larim | `bookings (user_id, created_at DESC)` | |
| Hold sweeper | `bookings (expires_at) WHERE status = 'pending_payment'` | faqat faol hold'lar indekslanadi |
| Dispatch | `host_profiles` GiST `(base_location) WHERE status = 'active'` | |
| Webhook dedupe | `payment_events UNIQUE (provider, provider_event_id)` | |

Keyingi bosqichlar (faqat metrikalar talab qilganda): read replica (discovery, feed) → `audit_logs`, `checkin_events`, `notifications`, `payment_events` oylik partition → eski partition'larni arxivga.

---

## 3. Core API (MVP)

To'liq kontrakt: [`api/openapi.yaml`](../api/openapi.yaml). Undan `packages/contracts` TS client'ni generatsiya qiladi.

### 3.1 Konvensiyalar

| Mavzu | Qoida |
|---|---|
| Versiya | URL'da: `/v1/...` |
| Auth | `Authorization: Bearer <JWT>` — EdDSA, access 15 daq; refresh token rotation, eski token qayta ishlatilsa butun `family_id` bekor |
| Xatolar | RFC 9457 `application/problem+json` + `code` (`MATCH_FULL`, `ALREADY_BOOKED`, `WAIVER_REQUIRED`, `OUTSIDE_GEOFENCE`...) |
| Pul | `{"amount": 4500000, "currency": "UZS", "formatted": "45 000 so'm"}` |
| Idempotency | `Idempotency-Key` (UUID) — `POST /bookings`, `/cancel`, admin bekor qilish; 24 soat Redis + `bookings UNIQUE (user_id, idempotency_key)` |
| Pagination | `cursor` + `limit` → `next_cursor` (keyset: `(starts_at, id)`) |
| Til | `Accept-Language` → `user.locale` → shahar default |
| Rate limit | OTP: telefon 1/60s, 5/soat; IP 20/soat. Umumiy: user 300/daq |

### 3.2 Endpointlar

**Auth & profil**

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/v1/auth/otp/request` | `{phone, channel: sms\|telegram}` | `{challenge_id, expires_in, resend_after}` |
| POST | `/v1/auth/otp/verify` | `{challenge_id, code, device}` | `{access_token, refresh_token, expires_in, user, is_new_user}` |
| POST | `/v1/auth/social` | `{provider: google\|apple\|telegram, id_token \| telegram_auth, device}` | o'sha |
| POST | `/v1/auth/refresh` | `{refresh_token}` | yangi token juftligi |
| POST | `/v1/auth/logout` | — | 204 |
| GET / PATCH | `/v1/me` | `{display_name, locale, home_city_id, birth_date, gender}` | `User` |
| PUT | `/v1/me/sports/{sport}` | `{self_level, preferred_position}` | `SportProfile` |
| PUT | `/v1/me/consents` | `{consents: [{purpose, granted, document_version}]}` | joriy holat |
| POST | `/v1/me/data-export` | — | 202 `DataSubjectRequest` |
| DELETE | `/v1/me` | — | 202 (30 kun grace → anonimlashtirish) |

Onboarding: `otp/verify` → `is_new_user: true` → `PATCH /me` (ism, shahar) → `PUT /me/sports/football` → `PUT /me/consents` (terms, privacy majburiy; marketing, media_appearance ixtiyoriy).

**Discovery**

| Method | Path | Izoh |
|---|---|---|
| GET | `/v1/matches?lat&lng&radius_km&sport&date_from&date_to&min_slots&price_max&level&sort&cursor&limit` | [`discovery.sql`](../db/queries/discovery.sql) |
| GET | `/v1/matches/{id}` | roster preview (faqat ism/avatar), waiver holati, `my_booking` |
| POST / DELETE | `/v1/matches/{id}/waitlist` | to'la match uchun navbat |
| GET | `/v1/venues/{id}`, `/v1/sports`, `/v1/cities` | CDN keshlanadi |
| WS | `match:{id}` → `slots.updated` | live bo'sh joylar |

```json
GET /v1/matches?lat=41.2995&lng=69.2401&radius_km=15&sport=football&min_slots=1
{
  "items": [{
    "id": "01a14af9-734c-7ed5-a7de-75db4109f156",
    "public_code": "MU-RACE",
    "sport": "football",
    "format": "7v7",
    "starts_at": "2026-10-18T14:00:00Z",
    "ends_at": "2026-10-18T15:30:00Z",
    "timezone": "Asia/Tashkent",
    "price": { "amount": 4500000, "currency": "UZS", "formatted": "45 000 so'm" },
    "slots": { "max": 14, "min_to_play": 10, "taken": 13, "available": 1 },
    "status": "open",
    "host_assigned": false,
    "venue": { "id": "…", "name": "Chilonzor Arena", "distance_m": 4062,
               "location": { "lat": 41.2756, "lng": 69.2034 } }
  }],
  "next_cursor": "MjAyNi0xMC0xOFQxNDowMDowMFp8MDFhMTRhZjk…"
}
```

**Booking & to'lov**

| Method | Path | Izoh |
|---|---|---|
| GET | `/v1/waivers/required?match_id` | user tilidagi oxirgi versiya + `signed` |
| POST | `/v1/waivers/{template_id}/signatures` | `{accepted, method, document_sha256, guardian?}` |
| GET | `/v1/payment-methods?match_id` | priority bo'yicha + wallet balansi |
| POST | `/v1/bookings` | hold + checkout (pastda) |
| GET | `/v1/bookings/{id}` | to'lovdan qaytgach polling (yoki WS `booking:{id}`) |
| POST | `/v1/bookings/{id}/cancel` | policy bo'yicha refund natijasi |
| GET | `/v1/bookings/{id}/ticket` | Ed25519 imzolangan QR payload |
| GET | `/v1/me/bookings?scope=upcoming\|past` | |
| POST | `/v1/webhooks/payme` | JSON-RPC: `CheckPerformTransaction`, `CreateTransaction`, `PerformTransaction`, `CancelTransaction`, `CheckTransaction`, `GetStatement` |
| POST | `/v1/webhooks/click/prepare`, `/complete` | form-urlencoded, MD5 `sign_string` |
| POST | `/v1/webhooks/uzum/{check\|create\|confirm\|reverse\|status}` | Basic auth |
| POST | `/v1/webhooks/stripe` | `Stripe-Signature` |

```json
POST /v1/bookings            Idempotency-Key: 8b1f…
{ "match_id": "01a1…", "seats": 1, "payment_method": "payme",
  "use_wallet": false, "waiver_signature_id": "01a1…", "return_url": "matchup://bookings/return" }

201 Created
{ "booking":  { "id": "01a1…", "status": "pending_payment", "expires_at": "2026-10-18T09:15:00Z",
                "total": { "amount": 4500000, "currency": "UZS", "formatted": "45 000 so'm" } },
  "checkout": { "type": "redirect", "provider": "payme",
                "url": "https://checkout.paycom.uz/<base64(m=…;ac.booking_id=…;a=4500000;c=…)>" } }
```

Stripe uchun `checkout = {type: "sdk", client_secret, publishable_key, ephemeral_key}` (Payment Sheet + Apple Pay / Google Pay); wallet to'liq yopsa `{type: "none"}` va booking darhol `confirmed`.

```mermaid
sequenceDiagram
    autonumber
    participant App as Player app
    participant API as API (Booking + Payments)
    participant DB as PostgreSQL
    participant PM as Payme
    App->>API: POST /bookings (Idempotency-Key)
    API->>DB: waiver tekshirish + atomik hold (15 daq)
    API-->>App: 201 {booking: pending_payment, checkout.url}
    App->>PM: checkout sahifasi (karta / Payme ilovasi)
    PM->>API: CheckPerformTransaction {amount, account.booking_id}
    API->>DB: booking pending? summa mos? hold tirikmi (yo'q bo'lsa qayta hold)
    API-->>PM: {allow: true}  (joy yo'q → -31050, pul yechilmaydi)
    PM->>API: CreateTransaction {id, time}
    API->>DB: payments (state=1), payment_events inbox
    PM->>API: PerformTransaction {id}
    API->>DB: TX: payment succeeded + booking confirmed + seats + outbox(BookingConfirmed[, MatchFull])
    API-->>PM: {state: 2, perform_time}
    DB-->>App: outbox relay → WS booking:{id} + push "Joy band qilindi"
```

**Host panel**

| Method | Path | Izoh |
|---|---|---|
| GET | `/v1/host/offers` | dispatch offer'lari (fee, masofa, muddat) |
| POST | `/v1/host/offers/{id}/accept` \| `/decline` | birinchi accept yutadi; `409 OFFER_TAKEN` |
| GET | `/v1/host/matches?scope=today\|upcoming\|past` | |
| GET | `/v1/host/matches/{id}/roster` | to'liq roster + `qr_public_key` + `roster_version` (offline kesh) |
| POST | `/v1/host/matches/{id}/arrive` | `{location, accuracy_m}` → geofence ≤ 200 m |
| POST | `/v1/host/matches/{id}/checkins` | batch, offline sync, `client_event_id` bilan idempotent |
| PATCH | `/v1/host/matches/{id}/participants/{pid}` | `{side_no}` yoki `{status: no_show}` |
| POST | `/v1/host/matches/{id}/complete` | `{scores, mvp_participant_id, incidents}` |
| POST | `/v1/host/matches/{id}/highlights/uploads` | S3 multipart presigned URL'lar (≤ 60 s, ≤ 150 MB) |
| POST | `/v1/media/{id}/complete` | `CompleteMultipartUpload` → transcode navbati |

```json
POST /v1/host/matches/01a1…/checkins
{ "events": [
  { "client_event_id": "0f6c…", "action": "check_in", "method": "qr",
    "qr_payload": "mu1.eyJwIjoi…", "occurred_at": "2026-10-18T13:52:11Z",
    "location": { "lat": 41.2757, "lng": 69.2031 } },
  { "client_event_id": "1a2b…", "action": "check_in", "method": "manual",
    "participant_id": "01a1…", "occurred_at": "2026-10-18T13:53:40Z" } ] }

200 OK
{ "results": [
  { "client_event_id": "0f6c…", "status": "accepted",  "participant_id": "01a1…" },
  { "client_event_id": "1a2b…", "status": "duplicate", "participant_id": "01a1…" } ],
  "roster_version": 7 }
```

**QR check-in xavfsizligi:** chipta `{participant_id, match_id, exp}` — server private key bilan **Ed25519** imzolanadi. Host app roster bilan birga public key'ni oladi → stadionda internet bo'lmasa ham imzoni tekshiradi va check-in'ni lokal yozadi, keyin batch yuboradi. Skrinshot bilan kirish: chipta faqat o'sha match uchun, roster'da `checked_in` bo'lgach ikkinchi skan `duplicate`.

**Admin:** `POST /v1/admin/matches` (lease bilan birga, ustma-ust lease → `409 LEASE_OVERLAP`), `POST /v1/admin/matches/{id}/publish`, `POST /v1/admin/matches/{id}/cancel` (barcha booking'larga 100% refund, ixtiyoriy wallet bonus). Ichki panel uchun: venue/pitch katalogi (`/venues`, `/pitches`), match jadvali va tafsiloti (roster, booking, to'lov, refund, host, audit), host'lar (telefon bo'yicha host qilish, tasdiqlash, suspend), to'lovlar, refund navbati (`original_method` refund'lari provider kabinetida qo'lda bajariladi → `POST /v1/admin/refunds/{id}/complete` `provider_refund_id` bilan, `payments.refunded_amount` yangilanadi), dashboard (match'lar, to'lish, GMV, ijara, host to'lovlari, yalpi marja, no-show, bekor qilishlar). Jadvallar offset pagination (`limit`, `offset` → `total`). Har bir mutatsiya `audit_logs` ga (ip, request_id bilan) yoziladi.

---

## 4. Global masshtab va modular arxitektura

### 4.1 Tizim ko'rinishi

```mermaid
flowchart LR
    subgraph Clients
        PA[Player app<br/>Expo]
        HA[Host app<br/>Expo, offline-first]
        AD[Admin<br/>Next.js]
    end
    subgraph Edge
        CF[CDN + WAF<br/>rate limit]
    end
    subgraph Cell["Region cell — MVP: uz-1 = AWS eu-central-1"]
        API[NestJS modular monolith<br/>REST + WebSocket]
        WK[BullMQ worker'lar<br/>hold expiry, dispatch, reminders]
        RL[Outbox relay]
        PG[(PostgreSQL 18<br/>+ PostGIS)]
        VK[(Valkey)]
        S3[(S3-mos object storage)]
        MW[Python media worker<br/>FFmpeg → HLS, AI]
        Q[[Media navbati]]
    end
    subgraph External
        PAY[Payme / Click / Uzum<br/>Stripe]
        MSG[Eskiz SMS / Telegram Gateway<br/>FCM / APNs]
    end
    PA & HA & AD --> CF --> API
    API <--> PG
    API <--> VK
    WK <--> PG
    WK <--> VK
    RL -- outbox_events --> VK
    PG --> RL
    HA -- presigned multipart --> S3
    S3 --> Q --> MW --> S3
    MW --> PG
    PAY -- webhooks --> CF
    API --> PAY
    WK --> MSG
```

### 4.2 Modullar (bounded context'lar)

| Modul | Jadvallar | Chiqaradigan event'lar | Ajratish ehtimoli |
|---|---|---|---|
| Identity | users, user_roles, auth_identities, user_sessions, device_tokens | `UserRegistered`, `UserErased` | past |
| Profile | player_sport_profiles, match_feedback | `RatingUpdated` | past |
| Catalog | venues, pitches, amenities, field_leases | `LeaseCreated` | past |
| Matches | matches, match_sides, match_participants, match_waitlist | `MatchPublished`, `MatchFull`, `MatchMinReached`, `MatchCancelled`, `MatchCompleted`, `SlotsReleased` | o'rta |
| Booking | bookings | `BookingHeld`, `BookingConfirmed`, `BookingCancelled`, `BookingExpired` | past (Matches bilan yaqin) |
| Payments | payments, payment_events, refunds, wallet_*, payment_provider_configs | `PaymentSucceeded`, `RefundIssued` | **o'rta** (PCI/audit izolyatsiyasi) |
| HostOps | host_profiles, host_assignments, checkin_events, host_payouts | `HostAssigned`, `HostArrived`, `PlayerCheckedIn` | o'rta |
| Media | media_assets, highlights, highlight_* | `HighlightReady` | **yuqori** (allaqachon alohida worker) |
| Notifications | notifications, push_deliveries; device_tokens (`PUT /v1/me/devices`) | — (outbox consumer: `notifications`, `realtime` group'lari) | **yuqori** (birinchi ajraladi) |
| Compliance | waiver_*, consents, data_subject_requests, audit_logs | `ConsentChanged` | past |
| Competitions (Phase 2) | teams, competitions, competition_entries, match_events | `EntryConfirmed`, `StandingsChanged` | o'rta |

**Qoidalar:**
1. Modul boshqa modulning jadvaliga **yozmaydi** — faqat uning public service interfeysini chaqiradi. ESLint `boundaries` qoidasi CI'da tekshiradi.
2. Sinxron zanjir (booking → payment → seats) — bitta tranzaksiya ichida service chaqiruvlari. Asinxron reaksiyalar (push, dispatch, analytics, reyting) — faqat **outbox event**'lar orqali.
3. Outbox: event biznes o'zgarish bilan **bir tranzaksiyada** yoziladi → relay Valkey Streams'ga (keyinchalik SQS/Kafka) chiqaradi → consumer'lar idempotent. Modulni microservice'ga ajratish = consumer'ni boshqa deploy'ga ko'chirish; event kontrakti o'zgarmaydi.

### 4.3 Hosting, data residency va multi-region

#### Huquqiy holat (2026-yil oktabr)

| Davr | Qoida |
|---|---|
| 2021-yil apreldan 2026-yil martgacha | "Shaxsga doir ma'lumotlar to'g'risida"gi qonunning 27¹-moddasi: O'zbekiston fuqarolarining **barcha** shaxsiy ma'lumotlari mamlakat hududidagi, davlat reyestrida ro'yxatdan o'tgan bazalarda saqlanishi shart edi. Talab mahalliy kompaniyalarga ham, xorijiylarga ham tegishli edi; amalda asosan xorijiy platformalarga nisbatan qo'llanilgan. |
| **2026-yil 26-martdan** (o'zgartirish qonuni, rasmiy e'lon qilingan kundan kuchga kirgan) | Majburiy lokalizatsiya faqat 3 toifaga qoldi: **biometrik**, **genetik** ma'lumotlar va **O'zbekistondagi telekom operatorlari xizmatlaridan foydalanuvchilar** ma'lumotlari. Qolgan shaxsiy ma'lumotlarni xorijda saqlash va qayta ishlash mumkin, agar quyidagilardan **biri** bajarilsa: (1) davlat adekvat himoya ro'yxatida; (2) vakolatli organ talablariga mos standart shartnoma shartlari (SCC) yoki majburiy korporativ qoidalar (BCR); (3) vakolatli organ tasdiqlagan xalqaro standartlarga rioya. |
| **2026-yil avgustdan** | Vazirlar Mahkamasi 49 ta davlat va hududdan iborat adekvat ro'yxatni tasdiqladi: Germaniya, Irlandiya, Buyuk Britaniya, Fransiya, Niderlandiya, Yaponiya, Koreya, Singapur, AQSh (gazeta.uz bo'yicha — faqat EU-US Data Privacy Framework ishtirokchilari uchun) va boshqalar. **BAA va Qozog'iston ro'yxatda yo'q.** Ro'yxatdagi davlatlarga uzatish qo'shimcha ruxsatsiz va vakolatli organni xabardor qilmasdan amalga oshiriladi. Chegaradan o'tkazishda ma'lumot sizib chiqsa — 24 soat ichida Migratsiya va personallashtirish departamentiga xabar, 72 soat ichida batafsil hisobot. |

Bazalarni **davlat reyestrida ro'yxatdan o'tkazish** (ariza/xabardor qilish tartibida) bekor qilinganini ko'rsatadigan manba topilmadi — shuning uchun bu talab hamon amalda deb hisoblaymiz.

#### Match Up uchun xulosa

| Ma'lumot | Lokalizatsiya | Qayerda saqlanadi |
|---|---|---|
| Profil, telefon, booking, to'lov tarixi, roster, check-in, consent'lar | shart emas | **AWS eu-central-1 (Frankfurt)** — Germaniya ro'yxatda, shartsiz |
| Highlight videolar (yuzni tanish ishlatilmasa) | odatda shart emas ⚠️ | S3 Frankfurt |
| Yuz bo'yicha avtomatik teglash, Face ID login (Phase 2 AI) | **shart — biometrik** | O'zbekiston ichidagi alohida GPU worker + storage, yoki funksiyadan voz kechish |
| Telekom abonent ma'lumotlari (IMSI, IMEI, sessiya) | biz telekom operatori emasmiz — yig'ilmaydi | — |

⚠️ "Biometrik ma'lumot" ta'rifi oddiy video yozuvga ham tegishlimi-yo'qmi — ochiq savol (§6). Yuzni tanimasdan faqat yuzni aniqlab xiralashtirish (`face_blur`) identifikatsiya emas, lekin buni ham yurist tasdiqlashi kerak.

#### Arxitekturaga ta'siri

| | MVP (UZ foydalanuvchilari) | Keyingi cell'lar |
|---|---|---|
| Cell | `uz-1` → **AWS eu-central-1 (Frankfurt)** | `eu-1` (EU foydalanuvchilari, GDPR), boshqa davlatlar — o'sha davlat qonuniga qarab |
| Compute | ECS Fargate (Kubernetes'siz — DevOps yuki minimal) | ECS / EKS |
| PostgreSQL | RDS PostgreSQL 18 + PostGIS, Multi-AZ, PITR | o'sha |
| Kesh | ElastiCache (Valkey) | o'sha |
| Object storage | S3 + CloudFront | o'sha |
| Biometrik (faqat Phase 2, agar kerak bo'lsa) | O'zbekistondagi kichik colocation: GPU worker + S3-mos storage (MinIO) | — |
| IaC | Terraform, har cell uchun alohida workspace | o'sha |

- **Nima o'zgardi:** avval MVP uchun O'zbekistondagi data-markaz va o'zimizning Kubernetes / CloudNativePG / MinIO stack'i tavsiya qilingan edi. 2026-yil mart o'zgarishidan keyin bu shart emas — managed AWS servislari bilan MVP tezroq va arzonroq quriladi, operatsion xatarlar kamayadi.
- **Region tanlovi:** Frankfurt — Germaniya ro'yxatda shartsiz va GDPR yurisdiksiyasi (EU foydalanuvchilari uchun ham mos). AWS UAE (`me-central-1`) UZ foydalanuvchilari uchun **tanlanmaydi** — BAA ro'yxatda yo'q, SCC/BCR yo'lini talab qiladi. Toshkent–Frankfurt kechikishi booking ilovasi uchun yetarli bo'lishi kutiladi, lekin ishga tushirishdan oldin real o'lchash kerak; statik kontent va video CloudFront orqali beriladi.
- **Cell pattern saqlanadi:** boshqa davlatlarda lokalizatsiya talablari bor (masalan, Qozog'istonda — bozorga kirishdan oldin alohida tekshirish kerak), qonun yana o'zgarishi ham mumkin. Har cell — to'liq mustaqil stack; `countries.data_region` foydalanuvchining "uy" cell'ini belgilaydi. Kerak bo'lsa, bitta cell'ni boshqa hosting'ga ko'chirish = Terraform + DB migratsiyasi, kod o'zgarmaydi (S3 API, standart PostgreSQL).
- **Routing:** ilova birinchi so'rovda global `GET https://api.matchup.example/v1/region?phone_prefix=+998` dan cell URL'ini oladi (bu servis PII saqlamaydi). Cross-cell (masalan, UZ foydalanuvchisi Dubayda o'ynaydi) MVP'da yo'q.
- **Majburiyatlar:** bazani davlat reyestrida ro'yxatdan o'tkazish; cross-border incident runbook'i (24 / 72 soat); AWS bilan DPA; privacy policy'da ma'lumotlar Germaniyada saqlanishi ochiq yoziladi.

Manbalar: [Dentons (2026-03-31)](https://www.dentons.com/en/insights/articles/2026/march/31/uzbekistan-dismantles-strict-data-localization-regime), [Gazeta.uz — qonun o'zgarishi](https://www.gazeta.uz/oz/2026/03/28/personal-data/), [Gazeta.uz — 49 davlat ro'yxati](https://www.gazeta.uz/oz/2026/08/04/personal-data/), [Spot.uz — ro'yxat va xabardor qilish](https://www.spot.uz/oz/2026/08/04/personal-data-abroad), [Settle Advisory](https://settleadvisory.com/news-en/localization-of-personal-data-in-uzbekistan-transition-to-a-more-flexible-regulatory-model/), [Legal500 / Vakhidov & Partners](https://www.legal500.com/developments/thought-leadership/legislative-updates-in-the-field-of-artificial-intelligence-and-personal-data-regulation-uzbekistan/). Rasmiy matn — [lex.uz](https://lex.uz).

### 4.4 Multi-currency

- Narx **match'ning shahar valyutasida** belgilanadi (`matches.currency = cities.default_currency`). Checkout'da FX konvertatsiya **yo'q** — o'yinchi aynan ko'rgan summani to'laydi; karta valyutasi farqini bank/Stripe hal qiladi.
- Barcha summalar `bigint` minor units; `currencies.minor_unit` formatlash va provider adapter'lari uchun (Click so'm decimal kutadi → adapter `/100`).
- `fx_rates` (masalan, cbu.uz kunlik kursi) — faqat konsolidatsiyalangan hisobotlar va investor dashboard'lari uchun.
- Formatlash: server `formatted` maydonini locale bo'yicha beradi; client offline holatda `Intl.NumberFormat` bilan.

### 4.5 Multi-language (lokalizatsiya)

| Qatlam | Qayerda | Qanday |
|---|---|---|
| UI matnlari | `packages/i18n` | i18next + ICU MessageFormat (ko'plik shakllari). Tillar: `uz-Latn`, `uz-Cyrl`, `ru`, `en`. Tarjima boshqaruvi — Tolgee (self-host) yoki Crowdin. Yangi matnlar EAS Update orqali store'siz yetkaziladi. |
| Server matnlari | `apps/api/src/i18n/<locale>/*.json` | push, SMS, Telegram, Problem `detail` — `user.locale` bo'yicha shablon. |
| Kontent | DB `jsonb` | match nomi, venue tavsifi, sport nomi: `coalesce(name->>$locale, name->>'uz-Latn')`. |
| Huquqiy hujjatlar | `waiver_templates` | har locale — alohida qator, alohida versiya va hash (tarjima ham huquqiy matn). |

Locale tanlash: `Accept-Language` → `users.locale` → `countries.default_locale`. Vaqt — har doim venue `timezone`'ida ("19:00, Chilonzor"), qurilma zonasida emas. Kelajakda arab tili uchun RN `I18nManager` (RTL).

### 4.6 Payment gateway'lar

```ts
export interface PaymentProvider {
  readonly code: 'payme' | 'click' | 'uzum' | 'stripe' | 'paypal';
  readonly style: 'merchant_api' | 'async_webhook';
  supports(ctx: { country: string; currency: string }): boolean;
  createCheckout(input: {
    booking: BookingRef; amount: Money; returnUrl: string; locale: string;
  }): Promise<CheckoutSession>;               // redirect URL yoki SDK client_secret
  handleInbound(req: RawRequest): Promise<{   // signature tekshirish + normalizatsiya
    event: NormalizedPaymentEvent;            // { providerEventId, kind: 'check'|'create'|'succeeded'|'failed'|'cancelled'|'refunded', ... }
    respond: (result: DomainResult) => RawResponse;   // Payme JSON-RPC / Click form / Stripe 200
  }>;
  refund(input: { payment: PaymentRef; amount: Money; reason: string }): Promise<RefundResult>;
  fetchStatus(providerTxnId: string): Promise<ProviderStatus>;   // reconciliation
}
```

| Provider | Uslub | Bozor | Eslatma |
|---|---|---|---|
| **Payme** | merchant API (JSON-RPC) — Payme bizni chaqiradi | UZ | Summalar tiyin; `CheckPerformTransaction`'da hold qayta tekshiriladi → joy yo'q bo'lsa pul **yechilmaydi** |
| **Click** | merchant API (Prepare / Complete) | UZ | MD5 `sign_string`; summa so'mda |
| **Uzum Bank** | merchant API (check / create / confirm / reverse / status) | UZ | Basic auth |
| **Stripe** | async webhook (PaymentIntent) | xalqaro | Apple Pay / Google Pay — Stripe Payment Sheet orqali. Kech `succeeded` → avto-refund yoki waitlist |
| **PayPal** | async webhook | xalqaro (talab bo'lsa) | Phase 3 |
| **Wallet** | ichki | hammasi | Refund kreditlari; provider komissiyasi yo'q |

- **Routing:** `payment_provider_configs` (davlat, valyutalar, priority, `is_enabled`, `secret_ref` → Vault/Secrets Manager). Yangi davlat = konfiguratsiya qatori, kod emas.
- **Idempotency 3 qavat:** `Idempotency-Key` (client) → `payment_events UNIQUE (provider, provider_event_id)` (webhook dublikatlari) → `payments_one_success_per_booking` partial unique (ikki marta to'lov).
- **Reconciliation:** har kecha Payme `GetStatement`, Click/Uzum hisobotlari, Stripe balance transactions ↔ `payments` → farq bo'lsa alert + avto-tuzatish job'i.
- ⚠️ **Yuridik:** Stripe va PayPal O'zbekistonda ro'yxatdan o'tgan yuridik shaxsga merchant akkaunt bermaydi → xalqaro bosqichda chet el yuridik shaxsi (UAE / UK / Estoniya) va o'sha cell'lar uchun alohida merchant akkauntlar kerak.

### 4.7 Liability waiver va sug'urta

**Oqim (checkout'dan oldin, majburiy):**
1. `GET /matches/{id}` → `waiver: {required: true, signed: false}`.
2. `GET /waivers/required?match_id` → foydalanuvchi tilidagi oxirgi versiya (`body_md`, `document_sha256`).
3. Ekranda to'liq matn → oxirigacha skroll → "Roziman" (+ 18 yoshgacha bo'lsa guardian ma'lumotlari).
4. `POST /waivers/{template_id}/signatures` — server client yuborgan hash'ni o'zinikiga solishtiradi (mos kelmasa `409` → yangi matn qayta ko'rsatiladi), imzoni append-only saqlaydi: hash, IP, user-agent, app versiyasi, qurilma, vaqt.
5. `POST /bookings` `waiver_signature_id` bilan — DB CHECK imzosiz booking'ni rad etadi.

- **Imzo kuchi:** MVP — clickwrap. Kuchliroq dalil kerak bo'lsa — `otp_confirmed` (SMS/Telegram kod bilan tasdiqlash). Elektron imzoning O'zbekistondagi huquqiy kuchini yurist tasdiqlashi kerak.
- **Versiya:** matn o'zgarsa yangi `version` → keyingi booking'da qayta imzo so'raladi. Bir marta imzolangan joriy versiya keyingi match'larda qayta so'ralmaydi.
- **Sug'urta (Phase 1.5):** mahalliy sug'urta kompaniyasi bilan **roster asosidagi guruh polisi** — har kuni check-in qilinganlar ro'yxati (ism, tug'ilgan sana, match, vaqt) API/SFTP orqali yuboriladi; premium match narxiga kiritiladi. Bitta o'yinchi uchun alohida polis chiqarishdan ancha arzon va tez.

### 4.8 GDPR va shaxsiy ma'lumotlar

| Talab | Amalga oshirish |
|---|---|
| Minimallashtirish | Ro'yxatdan o'tish uchun faqat telefon + ism. Tug'ilgan sana — faqat yosh cheklovli match'lar uchun. Karta ma'lumotlari hech qachon bizda emas (provider sahifasi / SDK). |
| Huquqiy asos | Booking — shartnoma; marketing, analytics, **videoda ko'rinish** — alohida consent (`consents`, versiyalangan, append-only). |
| Media | `media_appearance` consent'i yo'q o'yinchi highlight'da teglanmaydi; Phase 2'da AI face blur (`face_blur` job). |
| Kirish va ko'chirish (Art. 15/20) | `POST /me/data-export` → JSON + media zip, 30 kun ichida (`data_subject_requests.due_at`). |
| O'chirish (Art. 17) | `DELETE /me` → 30 kun grace → anonimlashtirish: telefon/email/ism null yoki maskalangan, sessiyalar va device token'lar o'chiriladi, teglar olib tashlanadi. To'lov va waiver yozuvlari anonim holda qonuniy muddatda saqlanadi (soliq / da'vo himoyasi). Backup'lar 35 kunda aylanadi — bu muddat privacy policy'da yoziladi. |
| Xavfsizlik | TLS 1.3, disk/backup shifrlash (KMS), secret'lar Vault'da, admin uchun TOTP 2FA, RBAC, `audit_logs`. Loglarda PII yo'q (pino `redact`: phone, email, token). |
| Yosh | Minimal 16 (GDPR raqamli rozilik yoshi); kichiklar uchun guardian waiver. |
| Processor'lar | DPA: hosting, Eskiz, Telegram, Sentry, payment provider'lar. Records of Processing (RoPA) yuritiladi. |
| Data residency | §4.3 — UZ va EU foydalanuvchilari ma'lumotlari Frankfurt'da (Germaniya UZ adekvat ro'yxatida va GDPR yurisdiksiyasida); biometrik ma'lumot faqat O'zbekiston ichida. |

### 4.9 Background job'lar

| Job | Trigger | Mantiq |
|---|---|---|
| Hold expiry | har 30 s | `expire_holds.sql` → `SlotsReleased` |
| Waitlist offer | `SlotsReleased` (outbox consumer) + har 30 s muddati o'tganlar | navbatdagi birinchiga push, 10 daqiqalik eksklyuziv oyna (`SeatsService.hold` faol takliflarni hisobga oladi); muddat o'tsa — keyingisiga |
| Min players check | `min_players_deadline` (odatda T-3h) | `confirmed < min_players` → match bekor + 100% refund + push |
| **Host dispatch** | `MatchFull` darhol **yoki** T-12h da `confirmed ≥ min_players` | `dispatch_candidates.sql` → 1-to'lqin: eng yaqin 3 ta hostga parallel offer (10 daq), birinchi accept yutadi → javob bo'lmasa keyingi 5 ta → T-6h hali host yo'q → admin alert |
| Eslatmalar | har 60 s: T-24h, T-2h | push: vaqt, manzil, xarita havolasi; har biri bir marta (`notifications.dedupe_key`) |
| Push retry / receipt | har 30 s / 5 daq | `queued` xabarlar backoff bilan qayta yuboriladi (5 urinish); Expo receipt'lari, `DeviceNotRegistered` -> `device_tokens.disabled_at` |
| Host no-show | kick-off - 15 daq, `arrived` yo'q | admin alert + zaxira host |
| Post-match | `MatchCompleted` | Glicko reyting, feedback so'rovi, no-show statistikasi |
| Host payout | haftalik | `host_assignments.completed` → `host_payouts` |
| Reconciliation | har kecha | provider hisobotlari ↔ `payments` |
| DSR | har kun | export tayyorlash, erasure grace muddati o'tganlarni anonimlashtirish |

> **Dispatch bo'yicha tavsiya:** host'ni faqat match **to'lganda** chaqirish operatsion xavfli — 12/14 o'yinchi bilan ham o'yin bo'ladi, oxirgi soatlarda to'lgan match'ga host topish qiyin. Shuning uchun ikki trigger: to'lganda darhol yoki T-12h da minimumga yetganda.

#### Push va real-time (Notifications moduli)

```mermaid
flowchart LR
    TX[Biznes tranzaksiya<br/>emit()] --> OB[(outbox_events)]
    OB -->|OutboxRelay 2 s| ST[[Redis Stream<br/>matchup:events]]
    ST -->|XREADGROUP notifications| NE[NotificationEvents]
    ST -->|XREADGROUP realtime| RE[RealtimeEvents]
    NE --> NT[(notifications<br/>dedupe_key)]
    NT --> PS[PushSender<br/>Expo / FCM / APNs]
    PS --> PD[(push_deliveries)]
    RE --> GW[Socket.IO gateway<br/>+ Redis adapter]
    GW --> APP[Player / Host ilovalari]
```

* **Idempotentlik:** `notifications.dedupe_key` (`evt:<event_id>:<user_id>`, `reminder_24h:<booking_id>`, `waitlist:<entry_id>`) — at-least-once yetkazishda ham bitta xabar. WS payload'lari holat snapshot'i — takroriy event zararsiz.
* **Consumer group'lar alohida:** sekin push provayderi WS yangilanishlarini ushlab turmaydi. Xato bergan event ACK qilinmaydi va `XPENDING`/`XCLAIM` bilan qayta olinadi; 5 urinishdan keyin `matchup:events:dead`.
* **Matn:** `users.locale` (uz-Latn, ru, en; uz-Cyrl -> uz-Latn), sana venue vaqt zonasida. Marketing (`match.new`) — faqat `marketing_push` consent bilan; tranzaksion — har doim.
* **WS xonalari:** `match:{id}` (ochiq) -> `slots.updated`; `booking:{id}` (faqat egasi) -> `booking.updated`; `host:{userId}` -> `offer.created` / `offer.closed`. Ulanish: `path: /ws`, `auth: { token }`.

### 4.10 Video highlight pipeline

```mermaid
flowchart LR
    A[Host app: yozish<br/>720p H.264, ≤60 s] -->|presigned multipart| B[(Object storage<br/>raw)]
    B -->|ObjectCreated| C[[Navbat]]
    C --> D[Python worker<br/>FFmpeg: HLS + thumbnail]
    D --> E[(processed)]
    D -->|media_assets.status=ready| F[(PostgreSQL)]
    F -->|HighlightReady outbox| G[Push: 'Sizning golingiz tayyor']
    E --> H[CDN signed URL]
    D -. Phase 2 .-> I[GPU worker: event detection<br/>to'p/gol, olomon shovqini]
    I -.-> J[Auto-clip → highlights.source = ai_generated]
```

- Video **backend orqali o'tmaydi** — API faqat presigned URL beradi; trafik va CPU API'ga tegmaydi.
- MVP: host qo'lda 15–60 soniyalik kliplar. Phase 2: venue'ga o'rnatilgan kamera butun o'yinni yozadi → GPU spot worker'lar (`ai_detect_events`, `ai_auto_clip`) `match_events` timestamp'lari va audio cho'qqilari bo'yicha avtomatik kesadi.
- **Biometrik chegara:** yuzni tanib o'yinchini avtomatik teglash biometrik ma'lumotni qayta ishlash hisoblanadi → O'zbekiston ichida bajarilishi shart (§4.3). MVP'da yuz tanish yo'q: teglash qo'lda va faqat `media_appearance` consent'i borlarga.
- Xarajat nazorati: raw footage 30 kundan keyin arzon storage tier'ga / o'chiriladi; faqat highlight'lar uzoq saqlanadi; transcode spot/preemptible node'larda.

### 4.11 Masshtab triggerlari

| Belgi | Harakat |
|---|---|
| Discovery p95 > 150 ms | Valkey kesh (geohash-6 + filtrlar kaliti, 15–30 s TTL), WS bilan slot'lar yangilanishi |
| DB CPU > 60% doimiy | read replica (discovery, feed, profil o'qish) |
| Append-only jadvallar > 50M qator | oylik partition + arxiv |
| Bildirishnomalar API'ni sekinlashtiradi | Notifications modulini alohida deploy |
| Video navbati kechikadi | media worker autoscaling (navbat uzunligi bo'yicha) |
| Yangi davlat | yangi cell (Terraform), `countries` + `payment_provider_configs` qatorlari |

Taxminiy MVP yuklama: ~10 000 MAU, kuniga ~200 match, ~3 000 booking — bitta Postgres instance (4 vCPU / 16 GB) va 2 ta API pod bemalol ko'taradi.

---

## 5. Roadmap

| Bosqich | Davomiyligi | Ko'lam |
|---|---|---|
| **MVP** | ~12 hafta | Player app (discovery, booking, Payme + Click, wallet, chipta), Host app (offer, roster, QR check-in, geofence, qo'lda highlight), Admin (venue, lease, match, refund), Toshkent |
| **Phase 1.5** | +6–8 hafta | Uzum, waitlist avto-offer, roster asosidagi sug'urta, Glicko reyting + level bo'yicha balanslangan jamoalar, Samarqand / Buxoro |
| **Phase 2 — Super App** | +3–4 oy | Teams, Leagues, Tournaments (`0002`), match statistikasi, venue kameralari + AI auto-clip, social feed |
| **Phase 3 — Xalqaro** | talab bo'yicha | Yangi cell'lar (Qozog'iston, UAE — har birining lokalizatsiya qonuni alohida tekshiriladi), Stripe / Apple Pay / PayPal, chet el yuridik shaxsi |

## 6. Ochiq savollar va xatarlar

| # | Mavzu | Kim hal qiladi |
|---|---|---|
| 1 | Data residency: "biometrik ma'lumot" ta'rifi video highlight'larga tegishlimi, davlat reyestrida ro'yxatdan o'tish tartibi, Frankfurt'ga uzatish uchun qo'shimcha talablar bormi (§4.3) | Yurist + CTO |
| 2 | Clickwrap waiver'ning huquqiy kuchi, voyaga yetmaganlar siyosati | Yurist |
| 3 | Host'lar bilan munosabat shakli (o'zini o'zi band qilgan / pudrat) va soliq | Yurist + buxgalter |
| 4 | Payme / Click merchant shartnomalari (komissiya, refund qoidalari) | Biznes |
| 5 | Xalqaro bosqich uchun chet el yuridik shaxsi | Asoschilar |
| 6 | Bekor qilish siyosati raqamlari (24h / 3h) — konversiya ma'lumotlari bilan qayta ko'rish | Product |

## 7. Tekshiruvni ishga tushirish

```bash
docker compose up -d db
./db/tests/verify.sh
npx @redocly/cli@1.34.5 lint api/openapi.yaml
```

`verify.sh` alohida `matchup_test` bazasida ishlaydi: migratsiyalar → seed → 10 ta constraint testi → 30 parallel client bilan oversell race → to'lov / takroriy webhook / expiry / cancel oqimi → discovery (radius, draft filtri, 50 000 match'da GiST index) → host dispatch → Phase 2 migratsiyasi mavjud ma'lumotlar ustiga → Phase 2 testlari.
