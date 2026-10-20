import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

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
  }
  return env;
}
