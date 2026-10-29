import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json ustiga EAS profiliga qarab o'zgarishlar (eas.json -> env.APP_VARIANT), bitta qurilmada
 * dev, preview va production yonma-yon o'rnatiladi:
 *   development -> <bundle id>.dev,     "Match Up (dev)"
 *   preview     -> <bundle id>.preview, "Match Up (preview)"
 *   production yoki o'rnatilmagan (lokal expo start) -> app.json qiymatlari o'zgarishsiz
 * Sentry Expo plugin'i (source map / dSYM yuklash) faqat SENTRY_ORG va SENTRY_PROJECT berilganda.
 * Android push (FCM): `google-services.json` yo'li `GOOGLE_SERVICES_JSON` env'dan — EAS'da fayl turidagi env,
 * lokal build'da `GOOGLE_SERVICES_JSON=./google-services.json` (fayl git'da yo'q). Firebase'da build qilinadigan
 * har variant paketi (asosiy, .preview, .dev) ro'yxatdan o'tgan bo'lsin, aks holda Gradle "No matching client" beradi.
 */
const VARIANTS: Record<string, { suffix: string; label: string }> = {
  development: { suffix: '.dev', label: ' (dev)' },
  preview: { suffix: '.preview', label: ' (preview)' },
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = VARIANTS[process.env.APP_VARIANT ?? ''];
  const withSuffix = (id: string | undefined) => (id && variant ? id + variant.suffix : id);
  const { SENTRY_ORG, SENTRY_PROJECT, SENTRY_URL } = process.env;
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  const sentryPlugin: NonNullable<ExpoConfig['plugins']> =
    SENTRY_ORG && SENTRY_PROJECT
      ? [['@sentry/react-native/expo', { organization: SENTRY_ORG, project: SENTRY_PROJECT, url: SENTRY_URL || 'https://sentry.io/' }]]
      : [];

  return {
    ...config,
    name: variant ? `${config.name}${variant.label}` : (config.name ?? 'Match Up'),
    slug: config.slug ?? 'matchup-player',
    ios: { ...config.ios, bundleIdentifier: withSuffix(config.ios?.bundleIdentifier) },
    android: { ...config.android, package: withSuffix(config.android?.package), ...(googleServicesFile ? { googleServicesFile } : {}) },
    plugins: [...(config.plugins ?? []), ...sentryPlugin],
  };
};
