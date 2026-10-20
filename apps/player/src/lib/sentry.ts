/**
 * Sentry (crash va xato monitoringi). `src/app/_layout.tsx` ning birinchi import'i.
 * EXPO_PUBLIC_SENTRY_DSN bo'sh bo'lsa SDK umuman ishga tushmaydi (Expo Go va lokal dev'da odatda bo'sh);
 * qiymat EAS environment variable'dan keladi (docs/DEPLOYMENT.md).
 * PII: user, screenshot, view hierarchy va console breadcrumb'lar yuborilmaydi; URL query'lari
 * (joylashuv koordinatalari) va telefon raqamlari tozalanadi — API'dagi pino redact bilan bir xil kalitlar.
 */
import type * as SentrySdk from '@sentry/react-native';
import type { Breadcrumb, Event } from '@sentry/react-native';

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
  delete event.user;
  if (event.request?.url) event.request = { url: stripQuery(event.request.url) };
  if (event.message) event.message = scrub(event.message);
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrub(ex.value);
  if (event.extra) event.extra = scrub(event.extra);
  if (event.contexts) event.contexts = scrub(event.contexts);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  return event;
}

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (dsn) {
  // DSN bo'lmasa native modul umuman chaqirilmaydi (Expo Go'da ham xavfsiz)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/react-native') as typeof SentrySdk;
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'development' : 'production'),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}
