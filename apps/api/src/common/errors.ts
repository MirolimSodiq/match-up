import type { Locale } from './i18n';

/** Mashina o'qiydigan xato kodlari (Problem Details `code`) va HTTP status'lari. */
export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHORIZED: 401,
  TOKEN_REUSED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  MATCH_FULL: 409,
  ALREADY_BOOKED: 409,
  BOOKING_CLOSED: 409,
  INVALID_STATE: 409,
  OFFER_TAKEN: 409,
  OFFER_EXPIRED: 409,
  SCHEDULE_CONFLICT: 409,
  LEASE_OVERLAP: 409,
  WAIVER_OUTDATED: 409,
  ERASURE_PENDING: 409,
  ALREADY_ON_WAITLIST: 409,
  IDEMPOTENCY_CONFLICT: 409,
  WAIVER_REQUIRED: 422,
  GUARDIAN_REQUIRED: 422,
  SKILL_LEVEL_MISMATCH: 422,
  AGE_RESTRICTED: 422,
  OUTSIDE_GEOFENCE: 422,
  WALLET_INSUFFICIENT: 422,
  PAYMENT_METHOD_UNAVAILABLE: 422,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_TOO_MANY_ATTEMPTS: 429,
  RATE_LIMITED: 429,
  NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly params: Record<string, string | number> = {},
    readonly errors?: FieldError[],
    readonly headers?: Record<string, string>,
  ) {
    super(code);
    this.status = ERROR_STATUS[code];
  }
}

