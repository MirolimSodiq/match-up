# Loyiha holati

> Oxirgi yangilanish: 2026-10-21. Repo: https://github.com/MirolimSodiq/match-up (private), `main` — CI yashil. Yangi Claude sessiyasi shu fayldan davom ettirishi mumkin: avval shuni, keyin `docs/ARCHITECTURE.md` ni o'qing.

## Bajarildi (`main` da)

| Qism | Natija | Tekshiruv |
|---|---|---|
| Arxitektura | `docs/ARCHITECTURE.md`: stack, DB, API, data residency (2026-yil mart qonuni), to'lovlar, compliance, roadmap; `docs/AI_CAM.md` — AI-Cam dizayni; `docs/DEPLOYMENT.md` | — |
| DB | migratsiyalar 0001–0005, 0007, 0008 (`0006` AI-Cam uchun band), dev seed, `db/tests/verify.sh` (oversell race) | 30/30 |
| Backend (`apps/api`) | auth (OTP, Google/Apple/Telegram), profil, discovery, waiver, booking, to'lovlar (Payme, Click, **Uzum**, hamyon), **kechki reconciliation**, host panel, admin API, push va WebSocket, GDPR eksport/erasure (+ eksport tayyor push'i), **highlight video pipeline** (MinIO/S3 presigned multipart, ichki endpointlar, feed, like, share, highlight push'lari), BullMQ job'lar, outbox, DB/Redis uzilishiga chidamlilik | e2e 102/102 |
| Media worker (`services/media-worker`) | Python 3.12 + FFmpeg: Redis Stream `matchup:media-jobs` → HLS 720p/480p, thumbnail, 9:16 vertikal MP4 | pytest 32/32 |
| Player ilovasi (`apps/player`) | Expo, yorug' sport dizayni, to'lov WebView (Uzum ham), QR chipta, social login, profil (kirish usullari, maxfiylik), push va deep link'lar, jonli slot'lar, highlight feed | tsc |
| Host ilovasi (`apps/host`) | takliflar, offline roster, QR skaner (Ed25519 offline), jamoalar, yakunlash, push, highlight yozish va resumable yuklash | vitest 45/45 |
| Admin panel (`apps/admin`) | Next.js BFF, match/venue/host/refund/dashboard | build |
| Dizayn tizimi | `packages/ui` (tokenlar + RN komponentlar), `packages/contracts` (OpenAPI tiplari) | tsc |
| CI va infra | GitHub Actions (typecheck, e2e, worker pytest, lint, build), Dockerfile'lar, lokal staging, Terraform (eu-central-1, media bucket'lar, worker ECS), Sentry, EAS | terraform validate, actionlint |

## Jarayonda / merge qilinmagan

Yo'q. Barcha `claude/*` branch'lar `main` ga qo'shilgan; ular faqat lokal tarix sifatida qolgan, GitHub'ga push qilinmagan.

## Qoldi

| # | Ish | Izoh |
|---|---|---|
| 1 | Admin panelda reconciliation sahifasi (`GET /v1/admin/finance/reconciliation` uchun UI) | backend tayyor; UI sessiyasi Uzum branch'i merge bo'lishini kutib to'xtagan edi — endi boshlash mumkin |
| 2 | **AI-Cam Engine** — Bosqich A: to'liq o'yinni yozish rejimi (2 telefon), `recording_sessions`, bib raqamini biriktirish; keyin B–D | dizayn: [`docs/AI_CAM.md`](AI_CAM.md); migratsiya `0006` band; media pipeline asos bo'ladi |
| 3 | Media qoldiqlari | navbat uzunligi bo'yicha worker autoscaling, admin'da highlight moderatsiyasi, GDPR eksportiga media fayllar |
| 4 | Provider refund'larni avtomatlashtirish | hozir admin navbatida qo'lda; Payme/Click/Uzum API imkoniyatlariga bog'liq |
| 5 | `UserErased` event'i uchun handler | hozircha xabarnoma/tozalash yo'q |
| 6 | Stripe / Apple Pay / PayPal | chet el yuridik shaxsi kerak (Phase 3) |
| 7 | Sinalmagan qismlar | push bosilganda deep link (haqiqiy qurilmada); haqiqiy client ID bilan Apple/Google login; Uzum checkout havolasi formati (Uzum menejeri bilan tasdiqlash) |
| 8 | Phase 1.5 / 2 | roster asosidagi sug'urta, balanslangan jamoalar, Teams/Leagues/Tournaments UI, social feed |
| 9 | Yuridik | biometrik ta'rif (video), davlat reyestri, waiver kuchi, host'lar bilan shartnoma (`ARCHITECTURE.md` §6) |

## Ishlash tartibi (sessiyalar uchun)

- Har katta qism alohida sessiyada, o'z worktree'sida bajariladi. Dev baza, Redis DB, API porti va e2e bazasi har sessiyaga alohida beriladi (`E2E_DATABASE_URL`, `E2E_REDIS_URL`).
- Migratsiya raqamlari oldindan taqsimlanadi: `0006` — AI-Cam (band), keyingi bo'sh raqam — `0009`.
- Merge'dan keyin:
  1. `corepack pnpm install`;
  2. Drizzle sxemasini toza bazadan qayta generatsiya qilish (`db:migrate` + `db:pull`);
  3. `corepack pnpm --filter @matchup/contracts generate`;
  4. hamma tekshiruvlar: 6 paket typecheck, API e2e, host vitest, worker pytest, OpenAPI lint, admin build.
- Foydalanuvchi bilan o'zbek tilida (lotin) gaplashiladi; kod va texnik atamalar inglizcha qoladi.
