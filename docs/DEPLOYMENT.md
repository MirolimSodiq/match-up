# Deployment, CI va infratuzilma

Match Up qanday build qilinadi, tekshiriladi va AWS'ga chiqariladi. Region tanlovi va data residency sababi — [ARCHITECTURE.md §4.3](ARCHITECTURE.md#43-hosting-data-residency-va-multi-region): MVP cell'i `uz-1` = **AWS eu-central-1 (Frankfurt)**.

| Qism | Fayl(lar) |
|---|---|
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml), [.github/actions/setup-pnpm](../.github/actions/setup-pnpm/action.yml) |
| Deploy | [.github/workflows/deploy.yml](../.github/workflows/deploy.yml), [infra/deploy/ecs-deploy.sh](../infra/deploy/ecs-deploy.sh) (+ `ecs-deploy.test.sh`), [modules/cell/deploy.tf](../infra/terraform/modules/cell/deploy.tf) |
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
| `media-worker` | Python 3.12 + apt FFmpeg (man-db indekslash o'chiq, apt tarmoq timeout'lari, `timeout` bilan 3 urinish) + `uv`: `services/media-worker` pytest (test videolari lavfi bilan generatsiya qilinadi) |
| `db-verify` | PGDG'dan PostgreSQL 18 `psql` + `pgbench`, `db/tests/verify.sh` ni `DATABASE_URL` rejimida |
| `admin-build` | `turbo run build --filter=@matchup/admin` (`.next/cache` keshlanadi) |
| `docker` | api, admin va media-worker image'larini build qiladi (push yo'q), GHA cache |
| `terraform` | `infra/terraform/check.sh`: `fmt -check` + `validate` (credential'siz) |
| `deploy-script` | `shellcheck` + `infra/deploy/ecs-deploy.test.sh` — deploy skripti soxta `aws` CLI bilan (tartib, image almashtirish, migratsiya xatosi, circuit breaker rollback, yo'q image) |
| `actionlint` | workflow'larni tekshiradi |

Deploy — alohida workflow (`deploy.yml`, §6): `main` dagi CI muvaffaqiyatli tugagach avtomatik.

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

## Ma'lum cheklovlar va keyingi qadamlar

- **ARM64 image'lar QEMU'da build qilinadi** (x86 runner) — api va admin build'i sekinroq. GitHub arm64 runner'lari (`ubuntu-24.04-arm`) ishlatilsa tezlashadi.
- **Prod deploy yo'q:** `envs/prod` va `production` environment (majburiy tasdiq bilan) — prod cell'i qo'shilganda `deploy.yml` ga alohida job.
- API image'ning ~80 MB qismi `@sentry/nestjs` v11 olib keladigan bundler bog'liqliklari (webpack, babel) — SDK tuzilishi.
- WAF (rate limit) va VPC flow log'lar hali yo'q; ARCHITECTURE §4.1 dagi "CDN + WAF" keyingi bosqichda.
- DB'da ilova uchun alohida cheklangan role yo'q — api va migratsiya bitta `matchup` foydalanuvchisi bilan ishlaydi.
- **Yozuv lane'i 0 dan ko'tariladi:** navbat bo'sh paytda yozuv worker'i yo'q; yangi job kelsa alarm (1 daq) + Fargate start (4 vCPU image, ~1–2 daq) — kodlash shuncha kech boshlanadi (soatlik job uchun ahamiyatsiz). Doim tayyor turishi kerak bo'lsa — `media_recording_worker_min_count = 1`.
- **Job olinishi va himoya yoqilishi orasida** (`start` so'rovi, bir necha ms) task scale-in'ga tushsa, job boshqa task'da qaytadan boshlanadi (idempotent). Scale-in faqat navbat 15 daqiqa bo'sh tursa bo'ladi, shuning uchun amalda kam uchraydi.
- Tashqi ALB `/internal/*` ni 404 bilan yopadi; worker API'ga service discovery (`api.<name>.internal`) orqali ulanadi.