export const MESSAGES: Record<ErrorCode, Record<Exclude<Locale, 'uz-Cyrl'>, string>> = {
  BAD_REQUEST: { 'uz-Latn': "So'rov noto'g'ri", ru: 'Некорректный запрос', en: 'Bad request' },
  VALIDATION_FAILED: { 'uz-Latn': "Ma'lumotlar noto'g'ri to'ldirilgan", ru: 'Ошибка валидации', en: 'Validation failed' },
  UNAUTHORIZED: { 'uz-Latn': 'Tizimga kirish talab qilinadi', ru: 'Требуется авторизация', en: 'Authentication required' },
  TOKEN_REUSED: {
    'uz-Latn': 'Sessiya xavfsizlik sababli yopildi. Qaytadan kiring',
    ru: 'Сессия закрыта из соображений безопасности. Войдите снова',
    en: 'Session revoked for security reasons. Please sign in again',
  },
  FORBIDDEN: { 'uz-Latn': "Bu amal uchun ruxsat yo'q", ru: 'Недостаточно прав', en: 'Forbidden' },
  NOT_FOUND: { 'uz-Latn': 'Topilmadi', ru: 'Не найдено', en: 'Not found' },
  MATCH_FULL: {
    'uz-Latn': "Bu o'yinda bo'sh joy qolmadi. Kutish ro'yxatiga yozilishingiz mumkin",
    ru: 'Свободных мест нет. Можно встать в лист ожидания',
    en: 'No seats left. You can join the waitlist',
  },
  ALREADY_BOOKED: { 'uz-Latn': "Siz bu o'yinga allaqachon yozilgansiz", ru: 'Вы уже записаны на эту игру', en: 'You are already booked for this match' },
  BOOKING_CLOSED: { 'uz-Latn': "Bu o'yinga yozilish yopilgan", ru: 'Запись на игру закрыта', en: 'Booking for this match is closed' },
  INVALID_STATE: { 'uz-Latn': "Hozirgi holatda bu amalni bajarib bo'lmaydi", ru: 'Действие недоступно в текущем состоянии', en: 'Action not allowed in the current state' },
  OFFER_TAKEN: { 'uz-Latn': 'Bu o\'yinni boshqa host oldi', ru: 'Игру уже взял другой ведущий', en: 'Another host already took this match' },
  OFFER_EXPIRED: { 'uz-Latn': 'Taklif muddati tugagan', ru: 'Срок предложения истёк', en: 'The offer has expired' },
  SCHEDULE_CONFLICT: { 'uz-Latn': "Bu vaqtda sizda boshqa o'yin bor", ru: 'У вас уже есть игра в это время', en: 'You already have a match at this time' },
  LEASE_OVERLAP: { 'uz-Latn': 'Bu maydon shu vaqtga allaqachon ijaraga olingan', ru: 'Поле уже арендовано на это время', en: 'The pitch is already leased for this time' },
  WAIVER_OUTDATED: { 'uz-Latn': 'Hujjat yangilangan. Iltimos, yangi matnni o\'qing', ru: 'Документ обновлён. Ознакомьтесь с новой версией', en: 'The document was updated. Please review the new version' },
  ERASURE_PENDING: { 'uz-Latn': "Akkauntni o'chirish so'rovi allaqachon mavjud", ru: 'Запрос на удаление уже создан', en: 'An erasure request already exists' },
  ALREADY_ON_WAITLIST: { 'uz-Latn': "Siz allaqachon kutish ro'yxatidasiz", ru: 'Вы уже в листе ожидания', en: 'You are already on the waitlist' },
  IDEMPOTENCY_CONFLICT: { 'uz-Latn': 'Bu so\'rov boshqa ma\'lumotlar bilan yuborilgan', ru: 'Ключ идемпотентности уже использован с другими данными', en: 'Idempotency key reused with different data' },
  WAIVER_REQUIRED: { 'uz-Latn': 'Avval javobgarlik hujjatini imzolang', ru: 'Сначала подпишите отказ от ответственности', en: 'Please sign the liability waiver first' },
  GUARDIAN_REQUIRED: { 'uz-Latn': "Voyaga yetmaganlar uchun ota-ona ma'lumotlari kerak", ru: 'Для несовершеннолетних нужны данные родителя', en: 'Guardian details are required for minors' },
  SKILL_LEVEL_MISMATCH: { 'uz-Latn': "O'yin darajasi sizning darajangizga mos emas", ru: 'Уровень игры не соответствует вашему', en: 'Match level does not fit your level' },
  AGE_RESTRICTED: { 'uz-Latn': "Bu o'yin uchun yosh cheklovi bor", ru: 'Для этой игры есть ограничение по возрасту', en: 'This match is age-restricted' },
  OUTSIDE_GEOFENCE: { 'uz-Latn': 'Siz maydondan uzoqdasiz ({distance_m} m)', ru: 'Вы далеко от площадки ({distance_m} м)', en: 'You are too far from the venue ({distance_m} m)' },
  WALLET_INSUFFICIENT: { 'uz-Latn': "Hamyonda mablag' yetarli emas", ru: 'Недостаточно средств в кошельке', en: 'Insufficient wallet balance' },
  PAYMENT_METHOD_UNAVAILABLE: { 'uz-Latn': "Bu to'lov usuli mavjud emas", ru: 'Способ оплаты недоступен', en: 'Payment method unavailable' },
  OTP_INVALID: { 'uz-Latn': "Kod noto'g'ri", ru: 'Неверный код', en: 'Invalid code' },
  OTP_EXPIRED: { 'uz-Latn': 'Kod muddati tugagan. Yangi kod so\'rang', ru: 'Срок действия кода истёк', en: 'The code has expired' },
  OTP_TOO_MANY_ATTEMPTS: { 'uz-Latn': "Urinishlar soni tugadi. Yangi kod so'rang", ru: 'Слишком много попыток', en: 'Too many attempts' },
  RATE_LIMITED: { 'uz-Latn': "Juda ko'p so'rov. {retry_after} soniyadan keyin urinib ko'ring", ru: 'Слишком много запросов. Повторите через {retry_after} с', en: 'Too many requests. Retry in {retry_after}s' },
  NOT_IMPLEMENTED: { 'uz-Latn': 'Bu funksiya hali ishga tushirilmagan', ru: 'Функция ещё не доступна', en: 'Not implemented yet' },
  INTERNAL: { 'uz-Latn': 'Ichki xatolik. Keyinroq urinib ko\'ring', ru: 'Внутренняя ошибка', en: 'Internal error' },
};

export function errorMessage(code: ErrorCode, locale: Locale, params: Record<string, string | number> = {}): string {
  const m = MESSAGES[code];
  const tpl = locale === 'uz-Cyrl' ? m['uz-Latn'] : m[locale];
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}
