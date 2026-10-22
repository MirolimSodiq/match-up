// Expo standart Metro config'i + Sentry: bundle va source map'larga Debug ID qo'shiladi, shuning uchun EAS build'da
// Sentry plugin'i (app.config.ts, SENTRY_ORG/PROJECT berilganda) yuklagan source map'lar production stack
// trace'larini asl kodga qaytaradi. Web replay/feedback paketlari kerak emas — ilova faqat iOS/Android.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname, { includeWebReplay: false, includeWebFeedback: false });
