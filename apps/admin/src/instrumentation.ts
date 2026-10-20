import type { Instrumentation } from 'next';

/** Server xatolari Sentry'ga — SENTRY_DSN runtime env'da bo'lsa. Bo'sh bo'lsa SDK yuklanmaydi. */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (dsn && process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSentry } = await import('./lib/sentry');
    initSentry(dsn, process.env.SENTRY_ENVIRONMENT);
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN || process.env.NEXT_RUNTIME !== 'nodejs') return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
