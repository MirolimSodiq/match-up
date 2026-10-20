import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { IdTokenRejected } from './id-token';

/** Telegram Login Widget / oauth.telegram.org natijasi. */
export type TelegramAuthData = Record<string, string | number>;

export interface TelegramUser {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  authDate: number;
}

const fail = (reason: string): never => {
  throw new IdTokenRejected(reason);
};

/**
 * https://core.telegram.org/widgets/login#checking-authorization
 * data_check_string = hash'dan boshqa barcha maydonlar, kalit bo'yicha saralangan, `key=value`, `\n` bilan.
 * hash = hex(HMAC-SHA256(data_check_string, SHA256(bot_token))). auth_date `maxAgeSec` dan eski bo'lmasin.
 */
export function verifyTelegramAuth(data: TelegramAuthData, botToken: string, maxAgeSec: number, nowSec = Math.floor(Date.now() / 1000)): TelegramUser {
  const hash = data.hash;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) fail('hash format');

  const checkString = Object.keys(data)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash as string, 'hex'))) fail('hash');

  const authDate = Number(data.auth_date);
  if (!Number.isInteger(authDate)) fail('auth_date');
  if (nowSec - authDate > maxAgeSec) fail('auth_date eskirgan');
  if (authDate > nowSec + 60) fail('auth_date kelajakda');

  const id = String(data.id ?? '');
  if (!/^[1-9]\d{0,19}$/.test(id)) fail('id');
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return { id, firstName: str(data.first_name), lastName: str(data.last_name), username: str(data.username), authDate };
}

/** Bot token'ning ochiq qismi (`<bot_id>:<secret>`) — oauth.telegram.org uchun. */
export function telegramBotId(botToken: string): string {
  return botToken.split(':')[0] ?? '';
}
