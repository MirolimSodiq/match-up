/**
 * Sentry init (server va brauzer uchun umumiy). Faqat DSN bo'lganda instrumentation fayllaridan
 * dinamik import qilinadi — DSN bo'sh bo'lsa SDK bundle'ga ham, server xotirasiga ham yuklanmaydi.
 * PII: user, cookie, header, body, query yig'ilmaydi; telefon raqamlari va maxfiy kalitlar tozalanadi
 * (API'dagi pino redact bilan bir xil kalitlar).
 */
import * as Sentry from '@sentry/nextjs';

type Event = Sentry.Event;
type Breadcrumb = Sentry.Breadcrumb;

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

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === 'console') return null;
  return { ...crumb, message: crumb.message && scrub(crumb.message), data: crumb.data && scrub(crumb.data) };
}

function scrubEvent<E extends Event>(event: E): E {
  if (event.request) {
    const { method, url } = event.request;
    event.request = { method, url: url && stripQuery(url) };
  }
  delete event.user;
  if (event.message) event.message = scrub(event.message);
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrub(ex.value);
  if (event.extra) event.extra = scrub(event.extra);
  if (event.contexts) event.contexts = scrub(event.contexts);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  return event;
}

export function initSentry(dsn: string, environment: string | undefined) {
  Sentry.init({
    dsn,
    environment: environment || process.env.NODE_ENV,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}
