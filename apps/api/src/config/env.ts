import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Vergul bilan ajratilgan ro'yxat: `a, b,c` -> ['a', 'b', 'c']. */
const list = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
  .or(z.array(z.string()));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().default('postgres://matchup:matchup_dev_only@localhost:5432/matchup'),
  DATABASE_POOL_MAX: z.coerce.number().int().default(20),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Background job'larni shu process'da ishga tushirish (MVP: ha; testlarda: yo'q). */
  RUN_WORKERS: bool.default(true),

  JWT_PRIVATE_KEY_FILE: z.string().optional(),
  JWT_PUBLIC_KEY_FILE: z.string().optional(),
  TICKET_PRIVATE_KEY_FILE: z.string().optional(),
  TICKET_PUBLIC_KEY_FILE: z.string().optional(),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),

  OTP_PROVIDER: z.enum(['console', 'eskiz']).default('console'),
  OTP_TTL_SEC: z.coerce.number().int().default(300),
  OTP_RESEND_SEC: z.coerce.number().int().default(60),
  OTP_MAX_PER_PHONE_HOUR: z.coerce.number().int().default(5),
  OTP_MAX_PER_IP_HOUR: z.coerce.number().int().default(20),
  ESKIZ_EMAIL: z.string().optional(),
  ESKIZ_PASSWORD: z.string().optional(),
  ESKIZ_FROM: z.string().default('4546'),

  HOLD_MINUTES: z.coerce.number().int().default(15),
  GEOFENCE_METERS: z.coerce.number().int().default(200),

  PAYME_MERCHANT_ID: z.string().default('demo-payme'),
  PAYME_KEY: z.string().default('payme_test_key'),
  PAYME_CHECKOUT_URL: z.url().default('https://checkout.test.paycom.uz'),
  /** Eski nomlar (FISCAL_MXIK_CODE / FISCAL_PACKAGE_CODE berilmasa ishlatiladi). */
  PAYME_IKPU_CODE: z.string().optional(),
  PAYME_PACKAGE_CODE: z.string().optional(),
  /**
   * Fiskal chek (OFD) uchun xizmatimizning MXIK (IKPU) va o'lchov birligi (package) kodi — tasnif.soliq.uz katalogidan.
   * Barcha provider'larda bir xil: Payme `detail.items`, Multicard `ofd`.
   */
  FISCAL_MXIK_CODE: z.string().regex(/^\d{17}$/).optional(),
  FISCAL_PACKAGE_CODE: z.string().regex(/^\d{1,20}$/).optional(),

  CLICK_SERVICE_ID: z.string().default('1000'),
  CLICK_MERCHANT_ID: z.string().default('2000'),
  CLICK_SECRET_KEY: z.string().default('click_test_secret'),
  CLICK_CHECKOUT_URL: z.url().default('https://my.click.uz/services/pay'),

  // Uzum Bank Merchant API (developer.uzumbank.uz/merchant): Basic auth login/parol Uzum jamoasidan
  UZUM_SERVICE_ID: z.coerce.number().int().positive().default(101202),
  UZUM_LOGIN: z.string().min(1).default('uzum_test_login'),
  UZUM_PASSWORD: z.string().min(1).default('uzum_test_password'),
  /** `params` ichidagi booking id kaliti — Uzum servis sozlamasida kelishiladi. */
  UZUM_ACCOUNT_PARAM: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('booking_id'),
  /** Uzum Bank ilovasidagi servisni ochuvchi havola (rasmiy hujjatda yo'q — Uzum menejeri bilan tasdiqlansin). */
  UZUM_CHECKOUT_URL: z.url().default('https://www.uzumbank.uz/open-service'),

  // Rahmat (Multicard) onlayn ekvayringi (docs.multicard.uz): Payme/Click/Uzum'dan farqli, Multicard'ni biz chaqiramiz —
  // invoys yaratamiz (`POST /payment/invoice`), to'lovdan keyin Multicard `/v1/webhooks/multicard` ga callback yuboradi.
  // application_id + secret + store_id berilmasa provider to'lov usullarida ko'rinmaydi.
  /** Sandbox: https://dev-mesh.multicard.uz, production: https://mesh.multicard.uz */
  MULTICARD_BASE_URL: z.url().default('https://dev-mesh.multicard.uz'),
  MULTICARD_APPLICATION_ID: z.string().min(1).optional(),
  /** Token olish va callback imzosi (`md5(store_id + invoice_id + amount + secret)`) uchun. */
  MULTICARD_SECRET: z.string().min(1).optional(),
  /** Kassa ID (raqam) — callback'da `store_id` shu bilan solishtiriladi. */
  MULTICARD_STORE_ID: z.coerce.number().int().positive().optional(),
  /** Avto-refund: to'liq — `DELETE /payment/{uuid}`. Standart o'chiq (sandbox'da tasdiqlangach yoqiladi). */
  MULTICARD_REFUND_ENABLED: bool.default(false),
  /**
   * Qisman refund — `DELETE /payment/{uuid}/partial` (qolgan summaga yangi fiskal chek). Terminalda Multicard yoqishi kerak;
   * faqat kartadan (Uzcard/Humo/Visa/Mastercard) to'langanlar — ilova orqali to'langanda karta raqami so'raladi, u bizda yo'q.
   */
  MULTICARD_PARTIAL_REFUND_ENABLED: bool.default(false),

  // Kechki reconciliation. Payme: Subscribe API `receipts.get_all` (X-Auth: kassa id + kalit).
  /** Tashqi API'ga dev'da demo kalitlar bilan chiqmaslik uchun standart o'chiq. */
  PAYME_RECONCILE_ENABLED: bool.default(false),
  PAYME_API_URL: z.url().default('https://checkout.test.paycom.uz/api'),
  /** Kechki job vaqti (cron, Asia/Tashkent): oldingi kunni solishtiradi. */
  RECONCILE_CRON: z.string().default('30 3 * * *'),

  // Avtomatik provider refund'lari (job `provider-refunds`): to'liq summali `original_method` refund'lari.
  // Standart o'chiq (dev'da tashqi API'ga chiqmaslik uchun) — o'chiq provider refund'lari admin navbatida qoladi.
  /** Payme: Subscribe API `receipts.cancel` / `receipts.check` (PAYME_API_URL, X-Auth — reconciliation kaliti). */
  PAYME_REFUND_ENABLED: bool.default(false),
  /** Click: Merchant API `DELETE payment/reversal` (Auth: merchant_user_id:sha1(timestamp + CLICK_SECRET_KEY):timestamp). */
  CLICK_REFUND_ENABLED: bool.default(false),
  CLICK_API_URL: z.url().default('https://api.click.uz/v2/merchant'),
  /** Click merchant kabinetidagi API foydalanuvchisi (merchant_user_id) — CLICK_REFUND_ENABLED uchun majburiy. */
  CLICK_MERCHANT_USER_ID: z.string().optional(),

  // Host operatsiyalari: no-show ogohlantirishi (Telegram ops guruhi) va haftalik payout
  /** Ops guruhi chat id (TELEGRAM_BOT_TOKEN boti guruhga qo'shilgan bo'lsin); bo'sh — ogohlantirish faqat logga. */
  OPS_TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_API_URL: z.url().default('https://api.telegram.org'),
  /** Ogohlantirishlardagi admin panel havolasi (masalan `https://admin.matchup.uz`). */
  ADMIN_PUBLIC_URL: z.url().optional(),
  /** Kick-off'ga shuncha daqiqa qolganda host yetib kelmagan bo'lsa (`arrived` yo'q) — ogohlantirish. */
  HOST_NO_SHOW_ALERT_MIN: z.coerce.number().int().min(1).max(120).default(15),
  /** Haftalik host payout (cron, Asia/Tashkent): oldingi dushanba–yakshanba. */
  HOST_PAYOUT_CRON: z.string().default('0 4 * * 1'),
  /** Media navbati metrikasi (CloudWatch EMF, stdout) — cell nomi o'lcham sifatida; bo'sh — metrika chiqarilmaydi. */
  CLOUDWATCH_METRICS_CELL: z.string().optional(),

  /** Expo Push API (push/send, push/getReceipts). Access token — Expo "enhanced security" yoqilgan bo'lsa. */
  EXPO_PUSH_URL: z.url().default('https://exp.host/--/api/v2/push'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // Social login. Client ID ro'yxati bo'sh bo'lsa — provider o'chiq (SOCIAL_PROVIDER_DISABLED).
  // JWKS URL'lari testlarda lokal server bilan almashtiriladi.
  GOOGLE_CLIENT_IDS: list.default([]),
  GOOGLE_JWKS_URL: z.url().default('https://www.googleapis.com/oauth2/v3/certs'),
  APPLE_CLIENT_IDS: list.default([]),
  APPLE_JWKS_URL: z.url().default('https://appleid.apple.com/auth/keys'),
  /** Cache-Control max-age bo'lmasa JWKS shuncha soniya keshlanadi. */
  JWKS_CACHE_TTL_SEC: z.coerce.number().int().min(60).default(3600),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_AUTH_MAX_AGE_SEC: z.coerce.number().int().positive().default(86_400),
  /** Telegram OAuth sahifasi (dev'da lokal mock bilan almashtirish mumkin). */
  TELEGRAM_OAUTH_URL: z.url().default('https://oauth.telegram.org/auth'),
  /** Telegram OAuth qaytish sahifasi faqat shu prefikslarga yo'naltiradi (open redirect himoyasi). */
  TELEGRAM_APP_REDIRECTS: list.default(['matchup://']),

  // GDPR (DSR) job'lari
  STORAGE_DIR: z.string().default('storage'),
  DATA_EXPORT_TTL_HOURS: z.coerce.number().int().positive().default(168),
  ERASURE_GRACE_DAYS: z.coerce.number().int().min(0).default(30),

  // Object storage (S3 / MinIO). Endpoint bo'sh — AWS S3; kalitlar bo'sh — default chain (ECS task role).
  S3_ENDPOINT: z.url().optional(),
  /** Presigned URL'lar shu host bilan imzolanadi (API konteyner ichidan boshqa nom bilan ulansa). */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** MinIO: true (bucket yo'lda); AWS: false (virtual-hosted). */
  S3_FORCE_PATH_STYLE: bool.default(false),
  /** Host yuklagan xom kliplar (faqat presigned PUT; lifecycle 30 kun). */
  MEDIA_RAW_BUCKET: z.string().default('matchup-media-raw'),
  /** Worker natijalari: HLS, thumbnail, 9:16 MP4 (CloudFront origin). */
  MEDIA_BUCKET: z.string().default('matchup-media'),
  /** media_assets.storage_region — cell nomi (§4.3). */
  MEDIA_STORAGE_REGION: z.string().default('uz-1'),
  /** Multipart qism hajmi (S3 minimumi 5 MiB, oxirgisidan tashqari). */
  MEDIA_UPLOAD_PART_SIZE: z.coerce.number().int().min(5 * 1024 * 1024).max(64 * 1024 * 1024).default(8 * 1024 * 1024),
  /** Presigned qism URL'larining muddati; tugasa — `GET /v1/media/{id}/upload` yangilarini beradi. */
  MEDIA_UPLOAD_URL_TTL_SEC: z.coerce.number().int().min(60).max(604_800).default(3600),
  /** Shu vaqtgacha yakunlanmagan multipart yuklash abort qilinadi. */
  MEDIA_UPLOAD_SESSION_HOURS: z.coerce.number().int().positive().default(48),
  /** To'liq o'yin yozuvi (AI-Cam): kattaroq qism — 30 GB fayl ~2 000 qism (S3 chegarasi 10 000). */
  MEDIA_RECORDING_PART_SIZE: z.coerce.number().int().min(5 * 1024 * 1024).max(64 * 1024 * 1024).default(16 * 1024 * 1024),
  /** Yozuv yuklash sessiyasi: raw bucket'ning tugallanmagan multipart'ni abort qilish qoidasidan (3 kun) qisqa. */
  MEDIA_RECORDING_SESSION_HOURS: z.coerce.number().int().positive().max(71).default(60),
  /** Bitta javobdagi presigned qism URL'lari soni (qolganlari — keyingi `GET /v1/media/{id}/upload`). */
  MEDIA_UPLOAD_URL_BATCH: z.coerce.number().int().min(1).max(1000).default(100),
  /**
   * To'liq o'yin videosini ko'rish muddati (kamera tayyor bo'lgandan keyin, kun): shundan keyin API yozuvni ko'rsatmaydi.
   * HLS (`recordings/`) object storage lifecycle'i bilan bir kun kechroq o'chadi (Hetzner: storage.sh, AWS: Terraform).
   */
  MEDIA_RECORDING_EXPIRATION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  /** Ijro havolalari (HLS playlist token, MP4/thumbnail imzosi) muddati. */
  MEDIA_PLAYBACK_TTL_SEC: z.coerce.number().int().min(300).max(86_400).default(21_600),
  /** CloudFront: domen + key pair berilsa — signed URL; aks holda S3/MinIO presigned GET. */
  MEDIA_CDN_DOMAIN: z.string().optional(),
  MEDIA_CDN_KEY_PAIR_ID: z.string().optional(),
  MEDIA_CDN_PRIVATE_KEY_FILE: z.string().optional(),
  /** Python worker bilan umumiy Redis Stream (dev va prod bir xil). */
  MEDIA_JOBS_STREAM: z.string().default('matchup:media-jobs'),
  /** To'liq o'yin yozuvlari (soatlab kodlash) — alohida stream va kattaroq worker servisi, kliplar navbatini bandlamaydi. */
  MEDIA_RECORDING_JOBS_STREAM: z.string().default('matchup:media-jobs:recording'),
  /** Worker -> API ichki endpointlari uchun servis token (`/internal/media/...`). */
  MEDIA_WORKER_TOKEN: z.string().min(32).optional(),
  /** `POST /v1/highlights/{id}/share` havolasi muddati. */
  SHARE_LINK_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
});

