# Deployment, CI va infratuzilma

Match Up qanday build qilinadi, tekshiriladi va serverga chiqariladi. Ikki yo'l:

- **Production (hozir) — bitta Hetzner server** (§10): Docker Compose, Caddy (avtomatik HTTPS), image'lar GHCR'da, deploy GitHub Actions'dan SSH orqali, kunlik backup Object Storage'ga.
- **AWS (Terraform, ECS) — o'sish bosqichi** (§4–§7): bir nechta API task, Multi-AZ RDS, CloudFront. Kod tayyor, lekin ishga tushirilmagan.

Region tanlovi va data residency sababi — [ARCHITECTURE.md §4.3](ARCHITECTURE.md#43-hosting-data-residency-va-multi-region).

| Qism | Fayl(lar) |
|---|---|
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml), [.github/actions/setup-pnpm](../.github/actions/setup-pnpm/action.yml) |
| Deploy — Hetzner (production) | [.github/workflows/deploy-hetzner.yml](../.github/workflows/deploy-hetzner.yml), [infra/hetzner](../infra/hetzner): `compose.yml`, `Caddyfile`, `env.example`, `bootstrap.sh`, `deploy.sh` (+ `deploy.test.sh`), `storage.sh`, `backup.sh`, `restore.sh`, `matchup` |
| Deploy — AWS | [.github/workflows/deploy.yml](../.github/workflows/deploy.yml), [infra/deploy/ecs-deploy.sh](../infra/deploy/ecs-deploy.sh) (+ `ecs-deploy.test.sh`), [modules/cell/deploy.tf](../infra/terraform/modules/cell/deploy.tf) |
| Image'lar | [apps/api/Dockerfile](../apps/api/Dockerfile), [apps/admin/Dockerfile](../apps/admin/Dockerfile), [.dockerignore](../.dockerignore) |
| Lokal staging | [docker-compose.staging.yml](../docker-compose.staging.yml), [infra/local/gen-staging-keys.sh](../infra/local/gen-staging-keys.sh) |
| Terraform | [infra/terraform](../infra/terraform): `modules/cell` (bitta cell — to'liq stack), `envs/staging`, `bootstrap` (state bucket) |
| Mobil build'lar | `apps/player/eas.json`, `apps/host/eas.json`, `app.config.ts` |
| Kuzatuv | Sentry: `apps/api/src/instrument.ts`, `apps/admin/src/instrumentation*.ts`, `apps/{player,host}/src/lib/sentry.ts`, `apps/{player,host}/metro.config.js` |

---

## 1. Lokal staging

Production image'lar bilan to'liq stack (api, admin, PostGIS, Valkey). Dev stack'dan (`docker-compose.yml`, 5432/6379) butunlay ajratilgan: boshqa project nomi (`matchup-staging`), o'z volume'i va 3200+ portlar.

```bash
./infra/local/gen-staging-keys.sh
```

```bash
docker compose -f docker-compose.staging.yml up -d --build
```

| Servis | Manzil |
|---|---|
| API | `http://localhost:3200` (`/health`) |
| Admin | `http://localhost:3201` |
| PostgreSQL | `localhost:3202` (`matchup` / `matchup_staging_local`) |
| Valkey | `localhost:3203` |

- `migrate` servisi API image'idagi `node dist/scripts/migrate.js --seed` ni bir marta ishga tushiradi (ECS'dagi migratsiya task'i bilan bir xil buyruq; `--seed` faqat lokal). `api` faqat migratsiya muvaffaqiyatli tugagandan keyin start oladi.
- `NODE_ENV=production`: API `OTP_PROVIDER=console` ni rad etadi, shuning uchun `eskiz` ishlatiladi. Haqiqiy SMS bilan login qilish uchun `ESKIZ_EMAIL` / `ESKIZ_PASSWORD` ni shell env yoki `--env-file .env.staging` orqali bering; aks holda stack ishlaydi, lekin OTP yuborilmaydi.
- Ed25519 kalitlar compose `secrets` orqali fayl sifatida keladi (`/run/secrets/jwt_private` ...), AWS'da esa Secrets Manager'dan (§5).
- Postgis image Apple Silicon'da amd64 emulyatsiyasida ishlaydi — sekinroq va ba'zan qulab qayta tiklanadi (pastdagi "Ma'lum cheklovlar"ga qarang).

To'xtatish va ma'lumotlarni o'chirish:

```bash
docker compose -f docker-compose.staging.yml down -v
```

## 2. CI (GitHub Actions)

`push` (`main`) va har `pull_request` da ishga tushadi. Hamma job'lar parallel:

| Job | Nima qiladi |
|---|---|
| `typecheck` | corepack + pnpm 10.12.1 (store keshi), `turbo run typecheck` (6 paket), host unit testlari (vitest) |
| `openapi-lint` | `npm exec --prefer-offline @redocly/cli@1.34.5 -- lint api/openapi.yaml` (`~/.npm` versiya bo'yicha keshlanadi, telemetriya o'chiq) |
| `api-e2e` | Service container'lar: `postgis/postgis:18-3.6` + `valkey/valkey:8-alpine` + MinIO (`bitnamilegacy/minio`, highlight upload testlari); `pnpm --filter @matchup/api test:e2e` |
| `media-worker` | `python:3.12-slim-trixie` konteynerida (production image bilan bir xil base) Debian FFmpeg + `uv`: `services/media-worker` pytest (test videolari lavfi bilan generatsiya qilinadi) |
| `db-verify` | PGDG'dan PostgreSQL 18 `psql` + `pgbench`, `db/tests/verify.sh` ni `DATABASE_URL` rejimida |
| `admin-build` | `turbo run build --filter=@matchup/admin` (`.next/cache` keshlanadi) |
| `docker` | api, admin va media-worker image'larini build qiladi (push yo'q), GHA cache |
| `terraform` | `infra/terraform/check.sh`: `fmt -check` + `validate` (credential'siz) |
| `deploy-script` | `shellcheck` + `infra/deploy/ecs-deploy.test.sh` — deploy skripti soxta `aws` CLI bilan (tartib, image almashtirish, migratsiya xatosi, circuit breaker rollback, yo'q image); Hetzner: `shellcheck`, `infra/hetzner/deploy.test.sh` (soxta `docker`: `.env` tekshiruvi, tartib, login/logout, migratsiya xatosi, rollback, yozuv lane'i band, `--restart`), `compose.yml` va `Caddyfile` validatsiyasi |
| `actionlint` | workflow'larni tekshiradi |

Deploy — alohida workflow'lar: `deploy-hetzner.yml` (§10) va `deploy.yml` (AWS, §6) — `main` dagi CI muvaffaqiyatli tugagach avtomatik, har biri o'z variable'i (`HETZNER_HOST` / `STAGING_AWS_DEPLOY_ROLE_ARN`) berilgandagina ishlaydi.

Lokal tekshirish (CI bilan bir xil buyruqlar):

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
```

```bash
./infra/terraform/check.sh
```

```bash
corepack pnpm turbo run typecheck
```

### `db/tests/verify.sh` rejimlari

| Rejim | Buyruq | psql/pgbench |
|---|---|---|
| Lokal (standart) | `./db/tests/verify.sh` | `docker compose exec db` ichida |
| CI / tashqi server | `DATABASE_URL=postgres://user:pass@host:5432/postgres ./db/tests/verify.sh` | PATH'dagi PostgreSQL 18 client |

`DATABASE_URL` faqat server va credential'lar uchun: undagi bazaga tegilmaydi, test bazasi (`VERIFY_DB`, standart `matchup_test`) `postgres` bazasi orqali noldan yaratiladi. Bir serverda parallel ishga tushirishda `VERIFY_DB` ni farqli qiling.

## 3. Docker image'lar

Ikkala Dockerfile ham repo ildizidan build qilinadi: `turbo prune <paket> --docker` -> faqat kerakli workspace'lar va qisqartirilgan lockfile (API uchun ~650 paket, Expo/RN'siz) -> `pnpm install` (BuildKit cache) -> build -> minimal runtime stage. Ikkalasi ham `node` (uid 1000) foydalanuvchisi ostida, `HEALTHCHECK` bilan.

