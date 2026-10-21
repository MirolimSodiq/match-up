# Match Up

Pickup sports platformasi (Plei / Birgo uslubida): o'yinchilar tayyor havaskor o'yinlarni topadi va bitta joy sotib oladi, freelance Match Host o'yinni olib boradi. Birinchi bozor — O'zbekiston.

## Tuzilma

| | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Texnik arxitektura: tech stack, DB, API, data residency, compliance, roadmap |
| [docs/STATUS.md](docs/STATUS.md) | Loyiha holati: nima bajarildi, nima qoldi, merge qilinmagan branch'lar |
| [docs/AI_CAM.md](docs/AI_CAM.md) | AI-Cam Engine dizayni: video tahlil, highlight'lar, o'yinchi reytingi (Phase 2) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | CI, Docker image'lar, lokal staging, Terraform (AWS eu-central-1), secret'lar, migratsiya va rollback tartibi, Sentry, EAS |
| [api/openapi.yaml](api/openapi.yaml) | API kontrakti (OpenAPI 3.1) |
| [apps/api](apps/api) | **Backend** — NestJS modular monolith (TypeScript) |
| [apps/player](apps/player) | **O'yinchi ilovasi** — Expo (React Native, TypeScript) |
| [apps/host](apps/host) | **Match Host ilovasi** — Expo: takliflar, offline QR check-in, jamoalar, yakunlash |
| [apps/admin](apps/admin) | **Admin panel** — Next.js (App Router), Tailwind, TanStack Query/Table; BFF orqali OTP login (faqat `admin` roli) |
| [services/media-worker](services/media-worker) | **Media worker** — Python 3.12 + FFmpeg: highlight kliplari -> HLS (720p/480p), thumbnail, 9:16 MP4 |
| [packages/contracts](packages/contracts) | `api/openapi.yaml` dan generatsiya qilingan API tiplari (openapi-typescript) |
| [packages/ui](packages/ui) | Dizayn tizimi: sof TS tokenlar (`@matchup/ui/tokens`, web ham) + RN komponentlar |
| [db/migrations/](db/migrations/) | SQL migratsiyalar — sxemaning yagona haqiqat manbai |
| [db/queries/](db/queries/), [db/tests/](db/tests/) | Kritik SQL va DB darajasidagi testlar (oversell race, constraint'lar) |

## Backend holati (MVP)

| Modul | Holat | Endpointlar |
|---|---|---|
| Auth | ✅ | OTP (SMS: console / Eskiz), refresh token rotation + reuse detection, logout |
| Profil | ✅ | `/me`, sport darajasi, consent'lar, GDPR eksport / o'chirish so'rovi |
| Catalog, Discovery | ✅ | sport, shahar, venue; geo-qidiruv (PostGIS), keyset pagination, match tafsilotlari, waitlist |
| Waiver | ✅ | joriy versiya, hash tekshiruvi bilan imzo, OTP bilan imzo, voyaga yetmaganlar |
| Booking | ✅ | atomik seat hold, idempotency, mehmonlar, bekor qilish (policy bo'yicha refund), QR chipta (Ed25519) |
| To'lovlar | ✅ Payme, Click, Uzum, Wallet | Payme Merchant API (6 metod), Click SHOP API, Uzum Merchant API, hamyon; late payment / qayta hold; kechki reconciliation |
| Host panel | ✅ | dispatch offer'lar, accept/decline, roster, geofence, offline QR check-in, yakunlash |
| Admin | ✅ | match yaratish (lease bilan), nashr, bekor qilish (100% refund + bonus); venue/pitch, match jadvali va tafsiloti, host'lar, to'lovlar, refund navbati, dashboard, `audit_logs` |
| Background job'lar | ✅ | hold expiry, host dispatch, minimumga yetmagan match'larni bekor qilish, outbox relay (BullMQ) |
| Social login, GDPR job'lari | ✅ | Google / Apple / Telegram, identity bog'lash; ma'lumot eksporti, 30 kunlik grace bilan anonimlashtirish |
| Push va real-time | ✅ | Expo Push, eslatmalar, waitlist takliflari; Socket.IO (`match:*`, `booking:*`, `host:*`) |
| Highlight video | ✅ | S3/MinIO presigned multipart (davom ettiriladigan), Redis Stream -> Python worker (HLS, thumbnail, 9:16), match va profil feed'i, like, imzolangan ulashish havolasi |
| AI-Cam Bosqich A | ✅ backend | to'liq o'yin yozuvi (2–3 telefon, ≤ 40 GB, alohida worker lane), bib raqamlari, host belgilaridan avtomatik klip'lar, ishtirokchilar uchun to'liq video ([docs/AI_CAM.md](docs/AI_CAM.md) §12); host/player UI — keyingi qadam |
| Keyingi iteratsiya | ⏳ | AI-Cam ilovalardagi UI va Bosqich B–D, admin reconciliation sahifasi, provider refund'lari, Stripe — to'liq ro'yxat: [docs/STATUS.md](docs/STATUS.md) |

Rejalashtirilgan endpointlar hozircha `501 NOT_IMPLEMENTED` qaytaradi.

## Lokal ishga tushirish

Talab: Docker Desktop, Node.js 22+ (`.nvmrc` — 24), corepack.

```bash
corepack pnpm install
```

```bash
corepack pnpm db:up
```

```bash
cd apps/api && cp .env.example .env && corepack pnpm keys:gen && corepack pnpm db:seed
```

```bash
cd apps/api && corepack pnpm dev
```

API: `http://localhost:3000` (`GET /health`). Dev rejimida OTP kodlari server logiga yoziladi (`[DEV OTP]`).

`db:up` MinIO'ni ham ko'taradi (`localhost:9000`, konsol `:9001`, bucket'lar `matchup-media-raw`, `matchup-media`). Highlight'larni qayta ishlash uchun media worker (Python 3.12, FFmpeg, [uv](https://docs.astral.sh/uv/)):

```bash
cd services/media-worker && uv sync && MEDIA_WORKER_TOKEN=dev-media-worker-token-0123456789abcdef S3_ENDPOINT=http://localhost:9000 S3_REGION=us-east-1 S3_ACCESS_KEY_ID=matchup S3_SECRET_ACCESS_KEY=matchup_dev_only S3_FORCE_PATH_STYLE=true uv run python -m media_worker
```

Admin panel (`http://localhost:3100`, seed admin: `+998901110001`):

```bash
cd apps/admin && cp .env.example .env.local && corepack pnpm dev
```

`.env.local` dagi `API_URL` — API manzili. Brauzer API'ga to'g'ridan-to'g'ri murojaat qilmaydi: token'lar Next route handler'larida (BFF, `/api/auth/*`, `/api/proxy/*`) httpOnly cookie'da saqlanadi.

## Testlar

E2E testlar haqiqiy PostgreSQL + Redis bilan ishlaydi (alohida `matchup_e2e` baza va Redis DB 15, har ishga tushishda noldan yaratiladi):

```bash
cd apps/api && corepack pnpm test:e2e
```

DB qatlamini alohida tekshirish (pgbench bilan oversell race, constraint'lar, Phase 2 migratsiyasi):

```bash
./db/tests/verify.sh
```

API spetsifikatsiyasini tekshirish:

```bash
npx @redocly/cli@1.34.5 lint api/openapi.yaml
```

> Apple Silicon: rasmiy `postgis/postgis` image'ida arm64 yo'q, shuning uchun `docker-compose.yml` uni `linux/amd64` emulyatsiyasida ishga tushiradi (dev uchun yetarli, biroz sekinroq).

## DB sxemasi o'zgarganda

1. `db/migrations/` ga yangi `NNNN_*.sql` fayl qo'shing (mavjud fayllarni o'zgartirmang).
2. `cd apps/api && corepack pnpm db:migrate` — migratsiyani qo'llaydi.
3. `corepack pnpm db:pull` — `src/db/schema.ts` (Drizzle) ni bazadan qayta generatsiya qiladi.
