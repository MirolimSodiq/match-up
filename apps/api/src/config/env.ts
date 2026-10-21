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
  /** Fiskal chek uchun MXIK (IKPU) va o'lchov birligi kodi — soliq.uz katalogidan. */
  PAYME_IKPU_CODE: z.string().optional(),
  PAYME_PACKAGE_CODE: z.string().optional(),

  CLICK_SERVICE_ID: z.string().default('1000'),
  CLICK_MERCHANT_ID: z.string().default('2000'),
  CLICK_SECRET_KEY: z.string().default('click_test_secret'),
  CLICK_CHECKOUT_URL: z.url().default('https://my.click.uz/services/pay'),

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
  /** Ijro havolalari (HLS playlist token, MP4/thumbnail imzosi) muddati. */
  MEDIA_PLAYBACK_TTL_SEC: z.coerce.number().int().min(300).max(86_400).default(21_600),
  /** CloudFront: domen + key pair berilsa — signed URL; aks holda S3/MinIO presigned GET. */
  MEDIA_CDN_DOMAIN: z.string().optional(),
  MEDIA_CDN_KEY_PAIR_ID: z.string().optional(),
  MEDIA_CDN_PRIVATE_KEY_FILE: z.string().optional(),
  /** Python worker bilan umumiy Redis Stream (dev va prod bir xil). */
  MEDIA_JOBS_STREAM: z.string().default('matchup:media-jobs'),
  /** Worker -> API ichki endpointlari uchun servis token (`/internal/media/...`). */
  MEDIA_WORKER_TOKEN: z.string().min(32).optional(),
  /** `POST /v1/highlights/{id}/share` havolasi muddati. */
  SHARE_LINK_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
});

export type Env = z.infer<typeof EnvSchema>;
export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Env konfiguratsiyasi noto'g'ri:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    for (const key of ['JWT_PRIVATE_KEY_FILE', 'JWT_PUBLIC_KEY_FILE', 'TICKET_PRIVATE_KEY_FILE', 'TICKET_PUBLIC_KEY_FILE'] as const) {
      if (!env[key]) throw new Error(`${key} production'da majburiy`);
    }
    if (env.OTP_PROVIDER === 'console') throw new Error("OTP_PROVIDER=console production'da taqiqlangan");
    for (const key of ['GOOGLE_JWKS_URL', 'APPLE_JWKS_URL', 'TELEGRAM_OAUTH_URL'] as const) {
      if (!env[key].startsWith('https://')) throw new Error(`${key} production'da https bo'lishi shart`);
    }
    if (!env.MEDIA_WORKER_TOKEN) throw new Error("MEDIA_WORKER_TOKEN production'da majburiy");
    if (env.MEDIA_CDN_DOMAIN && !(env.MEDIA_CDN_KEY_PAIR_ID && env.MEDIA_CDN_PRIVATE_KEY_FILE)) {
      throw new Error("MEDIA_CDN_DOMAIN berilsa MEDIA_CDN_KEY_PAIR_ID va MEDIA_CDN_PRIVATE_KEY_FILE ham kerak (signed URL)");
    }
    if (env.TELEGRAM_APP_REDIRECTS.some((p) => !/^[a-z][a-z0-9+.-]*:\/\//.test(p) || p.startsWith('exp://'))) {
      throw new Error("TELEGRAM_APP_REDIRECTS production'da faqat ilova sxemalari (Expo Go'ning exp:// emas)");
    }
  }
  return env;
}
