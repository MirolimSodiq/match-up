# Loyiha holati

> Oxirgi yangilanish: 2026-10-20, `main` = `0508e74`. Yangi Claude sessiyasi shu fayldan davom ettirishi mumkin: avval shuni, keyin `docs/ARCHITECTURE.md` ni o'qing.

## Bajarildi (`main` da)

| Qism | Natija | Tekshiruv |
|---|---|---|
| Arxitektura | `docs/ARCHITECTURE.md`: stack, DB, API, data residency (2026-yil mart qonuni), to'lovlar, compliance, roadmap | — |
| DB | migratsiyalar 0001–0005, dev seed, `db/tests/verify.sh` (oversell race) | 30/30 |
| Backend (`apps/api`) | auth (OTP, social: Google/Apple/Telegram), profil, discovery, waiver, booking, Payme/Click/hamyon, host panel, admin API, push va WebSocket, GDPR eksport/erasure, BullMQ job'lar, outbox | e2e 67/67 |
| Player ilovasi (`apps/player`) | Expo, yorug' sport dizayni, to'lov WebView, QR chipta, social login tugmalari, push, jonli slot'lar | tsc |
| Host ilovasi (`apps/host`) | takliflar, offline roster, QR skaner (Ed25519 offline), jamoalar, yakunlash, push | vitest 36/36 |
| Admin panel (`apps/admin`) | Next.js BFF, match/venue/host/refund/dashboard | build |
| Dizayn tizimi | `packages/ui` (tokenlar + RN komponentlar), `packages/contracts` (OpenAPI tiplari) | tsc |
| CI va infra | GitHub Actions, Dockerfile'lar (api, admin), lokal staging, Terraform (eu-central-1), Sentry, EAS, `docs/DEPLOYMENT.md` | terraform validate, actionlint |

## Jarayonda / merge qilinmagan

| Branch | Holat |
|---|---|
| `claude/youthful-turing-227f61` | Player profilidagi kirish usullari (identity bog'lash/uzish) va GDPR ekranlari — sessiya davom etmoqda, commit qilinmagan |
| `claude/compassionate-kalam-8eddc0` | `45101e9`: Postgres/Redis ulanishi uzilganda API yiqilmasligi + e2e test. `main` ga qo'shilmagan; `db.module.ts` dagi o'xshash o'zgarish bilan solishtirish kerak |

## Qoldi

| # | Ish | Izoh |
|---|---|---|
| 1 | Uzum Bank va kechki reconciliation (Payme `GetStatement`, Click hisobotlari) | 2-to'lqin |
| 2 | Highlight video yuklash: S3/MinIO presigned multipart, Python worker (FFmpeg → HLS), host'da yuklash, player'da feed | 2-to'lqin; AI-Cam Bosqich A uchun asos |
| 3 | **AI-Cam Engine** — rig, sinxronlash, tracking, bib orqali o'yinchini tanish, event'lar, reyting, `/v1/matches/{id}/analytics` | Phase 2, dizayn: [`docs/AI_CAM.md`](AI_CAM.md), bosqichlar A–D |
| 4 | Provider refund'larni avtomatlashtirish (hozir admin navbatida qo'lda) | Payme/Click API imkoniyatlariga bog'liq |
| 5 | Stripe / Apple Pay / PayPal | chet el yuridik shaxsi kerak (Phase 3) |
| 6 | Sinalmagan qismlar | push bosilganda deep link; haqiqiy client ID bilan Apple/Google login; CI haqiqiy GitHub'da (remote hali yo'q) |
| 7 | Phase 1.5 / 2 | roster asosidagi sug'urta, balanslangan jamoalar, Teams/Leagues/Tournaments UI, social feed |
| 8 | Yuridik | biometrik ta'rif (video), davlat reyestri, waiver kuchi, host'lar bilan shartnoma (`ARCHITECTURE.md` §6) |

## Ishlash tartibi (sessiyalar uchun)

- Har katta qism alohida sessiyada, o'z worktree'sida bajariladi. Dev baza, Redis DB, API porti va e2e bazasi har sessiyaga alohida beriladi; migratsiya raqamlari oldindan taqsimlanadi (keyingisi — `0006`, AI-Cam uchun band).
- Merge'dan keyin: `pnpm install`, Drizzle sxemasini toza bazadan qayta generatsiya qilish (`db:migrate` + `db:pull`), `@matchup/contracts generate`, keyin barcha typecheck va testlar.
- Foydalanuvchi bilan o'zbek tilida (lotin) gaplashiladi; kod va texnik atamalar inglizcha qoladi.