```bash
docker build -f apps/api/Dockerfile -t matchup-api .
```

```bash
docker build -f apps/admin/Dockerfile -t matchup-admin .
```

**API** (`node:24-alpine`, ~480 MB):
- `dist/` + `pnpm deploy --prod` node_modules + `db/migrations/`. Dev seed image'da **yo'q**.
- Migratsiya — alohida bir martalik buyruq: `node dist/scripts/migrate.js` (`MIGRATIONS_DIR=/app/db/migrations` image'da o'rnatilgan).
- RDS CA bundle (`NODE_EXTRA_CA_CERTS`) — `DATABASE_URL ...?sslmode=verify-full` bilan sertifikat va hostname tekshiriladi.
- Entrypoint: ilova Ed25519 kalitlarni faqat fayldan o'qiydi (`*_KEY_FILE`). Kalit env orqali PEM matni sifatida kelsa (`JWT_PRIVATE_KEY=...`, ECS), entrypoint uni `/tmp/matchup-keys/` ga 0600 bilan yozadi, `*_KEY_FILE` ni o'rnatadi va PEM'ni env'dan o'chiradi. Fayl orqali kelsa (docker secrets) hech narsa qilinmaydi.
- `/health` DB va Valkey'ni tekshiradi.
- GDPR eksport fayllari (`STORAGE_DIR`, standart `/app/storage`) — image'dagi yagona `node` yoza oladigan papka; Hetzner'da unga volume ulanadi (restart'da fayllar qoladi).

**Media worker** (`services/media-worker/Dockerfile`, `python:3.12-slim-trixie` + FFmpeg 7.1 + `uv`, ~970 MB — FFmpeg kutubxonalari): `python -m media_worker`, uid 10001, root FS read-only (ish papkasi `/tmp/media-worker`), `HEALTHCHECK` — `python -m media_worker health` (navbat sikli heartbeat'i < 2 daq). Kontekst — `services/media-worker`:

```bash
docker build -t matchup-media-worker services/media-worker
```

**Admin** (Next.js `output: 'standalone'`, ~330 MB): `apps/admin/server.js`, port 3100. Runtime env: `API_URL`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`. Brauzer Sentry DSN build vaqtida inline qilinadi: `--build-arg NEXT_PUBLIC_SENTRY_DSN=...`.

## 4. Terraform

```
infra/terraform/
  bootstrap/          state uchun S3 bucket (bir marta, lokal state)
  modules/cell/       bitta region cell'i: VPC, ECS, ALB, RDS, Valkey, S3+CloudFront, ECR, Secrets, KMS, IAM, loglar
  envs/staging/       staging: modulni chaqiradi, backend, provider (eu-central-1)
  check.sh            fmt -check + validate (Docker, credential'siz)
```

| Resurs | Staging | Modul standarti (prod uchun) |
|---|---|---|
| VPC | 2 AZ, public + private subnet, 1 NAT | har AZ'da NAT |
| ECS Fargate | api (1-2 task, FARGATE_SPOT), admin, migrate task def; ARM64 | api 2-6 task, FARGATE |
| Media worker | `media-worker` — kliplar (`matchup:media-jobs`, 1 vCPU / 2 GB, Spot, 1-2 task); `media-worker-recording` — AI-Cam to'liq o'yin yozuvlari (`matchup:media-jobs:recording`, 4 vCPU / 8 GB / 120 GiB ephemeral, on-demand, **0-3 task**, job paytida task protection). Kengayish — navbat bo'yicha (pastda) | bir xil image, lane `MEDIA_JOBS_STREAM` bilan |
| ALB + ACM | HTTPS (TLS 1.3 siyosati), HTTP -> HTTPS, host bo'yicha marshrut | — |
| RDS PostgreSQL 18 | db.t4g.medium, **Multi-AZ**, PITR 7 kun, KMS, `rds.force_ssl` | db.m7g.large, PITR 35 kun, deletion protection |
| ElastiCache Valkey | 1 node, TLS + AUTH, `noeviction` (BullMQ) | 2 node, failover, Multi-AZ |
| S3 + CloudFront | private bucket, OAC, `raw/` 30 kunda, to'liq o'yin HLS (`recordings/`) 90 kunda o'chadi | ixtiyoriy signed URL (`media_signing_public_key_pem`) |
| ECR | `matchup-staging/api`, `/admin` — immutable teglar, push'da skan | — |
| Secrets Manager | §5 | — |
| CloudWatch Logs | 30 kun, KMS | 90 kun |

**Media worker autoscaling** (`media_worker.tf`):

| | |
|---|---|
| Metrika | API (`media-queue-metrics` job'i, har 60 s) har lane uchun `MatchUp/MediaQueue` → `Backlog` (guruhga hali yetkazilmagan + ACK qilinmagan), `InFlight`, `OldestJobAgeSeconds`; o'lchamlar `Cell`, `Lane`. CloudWatch Embedded Metric Format — stdout'dagi JSON qator, awslogs metrikaga aylantiradi (IAM/SDK kerak emas). Metrikani API chiqaradi, chunki yozuv lane'ida task 0 bo'lishi mumkin |
| Kengayish | `Backlog − RunningTaskCount ≥ 1` (worker bir vaqtda bitta job oladi) → step: 1–2 job +1, 3–5 +2, 6+ +3 (`max_count` gacha); cooldown kliplar 120 s, yozuv 300 s |
| Qisqarish | `Backlog = 0` kliplar 10, yozuv 15 daqiqa → bittaga, `min_count` gacha (yozuv — 0). Ishlanayotgan job backlog'da qoladi — band task'ga scale-in tegmaydi |
| Himoya | Yozuv worker'i job paytida ECS task scale-in protection'ni yoqadi (`ECS_TASK_PROTECTION`, 60 daq, har 15 daqiqada yangilanadi, job tugagach o'chiriladi): scale-in ham, deploy ham ishlayotgan kodlashni to'xtatmaydi. Deploy skripti bu servisni kutmaydi (`wait: false`) — eski task job tugagach almashtiriladi |
| API metrika yubormasa | alarm'lar `notBreaching` — hech narsa o'zgarmaydi (kengaymaydi ham, qisqarmaydi ham) |

Xavfsizlik bo'yicha:
- **Eng kam huquq:** har task turi (api, migrate, admin) uchun alohida execution role — faqat o'z ECR repo'si, log group'i va secret'lari. API task role faqat media bucket obyektlariga. DB va Valkey'ga faqat API security group'idan kirish.
- **Parollar state'ga yozilmaydi:** RDS master paroli va Valkey AUTH token — `ephemeral "random_password"` + write-only argumentlar (`password_wo`, `auth_token_wo`, `secret_string_wo`), Terraform >= 1.11.
- **Data residency guard:** region `allowed_regions` (standart `["eu-central-1"]`) da bo'lmasa, plan precondition bilan to'xtaydi.
- Loglarda PII yo'q: RDS `log_parameter_max_length = 0` (sekin so'rovlar logiga bind parametrlar — telefon va h.k. — yozilmaydi).

### Birinchi marta sozlash (operator, AWS credential bilan)

1. State bucket va GitHub Actions OIDC provider (hisob bo'yicha bitta; output'lar: `state_bucket`, `github_oidc_provider_arn`):
   ```bash
   cd infra/terraform/bootstrap && terraform init && terraform apply
   ```
2. `envs/staging/terraform.tfvars` da `route53_zone_id`, `api_domain`, `admin_domain` ni haqiqiy qiymatlar bilan almashtiring (domen Route53'da bo'lishi kerak — ACM DNS validatsiyasi va alias yozuvlar avtomatik). CI deploy uchun `github_oidc_provider_arn` (1-qadam output'i), host no-show ogohlantirishlari uchun `ops_telegram_chat_id` (bot guruhga qo'shilgan bo'lsin).
3. Init (bucket nomi bootstrap output'idan):
   ```bash
   cd infra/terraform/envs/staging && terraform init -backend-config="bucket=matchup-terraform-state-<account_id>"
   ```
4. Avval ECR'ni yaratib image'larni push qiling (ECS servislari mavjud tegni kutadi):
   ```bash
   terraform apply -target=module.cell.aws_ecr_repository.app
   ```
   Image'lar Fargate arxitekturasi uchun build qilinadi (standart ARM64): `docker buildx build --platform linux/arm64 -f apps/api/Dockerfile -t <ecr>/api:<sha> --push .`
   (`media-worker` — `-f services/media-worker/Dockerfile services/media-worker`.)
5. To'liq apply — faqat birinchi marta teglar bilan (ular `/<name>/image-tags/*` SSM parametrlariga boshlang'ich qiymat bo'lib yoziladi; keyin teglarni CI boshqaradi):
   ```bash
   terraform apply -var api_image_tag=<sha> -var admin_image_tag=<sha> -var media_worker_image_tag=<sha>
   ```
6. Qo'lda to'ldiriladigan secret'larni kiriting (§5), so'ng birinchi deploy (migratsiya + servislar):
   ```bash
   infra/deploy/ecs-deploy.sh matchup-staging <sha>
   ```
7. CI deploy'ni yoqish: GitHub repo → Settings → Secrets and variables → Actions → **Variables**: `STAGING_AWS_DEPLOY_ROLE_ARN` = `terraform output -json cell | jq -r .deploy_role_arn`. Ixtiyoriy: `STAGING_ADMIN_SENTRY_DSN` (admin brauzer DSN'i). `staging` environment birinchi deploy'da avtomatik yaratiladi; xohlasangiz Settings → Environments → staging da "Required reviewers" yoqing (har deploy tasdiq bilan).

### Prod qo'shish

`envs/staging` ni `envs/prod` ga nusxalang va: backend `key = "cells/uz-1/prod.tfstate"`, `name = "matchup-prod"`, `environment = "prod"`, yangi `vpc_cidr` (masalan `10.30.0.0/16`), staging override'larini olib tashlang (modul standartlari prod uchun mo'ljallangan: Multi-AZ, PITR 35 kun, har AZ'da NAT, FARGATE, deletion protection, ECS Exec o'chiq). `check.sh` dagi ro'yxatga `envs/prod` ni qo'shing. Yangi davlat cell'i ham xuddi shunday — `allowed_regions` o'sha davlat qonuniga qarab.

## 5. Secret'lar

Barcha maxfiy qiymatlar Secrets Manager'da (`matchup-<env>/...`, cell KMS kaliti bilan shifrlangan). ECS ularni task start'da env sifatida beradi; image va Terraform state'da secret yo'q.

| Secret | JSON kalitlari -> env | Kim to'ldiradi |
|---|---|---|
| `database-url` | butun qiymat -> `DATABASE_URL` (api, migrate) | Terraform (write-only) |
| `redis-url` | butun qiymat -> `REDIS_URL` | Terraform (write-only) |
| `signing-keys` | `jwt_private_key`, `jwt_public_key`, `ticket_private_key`, `ticket_public_key` -> `JWT_PRIVATE_KEY` ... (entrypoint faylga yozadi) | qo'lda |
| `payme` | `merchant_id`, `key` -> `PAYME_MERCHANT_ID`, `PAYME_KEY` | qo'lda |
| `click` | `service_id`, `merchant_id`, `secret_key` -> `CLICK_*` | qo'lda |
| `eskiz` | `email`, `password` -> `ESKIZ_EMAIL`, `ESKIZ_PASSWORD` | qo'lda |
| `sentry` | `api_dsn` -> api `SENTRY_DSN`, `admin_dsn` -> admin `SENTRY_DSN` (bo'sh = o'chiq) | qo'lda |
| `media-worker-token` | butun qiymat -> `MEDIA_WORKER_TOKEN` (api va media-worker; `/internal/media/*`) | Terraform (write-only, `media_worker_token_version`) |
| `media-cdn` | `private_key` -> `MEDIA_CDN_PRIVATE_KEY` (entrypoint faylga yozadi). Faqat `media_signing_public_key_pem` berilganda ishlatiladi | qo'lda |
| `telegram` | `bot_token` -> `TELEGRAM_BOT_TOKEN` (Telegram login va host no-show ogohlantirishlari; guruh — `ops_telegram_chat_id` o'zgaruvchisi). Bo'sh = ikkalasi ham o'chiq | qo'lda |

Terraform qo'lda to'ldiriladigan secret'larga bir marta bo'sh JSON skeletini yozadi va keyin ularga tegmaydi. To'ldirish (kalitlar `pnpm keys:gen` dagi kabi Ed25519, PKCS#8 / SPKI PEM):

```bash
aws secretsmanager put-secret-value --secret-id matchup-staging/signing-keys --secret-string file://signing-keys.json
```

Bo'sh qoldirilsa: `eskiz` yoki `signing-keys` — API start olmaydi (aniq xato xabari bilan), `sentry` — monitoring o'chiq. Secret o'zgargandan keyin servisni `--force-new-deployment` bilan qayta ishga tushiring (ECS secret'ni faqat start'da o'qiydi).

CloudFront signed URL: RSA 2048 kalit juftligi yarating (`openssl genrsa -out cf.pem 2048 && openssl rsa -pubout -in cf.pem -out cf.pub.pem`), public qismini `media_signing_public_key_pem` ga bering (key group + `MEDIA_CDN_KEY_PAIR_ID` avtomatik), private qismini `media-cdn` secret'ining `private_key` ga yozing. Berilmasa API ijro uchun S3 presigned GET beradi (CloudFront chetlab o'tiladi).

Rotatsiya: DB paroli — `db_password_version` ni 1 ga oshirib apply (RDS va `database-url` bir run'da yangilanadi), keyin servislarni qayta deploy; Valkey — `cache_auth_token_version` (ROTATE strategiyasi: eski token o'tish davrida ishlaydi).

Mobil va lokal:

| O'zgaruvchi | Qayerda |
|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | EAS environment variables (`eas env:create`), profil bo'yicha |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | EAS secret — source map yuklash (berilmasa plugin o'chiq) |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` | API / admin runtime env (lokal `.env`) |

## 6. Deploy va migratsiya tartibi

Migratsiyalar **har doim kod deploy'idan oldin** va **orqaga mos** (expand -> contract) bo'lishi kerak: yangi sxema bilan eski kod ham ishlay olsin. Ustun/jadvalni o'chirish yoki nomini o'zgartirish — keyingi relizda, kod unga murojaat qilmay qo'ygandan keyin. Mavjud migratsiya fayllari o'zgartirilmaydi (README).

**Avtomatik (staging):** `main` ga merge -> CI yashil -> `deploy.yml`. Actions → Deploy → **Run workflow** — istalgan commit/branch (rollback ham shu).

| Job | Nima qiladi |
|---|---|
| `prepare` | commit -> teg (to'liq SHA); OIDC bilan AWS; ECR'da qaysi image'lar hali yo'qligini aniqlaydi (teglar o'zgarmas — qayta deploy va rollback qayta build qilmaydi) |
| `build` (matritsa) | yo'q image'larni `linux/arm64` (Fargate ARM64; x86 runner'da QEMU) uchun build qilib ECR'ga push |
| `deploy` | `infra/deploy/ecs-deploy.sh matchup-staging <sha>` |

`ecs-deploy.sh` (CI va operator uchun bir xil; nomlar `/<name>/deploy/config` SSM parametridan — Terraform yozadi):
1. Migratsiya task definition'ining yangi revision'i (faqat image almashadi) -> `run-task` -> `exit 0` kutiladi. Xato bo'lsa — migratsiya logining oxiri chiqariladi, servislarga tegilmaydi.
2. Har servis (api, admin, media-worker, media-worker-recording): joriy task definition'dan faqat image almashgan revision -> `update-service`.
3. Hammasi barqaror bo'lishi kutiladi; ECS circuit breaker biror servisni orqaga qaytarsa — deploy xato bilan tugaydi. `media-worker-recording` kutilmaydi (`wait: false`): kodlayotgan task himoyalangan va job tugagach (soatlab) almashtiriladi.
4. Joriy teglar SSM'ga (`/<name>/image-tags/{migrate,api,admin,media-worker}`).

**Terraform va teglar:** task definition'lar image tegini shu SSM parametrlaridan oladi — operatorning keyingi `terraform apply` i deploy qilingan versiyani orqaga qaytarmaydi va `-var *_image_tag` berish shart emas. CI ro'yxatdan o'tkazgan revision'ni Terraform o'zinikiga almashtiradi (bir xil image) — shuning uchun deploy'dan keyingi birinchi `apply` servislarni bir marta qayta ishga tushiradi. `-var api_image_tag=...` berilsa SSM'dan ustun (favqulodda holat), keyingi CI deploy uni almashtiradi.

**CI role** (`<name>-github-deploy`) tor: faqat shu cell'ning ECR repo'lariga push, ECS servislarini yangilash, migratsiya task'i, shu cell role'larini ECS'ga berish (`iam:PassRole`), image-tag parametrlari va migratsiya logini o'qish. VPC, RDS, IAM, secret qiymatlariga huquq yo'q. Trust: faqat `repo:<github_repository>:environment:staging` — boshqa branch, PR yoki fork emas.

**Qo'lda (operator):** image'larni build/push qilib (§4, 4-qadam), so'ng:

```bash
infra/deploy/ecs-deploy.sh matchup-staging <sha>
```

ECS rolling deploy: yangi task'lar `/health` dan o'tmaguncha eski task'lar ishlaydi.

## 7. Rollback

| Holat | Harakat |
|---|---|
| Yangi task'lar sog'lom bo'lmadi | ECS deployment circuit breaker avtomatik oldingi task definition'ga qaytaradi |
| Deploy o'tdi, lekin xato bor | Actions → Deploy → Run workflow → `ref` = oldingi SHA (image'lar ECR'da bor — qayta build yo'q, ECR oxirgi 50 tasini saqlaydi). Migratsiya qaytarilmaydi (expand -> contract tufayli eski kod yangi sxema bilan ishlaydi) |
| Migratsiya xato qildi | Migratsiyalar forward-only: xatoni tuzatuvchi yangi migratsiya yozing. Expand -> contract qoidasi tufayli eski kod yangi sxema bilan ishlayveradi |
| Ma'lumot buzildi | RDS PITR: retention oynasi ichidagi istalgan soniyaga **yangi** instance'ga tiklash (`aws rds restore-db-instance-to-point-in-time`), tekshirib, `database-url` secret'ini yangi endpoint'ga o'tkazish va servislarni qayta deploy qilish |
| Secret noto'g'ri | Secrets Manager'da oldingi versiyaga qaytarish (`AWSPREVIOUS`), servisni `--force-new-deployment` |

## 8. Kuzatuv (Sentry) va loglar

| Ilova | Qayerda init | DSN |
|---|---|---|
| API | `src/instrument.ts` — `main.ts` ning birinchi import'i | `SENTRY_DSN` |
| Admin | `src/instrumentation.ts` (server), `src/instrumentation-client.ts` (brauzer) | `SENTRY_DSN` (runtime), `NEXT_PUBLIC_SENTRY_DSN` (build) |
| Player, Host | `src/lib/sentry.ts` — `src/app/_layout.tsx` ning birinchi import'i | `EXPO_PUBLIC_SENTRY_DSN` |

- DSN bo'sh bo'lsa SDK umuman yuklanmaydi (API'da `require` ham qilinmaydi, admin'da chunk yuklanmaydi, mobil'da native modul chaqirilmaydi — Expo Go'da xavfsiz).
- API'da kutilmagan xatolar: `ProblemFilter` ularni pino'ga `error` darajasida yozadi -> Sentry `pinoIntegration` event yaratadi (AppModule'ga tegilmagan).
- **PII:** SDK `dataCollection` bilan user, cookie, body, query string, DB parametrlarini yig'maydi; qo'shimcha `beforeSend` pino `redact` bilan bir xil kalitlarni (authorization, cookie, phone, code, *token, IP) va telefon raqamlarini (`+998…`, URL-encoded `%2B998…`) tozalaydi. Mobil'da screenshot, view hierarchy va console breadcrumb'lar o'chiq, URL query'lari (koordinatalar) olib tashlanadi. Lokal soxta Sentry qabul qiluvchisi bilan tekshirilgan: telefon, token, cookie, device id, IP va PEM event'ga tushmaydi.
- Tracing standart o'chiq (`SENTRY_TRACES_SAMPLE_RATE=0`).
- **Mobil source map'lar:** `metro.config.js` — `getSentryExpoConfig`. Expo source map'ga `debugId` ni o'zi yozadi, Sentry serializer'i esa shu ID'ni bundle'ga ham qo'shadi (`_sentryDebugIds`) — SDK uni event'ga biriktiradi va Sentry yuklangan source map'ni topadi. Yuklashni EAS build'da Sentry plugin'i qiladi (`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, §5). `sentry-cli` binary'si platforma paketidan keladi (`@sentry/cli-darwin`, `-linux-x64`), shuning uchun uning postinstall script'i `pnpm-workspace.yaml` da `ignoredBuiltDependencies`. Tekshirish: `npx expo export --platform ios --source-maps` — `.hbc` da `sentry-dbid-<id>`, `.map` da xuddi shu `debugId`.
- Loglar: ECS -> CloudWatch `/ecs/<name>/{api,admin,migrate}` (KMS, retention), JSON (pino) — CloudWatch Logs Insights bilan qidiriladi.

## 9. Mobil build'lar (EAS)

`apps/player/eas.json` va `apps/host/eas.json`, profil `APP_VARIANT` orqali `app.config.ts` ga uzatiladi (`app.json` o'zgarmagan):

| Profil | Bundle id (player / host) | API | Tarqatish |
|---|---|---|---|
| `development` | `uz.matchup.player.dev` / `uz.matchup.host.dev` | Metro host'idagi lokal API (`:3000`) | internal, dev client |
| `preview` | `uz.matchup.player.preview` / `uz.matchup.host.preview` | `https://api.staging.matchup.uz` | internal (Android APK) |
| `production` | `uz.matchup.player` / `uz.matchup.host` | `https://api.matchup.uz` | store, build raqami avtomatik |

Profil belgilanmagan lokal `expo start` da hamma narsa avvalgidek (Expo Go). `development` profili dev client — dev build'ga o'tilganda `npx expo install expo-dev-client` kerak bo'ladi (eas-cli buni o'zi taklif qiladi); u o'rnatilgach `expo start` standart ravishda Expo Go o'rniga dev build'ni ochadi.

```bash
cd apps/player && npx eas-cli build --profile preview --platform android
```

### Android: Google Play yopiq sinov

**Ruxsatlar** (`app.json` → `android.blockedPermissions`): ikkala ilovada `SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE` olib tashlangan, player'da `READ/WRITE_CALENDAR` ham. "Kalendarga qo'shish" Android'da tizim oynasi (`ACTION_INSERT`) orqali — ruxsatsiz; host galereyasi tizim Photo Picker'i — ruxsatsiz (shuning uchun `pickClip.ts` Android'da media ruxsatini so'ramaydi). Host'da `CAMERA` va `RECORD_AUDIO` `expo-camera` dan keladi — `expo-image-picker` konfiguratsiyasida `cameraPermission: false` / `microphonePermission: false` yozilmasin: plagin ularni butun ilova uchun bloklaydi (QR skaner va kamera rejimi Android'da ishlamay qoladi). Tekshirish: `APP_VARIANT=production npx expo config --type introspect` → `_internal.modResults.android.manifest`.

**Push (FCM).** Bildirishnomalar Expo Push orqali, Android uchun Firebase kerak:
1. Firebase loyihasida build qilinadigan har paket Android ilova sifatida ro'yxatdan o'tadi: `uz.matchup.player`, `uz.matchup.player.preview`, `uz.matchup.host`, `uz.matchup.host.preview` (dev build bo'lsa `.dev` lar ham). Bitta `google-services.json` hamma paketlarni o'z ichiga oladi.
2. Fayl EAS'ga fayl turidagi environment variable `GOOGLE_SERVICES_JSON` sifatida (`production` va `preview` muhitlari, ikkala EAS loyihasi) — `app.config.ts` yo'lni shundan oladi; git'ga qo'shilmaydi (`.gitignore`). Lokal build'da: `GOOGLE_SERVICES_JSON=./google-services.json`.
3. FCM V1 kaliti: Firebase → Service accounts → private key (JSON) → `npx eas-cli credentials` → Android → Google Service Account → push notifications (FCM V1).

**Play Console va yuklash:**
1. Ilova (`uz.matchup.player`, keyin host) → App content: maxfiylik siyosati URL, App access (tekshiruvchi uchun demo raqam va doimiy kod — STATUS C7), reklama yo'q, kontent reytingi, maqsadli yosh, Data safety (telefon, ism, joylashuv, to'lov tarixi, host'da foto/video, push uchun qurilma ID); store listing (ikonka 512×512, banner 1024×500, skrinshotlar).
2. `npx eas-cli build --profile production --platform android` → AAB (build raqami EAS'da avtomatik). **Birinchi** AAB Play Console → Testing → Closed testing'ga qo'lda yuklanadi.
3. Keyingilari: `npx eas-cli submit --profile production --platform android` — `alpha` (yopiq sinov) yo'lagiga `draft` bo'lib tushadi, testerlarga chiqarish Play Console'da tasdiqlanadi. Buning uchun Play Console API ruxsati berilgan service account kaliti `eas credentials` ga ("Google Service Account Key for Play Store Submissions").
4. Shaxsiy akkauntda production'dan oldin ≥ 12 tester (Gmail) 14 kun uzluksiz yopiq sinovda bo'lishi kerak — pilot o'yinchilari bilan (STATUS C2/C3). Host ilovasi production'siz yopiq yoki ichki sinovda qolishi mumkin.

## 10. Production: bitta Hetzner server

MVP va yopiq sinov uchun hamma narsa bitta serverda, Docker Compose bilan ([infra/hetzner/compose.yml](../infra/hetzner/compose.yml)). Tashqariga faqat Caddy (80/443) ochiq; PostgreSQL, Valkey, API va admin — ichki Docker tarmog'ida. Video fayllar serverda emas, Hetzner Object Storage'da (S3 API) — telefonlar ularga to'g'ridan-to'g'ri presigned URL bilan yuklaydi va ijro etadi.

| Servis | Image | Izoh |
|---|---|---|
| `caddy` | `caddy:2.11.7-alpine` | TLS (Let's Encrypt, avtomatik yangilanadi), `API_DOMAIN` -> api, `ADMIN_DOMAIN` -> admin; `/internal/*` tashqaridan 404; deploy paytida so'rovlar yangi API konteynerini 30 s kutadi (`lb_try_duration`); HSTS |
| `db` | `postgis/postgis:18-3.6` | 8 GB server uchun sozlangan (`PG_SHARED_BUFFERS`, ...), sekin so'rovlar logida parametrlar yo'q |
| `redis` | `valkey/valkey:8-alpine` | AOF (restart'da navbat va stream'lar qoladi), `noeviction`, `maxmemory` |
| `migrate` | api image | faqat `deploy.sh` ishga tushiradi, servislardan oldin |
| `api` | `ghcr.io/<owner>/<repo>/api:<sha>` | `RUN_WORKERS=true` (BullMQ job'lari shu yerda), kalitlar fayl orqali (`/run/secrets`), GDPR eksport volume'da |
| `admin` | `.../admin:<sha>` | `API_URL=http://api:3000` |
| `media-worker` | `.../media-worker:<sha>` | kliplar navbati; `cpu_shares` past — CPU talashilganda API ustun |
| `media-worker-recording` | xuddi shu | AI-Cam to'liq yozuvlari; ish papkasi diskda (`media-work` volume); kodlayotgan bo'lsa deploy uni qayta yaratmaydi |

### Server va hajm

| | Minimum (kliplar, pilot) | AI-Cam to'liq yozuvlari bilan |
|---|---|---|
| CPU / RAM | 4 vCPU / 8 GB | 8 vCPU (dedicated) / 16 GB |
| Disk | 80 GB | 160 GB+ (90 daqiqalik 4K yozuv ~10–25 GB + natija; yoki Hetzner Volume) |

2 GB'li server yetmaydi (PostgreSQL + API + Next.js + FFmpeg). Hetzner Console -> server -> **Rescale**: IP o'zgarmaydi; faqat "CPU and RAM" tanlansa keyin kichraytirish mumkin. OS — Ubuntu 24.04. Location — Helsinki yoki Germaniya: Finlyandiya ham, Germaniya ham O'zbekiston adekvat ro'yxatida ([ARCHITECTURE.md §4.3](ARCHITECTURE.md#43-hosting-data-residency-va-multi-region)). Object Storage — server bilan bir location'da (`hel1`, `fsn1`, `nbg1`). Hetzner'ning server **Backups** funksiyasini yoqish tavsiya etiladi (kunlik snapshot — `.env` va kalitlar ham shunda).

### Birinchi marta sozlash

1. **Object Storage** (Hetzner Console -> Object Storage): server location'ida uchta **private** bucket — xom yuklamalar, natijalar, backup'lar (nomlar butun Hetzner bo'yicha yagona, masalan `matchup-raw-<tasodifiy>`), keyin **S3 credentials** (secret faqat bir marta ko'rsatiladi).
2. **Server** — skriptni serverga ko'chirib, root sifatida (Docker, `deploy` foydalanuvchisi, ufw 22/80/443, fail2ban, avtomatik xavfsizlik yangilanishlari, swap, Ed25519 kalitlar, `.env`, kunlik backup timer'i, `matchup` buyrug'i):
   ```bash
   scp infra/hetzner/bootstrap.sh root@<ip>:
   ```
   ```bash
   ssh root@<ip> bash bootstrap.sh --email <ops-email>
   ```
   Oxirida GitHub uchun qiymatlar chiqadi: `HETZNER_HOST`, `HETZNER_KNOWN_HOSTS` va GitHub Actions'ning SSH kaliti (ekranga chiqqach serverdan o'chiriladi — o'sha zahoti nusxalanadi; skript yarmida to'xtasa, qayta ishga tushirilganda kalit baribir chiqadi; o'z kalitingiz bo'lsa — `--deploy-key "ssh-ed25519 ..."`). Root'da SSH kalit bo'lsa parol bilan kirish o'chiriladi. Skriptni qayta ishga tushirish xavfsiz.
3. **`.env`** (`/opt/matchup/.env`, `nano` bilan): `change-me` qiymatlari — S3 kalitlari va bucket nomlari, `ACME_EMAIL`, `ESKIZ_*` (API usiz ishga tushmaydi). Ixtiyoriy — Payme/Click/Uzum/Rahmat, Telegram, Sentry, Google/Apple; ro'yxat va izohlar — [env.example](../infra/hetzner/env.example). Qiymatsiz qator (`KEY=`) qoldirilmaydi. `DB_PASSWORD`, `MEDIA_WORKER_TOKEN` bootstrap generatsiya qilgan — o'zgartirilmaydi.
4. **GitHub** -> repo Settings -> Secrets and variables -> Actions: **Variables** `HETZNER_HOST`, `HETZNER_KNOWN_HOSTS`; **Secrets** `HETZNER_SSH_KEY`. Ixtiyoriy: `HETZNER_PLATFORM=linux/arm64` (ARM server), `PRODUCTION_ADMIN_SENTRY_DSN`. `production` environment birinchi deploy'da yaratiladi — Settings -> Environments -> production -> "Required reviewers" bilan har deploy tasdiqlanadigan qilish mumkin.
5. **Birinchi deploy:** Actions -> **Deploy (Hetzner)** -> Run workflow (`main`). Tekshirish: `https://<API_DOMAIN>/health` va `https://<ADMIN_DOMAIN>`.
6. **Birinchi admin:** admin panelga telefon bilan kiring (rol yo'qligi uchun rad etiladi), so'ng serverda:
   ```bash
   matchup exec db psql -U matchup -c "INSERT INTO user_roles (user_id, role) SELECT id, 'admin' FROM users WHERE phone_e164 = '+998XXXXXXXXX'"
   ```
7. **Tashqi xizmatlar:** Payme/Click/Uzum kabinetlarida webhook manzillari — `https://<API_DOMAIN>/v1/webhooks/payme`, `.../v1/webhooks/click/prepare` va `/complete`, `.../v1/webhooks/uzum/...` (ARCHITECTURE §3.2); Rahmat (Multicard) uchun kabinetda sozlash kerak emas — callback manzili (`https://<API_DOMAIN>/v1/webhooks/multicard`) har invoysda yuboriladi (`PUBLIC_BASE_URL` dan); Telegram login uchun BotFather'da `/setdomain` = `API_DOMAIN`; mobil ilovalarning API manzili (EAS `production` profili).
8. **Rahmat (Multicard)** ([ARCHITECTURE §4.6](ARCHITECTURE.md#46-payment-gatewaylar)): `.env` da `MULTICARD_BASE_URL=https://mesh.multicard.uz` (standart — sandbox `https://dev-mesh.multicard.uz`, `deploy.sh` ogohlantiradi), `MULTICARD_APPLICATION_ID`, `MULTICARD_SECRET`, `MULTICARD_STORE_ID` (kassa ID, raqam) va fiskal chek kodlari `FISCAL_MXIK_CODE` (17 raqam) / `FISCAL_PACKAGE_CODE` — tasnif.soliq.uz, barcha provider'larda bir xil (eski `PAYME_IKPU_CODE` / `PAYME_PACKAGE_CODE` ham ishlaydi). Kalitlar bilan `FISCAL_*` bo'lmasa API production'da start olmaydi. Avto-refund — `MULTICARD_REFUND_ENABLED=true`; qisman refund — `MULTICARD_PARTIAL_REFUND_ENABLED=true` (avval Multicard terminalda yoqadi). To'lov usullarida ko'rinishi uchun config qatori (boshqa provider'lar kabi operator qo'shadi):
   ```bash
   matchup exec db psql -U matchup -c "INSERT INTO payment_provider_configs (country_code, provider, currencies, priority, is_enabled, secret_ref) VALUES ('UZ', 'multicard', '{UZS}', 40, true, 'env:MULTICARD_*') ON CONFLICT (country_code, provider) DO UPDATE SET is_enabled = true"
   ```
   Kalitlar berilmagan bo'lsa qator yoqilgan bo'lsa ham `multicard` ko'rinmaydi.

### Domen

Domen bo'lmaguncha bootstrap `api.<ip>.sslip.io` / `admin.<ip>.sslip.io` ni qo'yadi (sslip.io nomni IP'ga aylantiradi, Let's Encrypt sertifikati ishlaydi). Do'konga chiqish va to'lov shartnomalaridan oldin haqiqiy domen kerak: DNS'da `api` va `admin` A yozuvlari -> server IP, `.env` da `API_DOMAIN` / `ADMIN_DOMAIN`, so'ng `/opt/matchup/current/deploy.sh --restart`. Webhook manzillari va mobil ilovalardagi URL ham yangilanadi — shuning uchun domenni pilotdan oldin olish ma'qul.

### Deploy, rollback va boshqaruv

`main` ga merge -> CI yashil -> `deploy-hetzner.yml`:

| Job | Nima qiladi |
|---|---|
| `prepare` | commit -> teg (to'liq SHA); GHCR'da qaysi image'lar yo'qligi |
| `build` (matritsa) | yo'q image'larni `linux/amd64` (yoki `HETZNER_PLATFORM`) uchun build qilib GHCR'ga push; CI `docker` job keshidan foydalanadi |
| `deploy` | `infra/hetzner` -> `/opt/matchup/releases/<sha>`, so'ng `deploy.sh` (registry token'i — job'ning `GITHUB_TOKEN`'i, stdin orqali; deploy oxirida `docker logout`) |

`deploy.sh` (CI va operator uchun bir xil): `.env` tekshiruvi (yo'q / namuna / bo'sh qiymatlar ro'yxati bilan to'xtaydi) -> image'lar -> bucket lifecycle qoidalari (`storage.sh`, pastdagi jadval; o'zgarmagan bo'lsa o'tkazib yuboriladi) -> migratsiya (xato bo'lsa servislarga tegilmaydi) -> `docker compose up --wait` (hamma servis sog'lom bo'lishi kutiladi; bo'lmasa — nosoz servis logi chiqadi va oldingi release + teg qaytariladi) -> Caddyfile o'zgargan bo'lsa `caddy reload` -> `current` symlink, `state/image.env` -> HTTPS orqali `/health` -> eski release'lar (5 tadan ortig'i) va image'lar (oxirgi 3 deploy'dan tashqari) tozalanadi. Xato bo'lsa Telegram ops guruhiga xabar (`TELEGRAM_BOT_TOKEN` + `OPS_TELEGRAM_CHAT_ID`).

| Holat | Harakat |
|---|---|
| Deploy o'tdi, lekin xato bor | Actions -> Deploy (Hetzner) -> Run workflow -> `ref` = oldingi SHA (image GHCR'da bor — build yo'q). Serverda internet/registry'siz: `/opt/matchup/releases/<oldingi-sha>/deploy.sh <oldingi-sha>` |
| `.env` o'zgardi | `/opt/matchup/current/deploy.sh --restart` |
| Loglar, holat, konsol | `matchup ps`, `matchup logs -f --tail 100 api`, `matchup exec db psql -U matchup` |
| Infra image'larini yangilash (PostgreSQL minor, Valkey, Caddy) | `matchup pull db redis caddy`, so'ng `matchup up -d db redis caddy` (qisqa uzilish; deploy ularni yangilamaydi) |

Downtime: API konteyneri almashganda bir necha soniya — Caddy so'rovlarni kutib turadi, WebSocket'lar qayta ulanadi. Migratsiyalar AWS'dagi kabi expand -> contract (§6).

### Video saqlash muddatlari

| Nima | Standart (`.env`) | Izoh |
|---|---|---|
| Xom yuklamalar — telefonlardan kelgan asl fayllar (raw bucket) | 3 kun (`MEDIA_RAW_EXPIRATION_DAYS`) | kliplar va HLS shu vaqtgacha tayyor bo'ladi; keyin klip HLS'dan kesiladi, asl fayl kerak emas. Yozuv yuklash 60 soatgacha cho'zilishi mumkin — worker navbati kunlab to'lib qolsa, muddatni oshiring |
| To'liq o'yin videosi — har kamera HLS (1080p/720p/480p, `recordings/`) | 7 kun (`MEDIA_RECORDING_EXPIRATION_DAYS`) | API shundan keyin yozuvni ko'rsatmaydi (player'da karta yo'qoladi), fayllar bir kun keyin o'chadi |
| Kliplar (highlight'lar) | o'chirilguncha | muddatga bog'liq emas |
| Backup'lar | 14 kun (`BACKUP_RETENTION_DAYS`) | |

Kuniga 2 ta o'yin (2 kamera, ~16 GB / kamera) bilan storage'da bir vaqtda ~0.3 TB turadi — Object Storage bazaviy narxi ichida. AWS'da (Terraform) standartlar boshqa: xom 30, to'liq yozuv 90 kun (`media_raw_expiration_days`, `media_recording_expiration_days`).

### Backup va tiklash

`matchup-backup.timer` har kuni 02:30 (Toshkent) `backup.sh` ni ishga tushiradi: `pg_dump` (custom format) -> `s3://<BACKUP_BUCKET>/postgres/matchup-<vaqt>.dump`, hajm tekshiriladi, xato bo'lsa — Telegram. Qo'lda:

```bash
/opt/matchup/current/backup.sh
```

```bash
/opt/matchup/current/restore.sh list
```

```bash
/opt/matchup/current/restore.sh latest --yes
```

Tiklash joriy bazani o'chirmaydi: backup avval `matchup_restore` ga yuklanadi (servislar ishlab turadi), keyin ilova servislari to'xtatilib bazalar qayta nomlanadi — eskisi `matchup_before_<vaqt>` bo'lib qoladi. Lokal sinovda (MinIO) backup -> o'zgartirish -> tiklash -> ma'lumot backup holatiga qaytgani tekshirilgan. Oyiga bir marta tiklashni sinash tavsiya etiladi. Valkey (navbatlar) backup qilinmaydi.

### Xavfsizlik

- Tashqariga faqat 22, 80, 443 (ufw). DB va Valkey port ochmaydi.
- GitHub Actions kaliti `deploy` foydalanuvchisiga `restrict` bilan (port forwarding, pty yo'q). `deploy` docker guruhida — amalda root huquqi, shuning uchun `HETZNER_SSH_KEY` faqat GitHub secret'ida.
- Host kaliti oldindan ma'lum (`HETZNER_KNOWN_HOSTS`) — birinchi ulanishda ham MITM'ga yo'l yo'q.
- `.env` (0600, `deploy`) va `secrets/*.pem` (0400, konteynerdagi `node`); image va repo'da secret yo'q.
- Admin panelni IP bo'yicha cheklash mumkin: `.env` da `ADMIN_ALLOW_IPS`.

### Muammolar

`deploy.sh`, `backup.sh`, `storage.sh`, `restore.sh` ni root'dan ishga tushirish mumkin — ular o'zi `deploy` foydalanuvchisiga o'tadi va `/opt/matchup` dan ishlaydi (`state/` dagi fayllar CI va backup timer'i yoza oladigan bo'lib qoladi).

| Belgi | Sabab va yechim |
|---|---|
| Deploy `Object Storage sozlanmadi (storage.sh)` bilan to'xtadi | bucket'larga ulanib bo'lmadi, sabab xato qatorida: `403 SignatureDoesNotMatch` / `InvalidAccessKeyId` — S3 kalitlari (ko'pincha nusxalashda qisqargan), `404 NoSuchBucket` — bucket nomi yoki `S3_ENDPOINT` location'i, `javob kelmadi` — endpoint yoki tarmoq. Ilova servislariga tegilmagan. Tuzatgach: `/opt/matchup/current/deploy.sh --restart` |
| `argument of type 'NoneType' is not iterable` (backup va boshqa aws-cli buyruqlari) | aws-cli Hetzner'ning xato javobini shunday yashiradi ([aws/aws-cli#10161](https://github.com/aws/aws-cli/issues/10161)). Haqiqiy sabab: `/opt/matchup/current/storage.sh --force` |
| Backup timer'i: `state/backups.log: Permission denied` | `state/` dagi fayl root nomidan yozilgan (shu tuzatishdan oldingi versiya). `chown -R deploy:deploy /opt/matchup/state` yoki istalgan skriptni root'dan bir marta ishga tushirish |
| `stat .: permission denied` (`sudo -u deploy matchup ...`) | `deploy` joriy papkani (masalan `/root`) o'qiy olmaydi: oldin `cd /opt/matchup` yoki `matchup` ni root'dan ishlating |
| `error in libcrypto` (GitHub Actions, SSH) | `HETZNER_SSH_KEY` secret'i buzilgan (qator tushib qolgan yoki ortiqcha matn). Kalitni qayta yaratish — pastda |
| `client_loop: send disconnect: Broken pipe` | uzoq turgan SSH sessiyasi uzildi (Wi-Fi, uyqu rejimi). Kompyuterdagi `~/.ssh/config` da server uchun `ServerAliveInterval 30` |

S3 kalitlarini ekranga chiqarmasdan qayta yozish (Hetzner: access key — 20, secret — 40 belgi; `read -s` — yozilgani ko'rinmaydi), so'ng `/opt/matchup/current/deploy.sh --restart`:

```bash
read -rp 'Access key: ' k && read -rsp 'Secret key: ' s && echo && [ ${#k} = 20 ] && [ ${#s} = 40 ] && sed -i -e "s|^S3_ACCESS_KEY_ID=.*|S3_ACCESS_KEY_ID=$k|" -e "s|^S3_SECRET_ACCESS_KEY=.*|S3_SECRET_ACCESS_KEY=$s|" /opt/matchup/.env && echo YOZILDI || echo "uzunlik noto'g'ri — yozilmadi"; unset k s
```

GitHub Actions kalitini qayta yaratish (eski kalit ishlamay qoladi):

```bash
ssh-keygen -q -t ed25519 -N '' -C matchup-deploy -f /root/matchup-deploy && sed -i '/^restrict /d' ~deploy/.ssh/authorized_keys && echo "restrict $(cat /root/matchup-deploy.pub)" >> ~deploy/.ssh/authorized_keys
```

Maxfiy qismini to'g'ridan-to'g'ri kompyuter buferiga olib (macOS: `ssh root@<ip> cat /root/matchup-deploy | pbcopy`) `HETZNER_SSH_KEY` secret'iga qo'ying, so'ng serverda `rm /root/matchup-deploy /root/matchup-deploy.pub`.

## Ma'lum cheklovlar va keyingi qadamlar

- **ARM64 image'lar QEMU'da build qilinadi** (x86 runner) — api va admin build'i sekinroq. GitHub arm64 runner'lari (`ubuntu-24.04-arm`) ishlatilsa tezlashadi.
- **AWS'da prod yo'q:** production hozir Hetzner'da (§10). AWS'ga o'tilsa — `envs/prod` va `production` environment, `deploy.yml` ga alohida job; ECS task'iga hozircha faqat Payme/Click secret'lari ulangan — Uzum va Rahmat (`UZUM_*`, `MULTICARD_*`, `FISCAL_*`) ham qo'shiladi.
- **Hetzner — bitta server:** server yoki uning disk'i ishdan chiqsa, tiklash — yangi server + `bootstrap.sh` + backup'dan `restore.sh` (yoki Hetzner snapshot'i); kunlik backup'dan keyingi o'zgarishlar yo'qoladi (PITR yo'q). Yuk ko'paysa — DB'ni alohida serverga yoki AWS'ga (§4).
- **Backup'lar o'sha S3 kalitlari bilan:** serverga kirgan hujumchi backup'larni ham o'chira oladi. Kerak bo'lsa — Object Lock yoqilgan alohida bucket (Hetzner'da faqat bucket yaratilayotganda yoqiladi).
- **GHCR** — private repo image'lari uchun hozircha bepul (GitHub: o'zgarsa kamida bir oy oldin xabar beriladi); eski versiyalar o'chirilmaydi.
- API image'ning ~80 MB qismi `@sentry/nestjs` v11 olib keladigan bundler bog'liqliklari (webpack, babel) — SDK tuzilishi.
- WAF (rate limit) va VPC flow log'lar hali yo'q; ARCHITECTURE §4.1 dagi "CDN + WAF" keyingi bosqichda.
- DB'da ilova uchun alohida cheklangan role yo'q — api va migratsiya bitta `matchup` foydalanuvchisi bilan ishlaydi.
- **Yozuv lane'i 0 dan ko'tariladi:** navbat bo'sh paytda yozuv worker'i yo'q; yangi job kelsa alarm (1 daq) + Fargate start (4 vCPU image, ~1–2 daq) — kodlash shuncha kech boshlanadi (soatlik job uchun ahamiyatsiz). Doim tayyor turishi kerak bo'lsa — `media_recording_worker_min_count = 1`.
- **Job olinishi va himoya yoqilishi orasida** (`start` so'rovi, bir necha ms) task scale-in'ga tushsa, job boshqa task'da qaytadan boshlanadi (idempotent). Scale-in faqat navbat 15 daqiqa bo'sh tursa bo'ladi, shuning uchun amalda kam uchraydi.
- Tashqi ALB `/internal/*` ni 404 bilan yopadi; worker API'ga service discovery (`api.<name>.internal`) orqali ulanadi.
