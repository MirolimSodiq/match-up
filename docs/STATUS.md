# Loyiha holati

> Oxirgi yangilanish: 2026-10-21. Repo: https://github.com/MirolimSodiq/match-up (private, ikki kishi: @MirolimSodiq, @MirolimProjects), `main` — CI yashil. Yangi Claude sessiyasi shu fayldan davom ettirishi mumkin: avval shuni, keyin `docs/ARCHITECTURE.md` ni o'qing.

## Bajarildi (`main` da)

| Qism | Natija | Tekshiruv |
|---|---|---|
| Arxitektura | `docs/ARCHITECTURE.md`: stack, DB, API, data residency (2026-yil mart qonuni), to'lovlar, compliance, roadmap; `docs/AI_CAM.md` — AI-Cam dizayni; `docs/DEPLOYMENT.md` | — |

| Admin panel (`apps/admin`) | Next.js BFF, match/venue/host/refund/dashboard, reconciliation (run'lar, qo'lda ishga tushirish, farqlar) | build |
| Dizayn tizimi | `packages/ui` (tokenlar + RN komponentlar), `packages/contracts` (OpenAPI tiplari) | tsc |
| CI va infra | GitHub Actions (typecheck, e2e, worker pytest, lint, build), Dockerfile'lar, lokal staging, Terraform (eu-central-1, media bucket'lar, worker ECS — klip va yozuv lane'lari), Sentry, EAS | terraform validate, actionlint |

## Jarayonda / merge qilinmagan

Yo'q (yangi ish boshlanganda shu yerga: ish, kim, branch).

Eski `claude/*` branch'lar `main` ga qo'shilgan; ular faqat lokal tarix sifatida qolgan, GitHub'ga push qilinmagan.

## Kim nima qiladi

Loyiha ikki kishi o'rtasida bo'lingan. Har yo'nalish o'z papkalariga ega — bir-birining fayllariga tegilmaydi; umumiy fayllar uchun qoidalar pastda ("Ikki kishi bo'lib ishlash"). Ish boshlanganda holat ustunida `jarayonda` + branch, merge bo'lgach `✅` va qator "Bajarildi" ga ko'chiriladi.

### @MirolimSodiq — AI-Cam Bosqich A (mobil ilovalar va media)

