# Loyiha holati

> Oxirgi yangilanish: 2026-10-21. Repo: https://github.com/MirolimSodiq/match-up (private, ikki kishi: @MirolimSodiq, @MirolimProjects), `main` — CI yashil. Yangi Claude sessiyasi shu fayldan davom ettirishi mumkin: avval shuni, keyin `docs/ARCHITECTURE.md` ni o'qing.

## Bajarildi (`main` da)

| Qism | Natija | Tekshiruv |
|---|---|---|
| Arxitektura | `docs/ARCHITECTURE.md`: stack, DB, API, data residency (2026-yil mart qonuni), to'lovlar, compliance, roadmap; `docs/AI_CAM.md` — AI-Cam dizayni; `docs/DEPLOYMENT.md` | — |
| DB | migratsiyalar 0001–0005, 0007, 0008 (`0006` AI-Cam uchun band), dev seed, `db/tests/verify.sh` (oversell race) | 30/30 |
| Backend (`apps/api`) | auth (OTP, Google/Apple/Telegram), profil, discovery, waiver, booking, to'lovlar (Payme, Click, **Uzum**, hamyon), **kechki reconciliation**, host panel, admin API, push va WebSocket, GDPR eksport/erasure (+ eksport tayyor push'i), **highlight video pipeline** (MinIO/S3 presigned multipart, ichki endpointlar, feed, like, share, highlight push'lari), BullMQ job'lar, outbox, DB/Redis uzilishiga chidamlilik; erasure'dan keyin `UserErased` → xabarlar tarixi o'chiriladi, WS uziladi, host profili offboarded | e2e 103/103 |
| Media worker (`services/media-worker`) | Python 3.12 + FFmpeg: Redis Stream `matchup:media-jobs` → HLS 720p/480p, thumbnail, 9:16 vertikal MP4 | pytest 32/32 |
| Player ilovasi (`apps/player`) | Expo, yorug' sport dizayni, to'lov WebView (Uzum ham), QR chipta, social login, profil (kirish usullari, maxfiylik), push va deep link'lar, jonli slot'lar, highlight feed | tsc |
| Host ilovasi (`apps/host`) | takliflar, offline roster, QR skaner (Ed25519 offline), jamoalar, yakunlash, push, highlight yozish va resumable yuklash | vitest 45/45 |
| Admin panel (`apps/admin`) | Next.js BFF, match/venue/host/refund/dashboard, reconciliation (run'lar, qo'lda ishga tushirish, farqlar) | build |
| Dizayn tizimi | `packages/ui` (tokenlar + RN komponentlar), `packages/contracts` (OpenAPI tiplari) | tsc |
| CI va infra | GitHub Actions (typecheck, e2e, worker pytest, lint, build), Dockerfile'lar, lokal staging, Terraform (eu-central-1, media bucket'lar, worker ECS), Sentry, EAS | terraform validate, actionlint |

## Jarayonda / merge qilinmagan

| Ish | Kim | Branch |
|---|---|---|
| AI-Cam Engine — Bosqich A | @MirolimSodiq | `feat/ai-cam-a` |

Eski `claude/*` branch'lar `main` ga qo'shilgan; ular faqat lokal tarix sifatida qolgan, GitHub'ga push qilinmagan.

## Kim nima qiladi

Loyiha ikki kishi o'rtasida bo'lingan. Har yo'nalish o'z papkalariga ega — bir-birining fayllariga tegilmaydi; umumiy fayllar uchun qoidalar pastda ("Ikki kishi bo'lib ishlash"). Ish boshlanganda holat ustunida `jarayonda` + branch, merge bo'lgach `✅` va qator "Bajarildi" ga ko'chiriladi.

### @MirolimSodiq — AI-Cam Bosqich A (mobil ilovalar va media)

| # | Ish | Fayllar | Holat |
|---|---|---|---|
| A1 | `0006_ai_cam.sql`: `recording_sessions`, `recording_cameras`, `match_participants.bib_number`, `media_processing_jobs.recording_session_id` | `db/migrations/0006_*` | jarayonda |
| A2 | API: `POST /host/matches/{id}/recordings`, kamera qismlari, `complete`, holat ([`AI_CAM.md`](AI_CAM.md) §6); to'liq o'yin uchun transcode job'i | `apps/api/src/media/`, `services/media-worker` | jarayonda |
| A3 | Host ilovasi: to'liq o'yinni 2 telefonda yozish rejimi, Wi-Fi'da fonda davom etadigan upload, check-in'da bib biriktirish, yozish paytida highlight belgilash | `apps/host/` | — |
| A4 | Player ilovasi: to'liq o'yin videosi ishtirokchilarga | `apps/player/` | — |
| A5 | Relizdan oldin: `metro.config.js` da Sentry (`getSentryExpoConfig`) | `apps/host`, `apps/player` | — |

### @MirolimProjects — admin panel, backend qoldiqlari va deploy

