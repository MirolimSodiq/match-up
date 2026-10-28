# Loyiha holati

> Oxirgi yangilanish: 2026-10-24. Repo: https://github.com/MirolimSodiq/match-up (private, ikki kishi: @MirolimSodiq, @MirolimProjects), `main` — CI yashil. Yangi Claude sessiyasi shu fayldan davom ettirishi mumkin: avval shuni, keyin `docs/ARCHITECTURE.md` ni o'qing.

## Bajarildi (`main` da)

| Qism | Natija | Tekshiruv |
|---|---|---|
| Arxitektura | `docs/ARCHITECTURE.md`: stack, DB, API, data residency (2026-yil mart qonuni), to'lovlar, compliance, roadmap; `docs/AI_CAM.md` — AI-Cam dizayni; `docs/DEPLOYMENT.md` | — |
| DB | migratsiyalar 0001–0012, dev seed, `db/tests/verify.sh` (oversell race) | CI |
| Backend (`apps/api`) | auth (OTP, Google/Apple/Telegram), profil, discovery, waiver, booking, to'lovlar (Payme, Click, Uzum, hamyon) va avtomatik refund (flag bilan), kechki reconciliation, host panel, admin API (moderatsiya, host payout'lari), push va WebSocket, GDPR eksport (media bilan) / erasure, highlight va to'liq o'yin yozuvi (AI-Cam A), post-match job'lari (Glicko-2, feedback, no-show, haftalik payout, host no-show alert), BullMQ job'lar, outbox | e2e 138/138 |
| Media worker (`services/media-worker`) | Python 3.12 + FFmpeg, ikki navbat (kliplar, yozuvlar): HLS (yozuv — 1080p/720p/480p), thumbnail, 9:16 MP4, yozuvdan klip kesish; navbat bo'yicha autoscaling | pytest 43/43 |
| Player ilovasi (`apps/player`) | Expo, discovery, booking va to'lov (Payme, Click, Uzum, hamyon), QR chipta, social login, profil (kirish usullari, maxfiylik, akkauntni o'chirish), push va deep link'lar, highlight feed, to'liq o'yin videosi, o'yindan keyin baholash, Sentry | tsc |
| Host ilovasi (`apps/host`) | takliflar, offline roster, QR skaner (Ed25519 offline), jamoalar, yakunlash, push, highlight yozish va yuklash, AI-Cam (kamera rejimi, pult, to'liq yozuvni yuklash, bib raqamlari), Sentry | vitest 58/58 |
| Admin panel (`apps/admin`) | Next.js BFF, match/venue/host/refund/dashboard, reconciliation (run'lar, qo'lda ishga tushirish, farqlar), highlight moderatsiyasi, host payout'lari (CSV) | build |
| Dizayn tizimi | `packages/ui` (tokenlar + RN komponentlar), `packages/contracts` (OpenAPI tiplari) | tsc |
| CI va infra | GitHub Actions (typecheck, e2e, worker pytest, lint, build, generated fayllar drift), production deploy — Hetzner (compose, Caddy, GHCR, SSH, rollback, backup), AWS deploy workflow (GitHub OIDC → ECR/ECS), Dockerfile'lar, lokal staging, Terraform (eu-central-1, media bucket'lar, worker ECS — klip va yozuv lane'lari), Sentry, EAS | terraform validate, actionlint, deploy testlari |

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
| B5 | Deploy workflow: GitHub OIDC role (ECR push + ECS/Terraform) va `deploy` job ([`DEPLOYMENT.md`](DEPLOYMENT.md) §6) | `.github/workflows`, `infra/terraform` | ✅ `feat/deploy-workflow` (tor role: ECR + ECS; teglar SSM'da) |
| B6 | Media worker autoscaling — navbat uzunligi (`XLEN`/`XPENDING matchup:media-jobs[:recording]`) bo'yicha CloudWatch metrikasi; yozuv lane'ini bo'sh paytda 0 ga tushirish va uzun job paytida ECS task scale-in protection (`DEPLOYMENT.md` cheklovlari) | `infra/terraform` | ✅ `feat/media-worker-autoscaling` (+ API metrika job'i, worker task protection) |
| B7 | GDPR eksportiga media fayllar (highlight'lar va to'liq o'yin yozuvlari) — `media/` ga tegadi; A2 merge bo'lgan, boshlash mumkin | `apps/api/src/privacy` | ✅ `feat/gdpr-media-export` (format v2, muddatli havolalar) |
| B8 | Provider refund'larni avtomatlashtirish — avval Payme/Click/Uzum refund API imkoniyatlarini aniqlash; hozir admin navbatida qo'lda | `apps/api/src/payments` | ✅ `feat/auto-refunds` (Payme/Click to'liq refund, qisman → hamyonga, migratsiya `0011`; flag'lar sandbox'dan keyin yoqiladi) |
| B9 | Admin'da host payout'lari: haftalik ro'yxat (`host_payouts`), "to'landi" belgisi (`provider_ref`, `paid_at`), audit | `apps/api/src/admin`, `apps/admin` | ✅ `feat/admin-host-payouts` (bittalab va ommaviy, CSV, host'ga push, migratsiya `0012`) |
| B10 | Player ilovasida baholash ekrani (`/match/{id}?rate=1` → `GET/POST /v1/matches/{id}/feedback`) — `apps/player` @MirolimSodiq yo'nalishi, kim qilishi kelishiladi | `apps/player` | ✅ `feat/player-match-rating` |
| B11 | Terraform/ECS: `TELEGRAM_BOT_TOKEN` (secret), `OPS_TELEGRAM_CHAT_ID`, `ADMIN_PUBLIC_URL` — B5 bilan birga | `infra/terraform` | ✅ `feat/deploy-workflow` (qiymatlar — operator, DEPLOYMENT §4–5) |

### Keyingi bosqich: MVP reliz (C) — taqsimot taklifi, kelishiladi

Maqsad — noyabrda Toshkentda yopiq sinov (pilot), taxminan 2026-yil dekabr boshida App Store va Google Play; sana asosan pastdagi kod bo'lmagan ishlarga (shartnomalar, akkauntlar, yuridik hujjatlar) bog'liq. Player'dagi bandlar raqobatchi ilova (Birgo) tahlilidan: do'konga chiqish uchun kerak bo'lganlari va tez qo'shiladiganlari.

| # | Ish | Kim | Fayllar | Holat |
|---|---|---|---|---|
| C1 | Player relizgacha: maxfiylik siyosati va foydalanish shartlari havolalari, bog'lanish, savol-javob; "Joy bo'shasa, xabar bering" (API tayyor: `/v1/matches/{id}/waitlist`, push `waitlist.offer`); maydon rasmi (`venues.cover_media_id`) va "Xaritada ochish"; filtrlar (tuman, format, faqat bo'sh joylar) va stadion nomi bo'yicha qidiruv (API — C6); "O'yin bo'ladi" belgisi (minimumga yetgan) | @MirolimSodiq | `apps/player` | — |
| C2 | EAS: development/preview build'lar, TestFlight va Google yopiq sinovi (shaxsiy akkauntda chiqishdan oldin ≥ 12 tester, 14 kun), push kalitlari (APNs, FCM), Sentry loyihasi | @MirolimSodiq | `apps/host`, `apps/player` | — |
| C3 | AI-Cam pilot: haqiqiy maydonda 90 daqiqalik yozuv (qizish, batareya, yuklash vaqti, bir o'yin narxi), jiletka raqami kadrda o'qilishi ([`AI_CAM.md`](AI_CAM.md) §11, §13.2) | @MirolimSodiq | — | — |
| C4 | Ko'p jamoali o'yinlar ([`AI_CAM.md`](AI_CAM.md) §13.5): 2–4 jamoa, o'yinchi bir necha jamoada, jiletka tarixi, stadion jiletka to'plami, pultda "Yangi o'yin: X–Y" — migratsiya `0013`; admin/API qismi kelishiladi (5-qoida) | @MirolimSodiq | `db/migrations/0013_*`, `apps/api/src/host`, `apps/api/src/admin`, `apps/admin`, `apps/host` | — |
| C5 | Production'ni ishga tushirish: bitta Hetzner server — Docker Compose, Caddy (HTTPS), GHCR + SSH deploy, rollback, kunlik backup va tiklash ([`DEPLOYMENT.md`](DEPLOYMENT.md) §10); AWS (Terraform) — o'sish bosqichi uchun saqlanadi | @MirolimProjects | `infra/hetzner`, `.github/workflows` | ✅ `feat/hetzner-deploy` (kod; serverni sozlash, Object Storage va domen — operator) |
| C6 | Discovery API: stadion nomi bo'yicha qidiruv, tuman va "faqat bo'sh joylar" filtrlari (C1 uchun) | @MirolimProjects | `apps/api/src/matches`, `api/openapi.yaml` | — |
| C7 | App Store review uchun demo kirish: production'da faqat bitta maxsus raqamga doimiy kod, audit bilan (Apple kirish talab qiladigan ilovadan demo akkaunt so'raydi) | @MirolimProjects | `apps/api/src/identity` | — |
| C8 | Minimal xavfsizlik: WAF / rate limit, API uchun cheklangan DB role ([`DEPLOYMENT.md`](DEPLOYMENT.md) cheklovlari) | @MirolimProjects | `infra/terraform`, `db` | — |
| C9 | Rahmat (Multicard) to'lovi: `payment_provider` ga `multicard` (migratsiya `0014`); server-to-server invoys (`POST /payment/invoice`, Bearer token 24 soat, `store_id`, summa tiyin'da, `ofd` — MXIK va `package_code`) → `checkout_url` player WebView'da; callback imzosi `md5(store_id + invoice_id + amount + secret)` (constant-time), idempotent tasdiqlash; javob kelmasa holatni so'rash va hold tugaganda invoysni bekor qilish; refund adapteri (to'liq/qisman, B8); player'da to'lov usuli; sandbox `dev-mesh.multicard.uz`. Keyin: saqlangan kartalar (karta biriktirish), host payout'lari kartaga (B9 avtomatlashadi), split — maydon ulushini to'g'ridan-to'g'ri (agentlik modeli). Payme/Click/Uzum'dan farqi: ular bizni chaqiradi, Multicard'ni biz chaqiramiz | kelishiladi (`payments` — @MirolimProjects) | `apps/api/src/payments`, `apps/api/src/commerce`, `apps/player`, `db/migrations/0014_*` | — |

### Kod bo'lmagan ishlar (biznes tomonni kim olib borsa)

| Ish | Izoh |
|---|---|
| Uzum checkout havolasi formati | Uzum menejeri bilan tasdiqlash |
| Haqiqiy Apple/Google client ID'lar | social login'ni haqiqiy credential bilan sinash |
| Push bosilganda deep link | haqiqiy qurilmada sinash |
| Payme / Click merchant shartnomalari | YaTT nomiga; komissiya, refund qoidalari |
| Rahmat (Multicard) merchant shartnomasi | YaTT nomiga; `application_id`, `secret`, `store_id`, sandbox kirish; komissiya va hisob-kitob muddati (saytda yo'q); xizmatimiz uchun MXIK va `package_code` (tasnif.soliq.uz) — barcha provayderlarda bir xil (C9) |
| Yuridik | biometrik ta'rif (video), davlat reyestri, waiver kuchi, host'lar bilan shartnoma (`ARCHITECTURE.md` §6) |
| Apple Developer va Google Play akkauntlari | **Qaror (2026-10-28): hozircha YaTT nomida, hamma narsa bitta shaxsda** (do'kon, Payme/Click/Rahmat, oferta, maxfiylik siyosati, fiskal chek). Apple yakka tadbirkorni Individual sifatida ro'yxatdan o'tkazadi — sotuvchi nomi shaxsiy ism; Google shaxsiy akkauntida chiqishdan oldin ≥ 12 tester bilan 14 kunlik yopiq sinov majburiy. Investor kirganda MChJ'ga o'tiladi: ilovani akkauntlar o'rtasida ko'chirish, to'lov tizimlarini qayta ulash, yangi oferta. Bo'lingan sxema (do'kon MChJ'da, pul YaTT'da) qo'llanmaydi |
| Soliq (buxgalter bilan) | YaTT rejimi va tushum chegaralari; agentlik modeli (soliq faqat komissiyadan, maydon ulushi — split); IT Park — PQ-388 (2026-04-01 dan marketpleys va to'lov tashkilotlariga imtiyoz yo'q), o'yin joyini sotish IT daromadi hisoblanadimi |
| Eskiz SMS shartnomasi | production'da kirish kodlari |
| Maxfiylik siyosati va foydalanish shartlari | yurist yozadi, veb-sahifada (C1 havolalari shunga) |
| Jiletka to'plamlari | har stadionga 4 rang × 8, raqamlar 1–8, 11–18, 21–28, 31–38 ([`AI_CAM.md`](AI_CAM.md) §13.2) |
| Birinchi 2–3 maydon va hostlar | yopiq sinov (pilot) o'yinlari uchun kelishuv |

### Keyinga qoldirilgan

| Ish | Nima uchun |
|---|---|
| Stripe / Apple Pay / PayPal | chet el yuridik shaxsi kerak (Phase 3) |
| Phase 1.5 / 2 | roster asosidagi sug'urta, balanslangan jamoalar, Teams/Leagues/Tournaments UI, social feed — MVP ishga tushgandan keyin |
| AI-Cam Bosqich B–D | Bosqich A'da dataset yig'ilgandan keyin |
| Raqobatchi tahlilidan keyingi g'oyalar | oylik reyting va kupon sovrinlari (hamyon promo krediti bor), "Joylar" bo'limi va maydon sahifasi, izohlar (moderatsiya kerak), saqlangan kartalar (Payme/Click tokenizatsiyasi), tungi rejim, ilovani baholash — MVP'dan keyin |

## Ikki kishi bo'lib ishlash

1. `main` ga to'g'ridan-to'g'ri push qilinmaydi: har ish o'z branch'ida → PR → CI yashil va ikkinchi odam ko'rib chiqqandan keyin merge.
2. Migratsiya raqamlari: `0006` — AI-Cam (@MirolimSodiq), `0009` dan boshlab — @MirolimProjects (`0009` — post-match job'lari, B3; `0010` — highlight moderatsiyasi, B4; `0011` — avto-refund'lar, B8; `0012` — host payout'larini to'lash, B9; `0013` — ko'p jamoali o'yinlar, C4, @MirolimSodiq; `0014` — Rahmat/Multicard, C9); bitta PR'da bir nechta kerak bo'lsa, shu yerda band qilinadi. Runner qo'llanganlarni `schema_migrations` da fayl nomi bo'yicha saqlaydi, shuning uchun raqamlar orasidagi bo'shliq va merge tartibi muammo emas.
3. Generatsiya qilinadigan fayllar (`apps/api/src/db/schema.ts`, `relations.ts`, `packages/contracts`, `pnpm-lock.yaml`) qo'lda tahrirlanmaydi, conflict ham qo'lda tuzatilmaydi: toza bazada `db:migrate` + `db:pull` (contracts uchun `contracts generate`, lock uchun `pnpm install`) qilinadi va natija commit qilinadi. `db:pull` deklaratsiyalarni nom bo'yicha saralaydi, importlar har nom alohida qatorda — bir xil migratsiyalardan doim baytma-bayt bir xil fayl chiqadi, diff faqat haqiqiy o'zgarishni ko'rsatadi. CI'dagi "Generated fayllar drift" job'i Drizzle sxemasi va `packages/contracts/src/schema.ts` manbadan farq qilsa PR'ni to'xtatadi.
4. `api/openapi.yaml` ga ikkalasi ham tegadi: PR'lar kichik, `main` dan tez-tez rebase.
5. Boshqa yo'nalish papkasiga tegish kerak bo'lsa (masalan, B7 → `apps/api/src/media/`) — oldin kelishiladi.
6. Har PR shu fayldagi o'z qatorini yangilaydi.
7. Review — GitHub'da **Approve** (Comment emas); merge — "Create a merge commit"; merge'dan oldin "Update branch", shunda CI `main` bilan birga tekshiradi.
8. Stacked PR'lardan qochiladi: kod bog'liq bo'lmasa har branch `main` dan ochiladi. Kerak bo'lsa pastdagisi birinchi merge qilinadi va keyingisining base'i `main` ga o'tkaziladi.
9. Branch'lar qisqa umrli: PR 1–3 kunda merge qilinadi; uzoqroq ishlansa, `main` har kuni branch'ga merge qilinadi.

## Ishlash tartibi (sessiyalar uchun)

- Har katta qism alohida sessiyada, o'z worktree'sida bajariladi. Dev baza, Redis DB, API porti va e2e bazasi har sessiyaga alohida beriladi (`E2E_DATABASE_URL`, `E2E_REDIS_URL`).
- Migratsiya raqamlari oldindan taqsimlanadi (yuqoridagi 2-qoida).
- Merge'dan keyin:
  1. `corepack pnpm install`;
  2. Drizzle sxemasini toza bazadan qayta generatsiya qilish (`db:migrate` + `db:pull`);
  3. `corepack pnpm --filter @matchup/contracts generate`;
  4. hamma tekshiruvlar: 6 paket typecheck, API e2e, host vitest, worker pytest, OpenAPI lint, admin build.
- Foydalanuvchi bilan o'zbek tilida (lotin) gaplashiladi; kod va texnik atamalar inglizcha qoladi.