| # | Ish | Fayllar | Holat |
|---|---|---|---|
| A1 | `0006_ai_cam.sql`: `recording_sessions`, `recording_cameras`, `recording_markers`, `match_participants.bib_number`, `recording_session_id` ustunlari | `db/migrations/0006_*` | ✅ |
| A2 | API (match bo'yicha: kamera, yuklash, belgilar, bib, player ko'rinishi — [`AI_CAM.md`](AI_CAM.md) §6, §12), worker `recording_v1` / `clip_v1`, Terraform yozuv lane'i | `apps/api/src/media/`, `services/media-worker`, `infra/terraform` | ✅ |
| A3 | Host ilovasi: kamera rejimi (pozitsiya, 4K HEVC, landshaft qulf, `PUT .../cameras`), yozuv yuklash (Wi-Fi, kliplardan keyin, 16 MiB qismlar, URL partiyalari, `complete` `parts` siz), pult (Chap/O'ng darvoza, Kick-off, bekor qilish — oflayn navbat), roster'da bib | `apps/host/` | ✅ (haqiqiy telefonda 90 daqiqalik yozuv sinalmagan) |
| A4 | Player ilovasi: match sahifasida "To'liq o'yin videosi" kartasi, to'liq ekran HLS player, kamera almashtirish (vaqt saqlanadi), lahzalarga sakrash, kesilgan klipni ochish, `recording.ready` push deep link'i `/match/{id}/recording` | `apps/player/` | ✅ |
| A5 | Relizdan oldin: `metro.config.js` da Sentry (`getSentryExpoConfig`) | `apps/host`, `apps/player` | ✅ `feat/sentry-metro` |

### @MirolimProjects — admin panel, backend qoldiqlari va deploy

| # | Ish | Fayllar | Holat |
|---|---|---|---|
| B1 | Admin'da reconciliation sahifasi (`GET/POST /v1/admin/finance/reconciliation`, `GET …/{runId}`) — backend tayyor, stack bilan tanishish uchun birinchi ish | `apps/admin/` | ✅ `feat/admin-reconciliation` |
| B2 | `UserErased` event'i uchun handler (hozircha xabarnoma/tozalash yo'q) | `apps/api/src/notifications`, `privacy` | ✅ `feat/user-erased-handler` |
| B3 | Yetishmayotgan job'lar (`ARCHITECTURE.md` §4.9 da bor, `jobs.module.ts` da yo'q): post-match (Glicko reyting, feedback so'rovi, no-show statistikasi), haftalik host payout (`host_payouts`), host no-show alert (kick-off − 15 daq, `arrived` yo'q) | `apps/api/src/jobs`, `host` | ✅ `feat/post-match-jobs` (+ feedback endpoint, migratsiya `0009`) |
| B4 | Admin'da highlight moderatsiyasi | `apps/api/src/admin`, `apps/admin` | ✅ `feat/admin-highlight-moderation` (migratsiya `0010`) |
| B5 | Deploy workflow: GitHub OIDC role (ECR push + ECS/Terraform) va `deploy` job ([`DEPLOYMENT.md`](DEPLOYMENT.md) §6) | `.github/workflows`, `infra/terraform` | — |
| B6 | Media worker autoscaling — navbat uzunligi (`XLEN`/`XPENDING matchup:media-jobs[:recording]`) bo'yicha CloudWatch metrikasi; yozuv lane'ini bo'sh paytda 0 ga tushirish va uzun job paytida ECS task scale-in protection (`DEPLOYMENT.md` cheklovlari) | `infra/terraform` | — |
| B7 | GDPR eksportiga media fayllar (highlight'lar va to'liq o'yin yozuvlari) — `media/` ga tegadi; A2 merge bo'lgan, boshlash mumkin | `apps/api/src/privacy` | — |
| B8 | Provider refund'larni avtomatlashtirish — avval Payme/Click/Uzum refund API imkoniyatlarini aniqlash; hozir admin navbatida qo'lda | `apps/api/src/payments` | — |
| B9 | Admin'da host payout'lari: haftalik ro'yxat (`host_payouts`), "to'landi" belgisi (`provider_ref`, `paid_at`), audit | `apps/api/src/admin`, `apps/admin` | — |
| B10 | Player ilovasida baholash ekrani (`/match/{id}?rate=1` → `GET/POST /v1/matches/{id}/feedback`) — `apps/player` @MirolimSodiq yo'nalishi, kim qilishi kelishiladi | `apps/player` | — |
| B11 | Terraform/ECS: `TELEGRAM_BOT_TOKEN` (secret), `OPS_TELEGRAM_CHAT_ID`, `ADMIN_PUBLIC_URL` — B5 bilan birga | `infra/terraform` | — |

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
2. Migratsiya raqamlari: `0006` — AI-Cam (@MirolimSodiq), `0009` dan boshlab — @MirolimProjects (`0009` — post-match job'lari, B3; `0010` — highlight moderatsiyasi, B4); bitta PR'da bir nechta kerak bo'lsa, shu yerda band qilinadi. Runner qo'llanganlarni `schema_migrations` da fayl nomi bo'yicha saqlaydi, shuning uchun raqamlar orasidagi bo'shliq va merge tartibi muammo emas.
3. Generatsiya qilinadigan fayllar (`apps/api/src/db/schema.ts`, `relations.ts`, `packages/contracts`, `pnpm-lock.yaml`) qo'lda tahrirlanmaydi, conflict ham qo'lda tuzatilmaydi: toza bazada `db:migrate` + `db:pull` (contracts uchun `contracts generate`, lock uchun `pnpm install`) qilinadi va natija commit qilinadi. `db:pull` deklaratsiyalarni nom bo'yicha saralaydi, importlar har nom alohida qatorda — bir xil migratsiyalardan doim baytma-bayt bir xil fayl chiqadi, diff faqat haqiqiy o'zgarishni ko'rsatadi. CI'dagi "Generated fayllar drift" job'i Drizzle sxemasi va `packages/contracts/src/schema.ts` manbadan farq qilsa PR'ni to'xtatadi.
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
