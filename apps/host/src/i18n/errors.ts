import type { TFunction } from 'i18next';
import { ApiError } from '@/api/errors';
import i18n from './index';

/** Xato uchun foydalanuvchi tilidagi matn: avval `code` bo'yicha lokal tarjima, keyin server `detail`. */
export function errorMessage(t: TFunction, err: unknown): string {
  if (!(err instanceof ApiError)) return t('errors.UNKNOWN');
  if (err.code === 'RATE_LIMITED') {
    return err.retryAfter ? t('errors.RATE_LIMITED', { seconds: err.retryAfter }) : t('errors.RATE_LIMITED_SOON');
  }
  const key = `errors.${err.code}`;
  if (i18n.exists(key)) return t(key);
  return err.problem?.detail ?? t('errors.UNKNOWN');
}