export type Env = z.infer<typeof EnvSchema>;
export const ENV = Symbol('ENV');

/** Multicard kalitlari berilgan (aks holda provider to'lov usullarida ko'rinmaydi, job'lar ishlamaydi). */
export function multicardConfigured(env: Env): boolean {
  return !!(env.MULTICARD_APPLICATION_ID && env.MULTICARD_SECRET && env.MULTICARD_STORE_ID);
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Env konfiguratsiyasi noto'g'ri:\n${issues}`);
  }
  const env = parsed.data;
  env.FISCAL_MXIK_CODE ??= env.PAYME_IKPU_CODE;
  env.FISCAL_PACKAGE_CODE ??= env.PAYME_PACKAGE_CODE;
  if (env.CLICK_REFUND_ENABLED && !env.CLICK_MERCHANT_USER_ID) throw new Error('CLICK_REFUND_ENABLED uchun CLICK_MERCHANT_USER_ID kerak');
  if (env.NODE_ENV === 'production') {
    for (const key of ['JWT_PRIVATE_KEY_FILE', 'JWT_PUBLIC_KEY_FILE', 'TICKET_PRIVATE_KEY_FILE', 'TICKET_PUBLIC_KEY_FILE'] as const) {
      if (!env[key]) throw new Error(`${key} production'da majburiy`);
    }
    if (env.OTP_PROVIDER === 'console') throw new Error("OTP_PROVIDER=console production'da taqiqlangan");
    for (const key of ['GOOGLE_JWKS_URL', 'APPLE_JWKS_URL', 'TELEGRAM_OAUTH_URL'] as const) {
      if (!env[key].startsWith('https://')) throw new Error(`${key} production'da https bo'lishi shart`);
    }
    if (!env.MEDIA_WORKER_TOKEN) throw new Error("MEDIA_WORKER_TOKEN production'da majburiy");
    if (multicardConfigured(env) && !(env.FISCAL_MXIK_CODE && env.FISCAL_PACKAGE_CODE)) {
      throw new Error("Multicard production'da fiskal chek kodlarisiz ishlamaydi: FISCAL_MXIK_CODE va FISCAL_PACKAGE_CODE kerak");
    }
    if (env.MEDIA_CDN_DOMAIN && !(env.MEDIA_CDN_KEY_PAIR_ID && env.MEDIA_CDN_PRIVATE_KEY_FILE)) {
      throw new Error("MEDIA_CDN_DOMAIN berilsa MEDIA_CDN_KEY_PAIR_ID va MEDIA_CDN_PRIVATE_KEY_FILE ham kerak (signed URL)");
    }
    if (env.TELEGRAM_APP_REDIRECTS.some((p) => !/^[a-z][a-z0-9+.-]*:\/\//.test(p) || p.startsWith('exp://'))) {
      throw new Error("TELEGRAM_APP_REDIRECTS production'da faqat ilova sxemalari (Expo Go'ning exp:// emas)");
    }
  }
  return env;
}
