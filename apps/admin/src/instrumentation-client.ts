// Brauzer xatolari Sentry'ga. NEXT_PUBLIC_* build vaqtida inline qilinadi (Docker: --build-arg);
// bo'sh bo'lsa SDK chunk'i umuman yuklanmaydi.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import('./lib/sentry').then(({ initSentry }) => initSentry(dsn, process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT));
}
