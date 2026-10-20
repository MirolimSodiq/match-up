/**
 * Process'ning birinchi import'i (main.ts): .env ni yuklaydi va Sentry'ni boshqa modullardan oldin
 * ishga tushiradi — auto-instrumentation (http, express, pg, ioredis) ular require qilinishidan oldin
 * ulanishi kerak. SENTRY_DSN bo'sh bo'lsa SDK umuman yuklanmaydi.
 *
 * Xatolar: ProblemFilter kutilmagan xatoni pino'ga `error` darajasida yozadi -> pinoIntegration
 * uni Sentry event'iga aylantiradi (AppModule'ga SentryModule/filtr qo'shish shart emas).
 * PII: `dataCollection` request body, cookie, query string va user'ni umuman yig'maydi; qo'shimcha
 * himoya sifatida pino `redact` bilan bir xil kalitlar (authorization, cookie, phone, code, *token)
 * va telefon raqamlari event'lardan olib tashlanadi.
 */
import type * as SentrySdk from '@sentry/nestjs';
import type { Breadcrumb, Event } from '@sentry/nestjs';

try {
  process.loadEnvFile();
} catch {
  // .env ixtiyoriy (production'da env o'zgaruvchilari tashqaridan keladi)
}

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|phone|email|^code$|^otp$|query|^ip$|remoteaddress|forwarded/i;
const URL_KEY = /url|path|target|^to$|^from$/i;
// E.164 (+ yoki URL-encoded %2B) va + siz 998XXXXXXXXX
const PHONE = /(?:\+|%2B)\d{9,15}(?!\d)|(?<!\d)998\d{9}(?!\d)/gi;

const stripQuery = (url: string) => url.replace(/[?#].*$/, '');

function scrub<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return value.replace(PHONE, REDACTED) as T;
  if (value === null || typeof value !== 'object' || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) out[key] = REDACTED;
    else if (typeof v === 'string' && URL_KEY.test(key)) out[key] = scrub(stripQuery(v));
    else out[key] = scrub(v, depth + 1);
  }
  return out as T;
}

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  return { ...crumb, message: crumb.message && scrub(crumb.message), data: crumb.data && scrub(crumb.data) };
}

function scrubEvent<E extends Event>(event: E): E {
  if (event.request) {
    const { method, url, headers } = event.request;
    event.request = { method, url: url && stripQuery(url), headers: headers && scrub(headers) };
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  if (event.message) event.message = scrub(event.message);
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrub(ex.value);
  if (event.extra) event.extra = scrub(event.extra);
  if (event.contexts) event.contexts = scrub(event.contexts);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  // Sinxron require: init boshqa modullar yuklanishidan oldin tugashi kerak
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/nestjs') as typeof SentrySdk;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    // SDK o'zi yig'adigan ma'lumot: faqat texnik header'lar; body, cookie, query, user, DB/queue argumentlari yo'q
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { allow: ['user-agent', 'accept-language', 'content-type', 'x-request-id', 'x-app-version'] },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
    },
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    integrations: [Sentry.pinoIntegration({ error: { levels: ['error', 'fatal'] }, log: { levels: [] } })],
    beforeSend: scrubEvent,
    // v11: span'lar stream rejimida yuboriladi (beforeSendTransaction ishlamaydi)
    beforeSendSpan: (span) => ({ ...span, name: scrub(stripQuery(span.name)), attributes: scrub(span.attributes) }),
    beforeBreadcrumb: scrubBreadcrumb,
  });
}
