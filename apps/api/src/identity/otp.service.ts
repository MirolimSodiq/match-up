import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { AppError } from '../common/errors';
import type { Locale } from '../common/i18n';
import { REDIS } from '../redis/redis.module';
import { OTP_SENDER, type OtpChannel, type OtpSender } from './otp-senders';

const MAX_ATTEMPTS = 5;

interface Challenge {
  phone: string;
  hash: string;
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  private hash(challengeId: string, code: string): string {
    return createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
  }

  private async limit(key: string, max: number, windowSec: number): Promise<void> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, windowSec);
    if (n > max) {
      const ttl = Math.max(await this.redis.ttl(key), 1);
      throw new AppError('RATE_LIMITED', { retry_after: ttl }, undefined, { 'Retry-After': String(ttl) });
    }
  }

  async request(phone: string, channel: OtpChannel, ip: string, locale: Locale) {
    // Qayta yuborish oralig'i (telefon bo'yicha)
    const cooldownKey = `otp:cooldown:${phone}`;
    const ok = await this.redis.set(cooldownKey, '1', 'EX', this.env.OTP_RESEND_SEC, 'NX');
    if (!ok) {
      const ttl = Math.max(await this.redis.ttl(cooldownKey), 1);
      throw new AppError('RATE_LIMITED', { retry_after: ttl }, undefined, { 'Retry-After': String(ttl) });
    }
    await this.limit(`otp:hour:phone:${phone}`, this.env.OTP_MAX_PER_PHONE_HOUR, 3600);
    await this.limit(`otp:hour:ip:${ip}`, this.env.OTP_MAX_PER_IP_HOUR, 3600);

    const challengeId = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const value: Challenge = { phone, hash: this.hash(challengeId, code) };
    await this.redis.set(`otp:ch:${challengeId}`, JSON.stringify(value), 'EX', this.env.OTP_TTL_SEC);
    await this.sender.send(phone, code, channel, locale);
    return { challenge_id: challengeId, expires_in: this.env.OTP_TTL_SEC, resend_after: this.env.OTP_RESEND_SEC };
  }

  /** Kodni tekshiradi va bir martalik challenge'ni yo'q qiladi. Tasdiqlangan telefonni qaytaradi. */
  async consume(challengeId: string, code: string): Promise<string> {
    const raw = await this.redis.get(`otp:ch:${challengeId}`);
    if (!raw) throw new AppError('OTP_EXPIRED');
    const ch = JSON.parse(raw) as Challenge;

    const attemptsKey = `otp:att:${challengeId}`;
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) await this.redis.expire(attemptsKey, this.env.OTP_TTL_SEC);
    if (attempts > MAX_ATTEMPTS) {
      await this.redis.del(`otp:ch:${challengeId}`);
      throw new AppError('OTP_TOO_MANY_ATTEMPTS');
    }

    const expected = Buffer.from(ch.hash, 'hex');
    const actual = Buffer.from(this.hash(challengeId, code), 'hex');
    if (!timingSafeEqual(expected, actual)) throw new AppError('OTP_INVALID');

    // Bir martalik: parallel ikkinchi so'rov o'tib ketmasligi uchun DEL natijasini tekshiramiz
    const deleted = await this.redis.del(`otp:ch:${challengeId}`);
    if (deleted === 0) throw new AppError('OTP_EXPIRED');
    await this.redis.del(attemptsKey, `otp:cooldown:${ch.phone}`);
    return ch.phone;
  }
}