| # | Ish | Fayllar | Holat |
|---|---|---|---|
| B1 | Admin'da reconciliation sahifasi (`GET/POST /v1/admin/finance/reconciliation`, `GET …/{runId}`) — backend tayyor, stack bilan tanishish uchun birinchi ish | `apps/admin/` | ✅ `feat/admin-reconciliation` |
| B2 | `UserErased` event'i uchun handler (hozircha xabarnoma/tozalash yo'q) | `apps/api/src/notifications`, `privacy` | ✅ `feat/user-erased-handler` |
| B3 | Yetishmayotgan job'lar (`ARCHITECTURE.md` §4.9 da bor, `jobs.module.ts` da yo'q): post-match (Glicko reyting, feedback so'rovi, no-show statistikasi), haftalik host payout (`host_payouts`), host no-show alert (kick-off − 15 daq, `arrived` yo'q) | `apps/api/src/jobs`, `host` | — |
| B4 | Admin'da highlight moderatsiyasi | `apps/api/src/admin`, `apps/admin` | — |
| B5 | Deploy workflow: GitHub OIDC role (ECR push + ECS/Terraform) va `deploy` job ([`DEPLOYMENT.md`](DEPLOYMENT.md) §6) | `.github/workflows`, `infra/terraform` | — |
| B6 | Media worker autoscaling — navbat uzunligi (`XLEN`/`XPENDING matchup:media-jobs`) bo'yicha CloudWatch metrikasi | `infra/terraform` | — |
| B7 | GDPR eksportiga media fayllar — `media/` ga tegadi, A2 merge bo'lgandan keyin | `apps/api/src/privacy` | — |
| B8 | Provider refund'larni avtomatlashtirish — avval Payme/Click/Uzum refund API imkoniyatlarini aniqlash; hozir admin navbatida qo'lda | `apps/api/src/payments` | — |

### Kod bo'lmagan ishlar (biznes tomonni kim olib borsa)

| Ish | Izoh |
|---|---|
| Uzum checkout havolasi formati | Uzum menejeri bilan tasdiqlash |
| Haqiqiy Apple/Google client ID'lar | social login'ni haqiqiy credential bilan sinash |
| Push bosilganda deep link | haqiqiy qurilmada sinash |
| Payme / Click merchant shartnomalari | komissiya, refund qoidalari |
| Yuridik | biometrik ta'rif (video), davlat reyestri, waiver kuchi, host'lar bilan shartnoma (`ARCHITECTURE.md` §6) |

### Keyinga qoldirilgan

| Ish | Nima uchun |
|---|---|
| Stripe / Apple Pay / PayPal | chet el yuridik shaxsi kerak (Phase 3) |
| Phase 1.5 / 2 | roster asosidagi sug'urta, balanslangan jamoalar, Teams/Leagues/Tournaments UI, social feed — MVP ishga tushgandan keyin |
| AI-Cam Bosqich B–D | Bosqich A'da dataset yig'ilgandan keyin |

## Ikki kishi bo'lib ishlash

1. `main` ga to'g'ridan-to'g'ri push qilinmaydi: har ish o'z branch'ida → PR → CI yashil va ikkinchi odam ko'rib chiqqandan keyin merge.
2. Migratsiya raqamlari: `0006` — AI-Cam (@MirolimSodiq), `0009` dan boshlab — @MirolimProjects; bitta PR'da bir nechta kerak bo'lsa, shu yerda band qilinadi. Runner qo'llanganlarni `schema_migrations` da fayl nomi bo'yicha saqlaydi, shuning uchun raqamlar orasidagi bo'shliq va merge tartibi muammo emas.
3. Generatsiya qilinadigan fayllar (`apps/api/src/db/schema.ts`, `relations.ts`, `packages/contracts`, `pnpm-lock.yaml`) da conflict bo'lsa qo'lda tuzatilmaydi — pastdagi "Merge'dan keyin" tartibida qayta generatsiya qilinadi.
4. `api/openapi.yaml` ga ikkalasi ham tegadi: PR'lar kichik, `main` dan tez-tez rebase.
5. Boshqa yo'nalish papkasiga tegish kerak bo'lsa (masalan, B7 → `apps/api/src/media/`) — oldin kelishiladi.
6. Har PR shu fayldagi o'z qatorini yangilaydi.

## Ishlash tartibi (sessiyalar uchun)

- Har katta qism alohida sessiyada, o'z worktree'sida bajariladi. Dev baza, Redis DB, API porti va e2e bazasi har sessiyaga alohida beriladi (`E2E_DATABASE_URL`, `E2E_REDIS_URL`).
- Migratsiya raqamlari oldindan taqsimlanadi (yuqoridagi 2-qoida).
- Merge'dan keyin:
  1. `corepack pnpm install`;
  2. Drizzle sxemasini toza bazadan qayta generatsiya qilish (`db:migrate` + `db:pull`);
  3. `corepack pnpm --filter @matchup/contracts generate`;
  4. hamma tekshiruvlar: 6 paket typecheck, API e2e, host vitest, worker pytest, OpenAPI lint, admin build.
- Foydalanuvchi bilan o'zbek tilida (lotin) gaplashiladi; kod va texnik atamalar inglizcha qoladi.
