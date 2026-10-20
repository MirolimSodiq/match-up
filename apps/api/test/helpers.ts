import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule, configureApp } from '../src/app.module';
import { OTP_SENDER, type OtpSender } from '../src/identity/otp-senders';
import { type PushMessage, type PushReceipt, PUSH_SENDERS, type PushSender, type PushTicket } from '../src/notifications/push/push-sender';

/** OTP kodlarini yuborish o'rniga ushlab qoladigan fake sender. */
export class CapturingOtpSender implements OtpSender {
  readonly codes = new Map<string, string>();
  async send(phone: string, code: string) {
    this.codes.set(phone, code);
  }
}

/** Expo o'rniga: xabarlarni ushlab qoladi; token/ticket bo'yicha xatolarni simulyatsiya qiladi. */
export class FakePushSender implements PushSender {
  readonly provider = 'expo' as const;
  sent: PushMessage[] = [];
  /** token -> provider xatosi (masalan, DeviceNotRegistered) */
  readonly failTokens = new Map<string, string>();
  /** ticket id -> receipt xatosi */
  readonly receiptErrors = new Map<string, string>();
  /** Keyingi N ta `send` tarmoq xatosi bilan tugaydi. */
  throwNext = 0;
  private seq = 0;

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (this.throwNext > 0) {
      this.throwNext--;
      throw new Error('fake: network down');
    }
    this.sent.push(...messages);
    return messages.map((m) => {
      const error = this.failTokens.get(m.to);
      return error ? { ok: false as const, error } : { ok: true as const, id: `ticket-${++this.seq}` };
    });
  }

  async receipts(ids: string[]): Promise<Map<string, PushReceipt>> {
    return new Map(
      ids.map((id) => {
        const error = this.receiptErrors.get(id);
        return [id, error ? { ok: false as const, error } : { ok: true as const }];
      }),
    );
  }

  to(token: string): PushMessage[] {
    return this.sent.filter((m) => m.to === token);
  }
}

export interface TestCtx {
  app: INestApplication;
  url: string;
  http: () => ReturnType<typeof request>;
  otp: CapturingOtpSender;
  push: FakePushSender;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestCtx> {
  const otp = new CapturingOtpSender();
  const push = new FakePushSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OTP_SENDER)
    .useValue(otp)
    // E2E hech qachon haqiqiy Expo Push API'ga chiqmaydi
    .overrideProvider(PUSH_SENDERS)
    .useValue([push])
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  // Bitta doimiy port: supertest server'ni har so'rovda ochib-yopmaydi (poyga holatisiz)
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    app,
    url,
    http: () => request(url),
    otp,
    push,
    close: () => app.close(),
  };
}

export const device = { device_id: 'e2e-device', platform: 'ios' as const, app_version: '1.0.0' };

export interface Session {
  token: string;
  refresh: string;
  userId: string;
  auth: { Authorization: string };
}

/** OTP oqimi orqali kirish (seed'dagi yoki yangi telefon). */
export async function login(ctx: TestCtx, phone: string): Promise<Session> {
  const req = await ctx.http().post('/v1/auth/otp/request').send({ phone }).expect(200);
  const code = ctx.otp.codes.get(phone);
  if (!code) throw new Error(`OTP ushlanmadi: ${phone}`);
  const res = await ctx
    .http()
    .post('/v1/auth/otp/verify')
    .send({ challenge_id: req.body.challenge_id, code, device })
    .expect(200);
  return {
    token: res.body.access_token,
    refresh: res.body.refresh_token,
    userId: res.body.user.id,
    auth: { Authorization: `Bearer ${res.body.access_token}` },
  };
}

export const uuid = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// To'lov va DB yordamchilari
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../src/db/db';

export const PAYME_AUTH = 'Basic ' + Buffer.from('Paycom:payme_test_key').toString('base64');

export async function payme(ctx: TestCtx, method: string, params: Record<string, unknown>, auth = PAYME_AUTH) {
  const res = await ctx
    .http()
    .post('/v1/webhooks/payme')
    .set('Authorization', auth)
    .send({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method, params })
    .expect(200);
  return res.body as { result?: Record<string, any>; error?: { code: number; message: Record<string, string>; data?: string } };
}

export function clickSign(p: Record<string, string>, withPrepare: boolean, secret = 'click_test_secret') {
  const parts = [p.click_trans_id, p.service_id, secret, p.merchant_trans_id];
  if (withPrepare) parts.push(p.merchant_prepare_id ?? '');
  parts.push(p.amount!, p.action!, p.sign_time!);
  return createHash('md5').update(parts.join('')).digest('hex');
}

export function db(ctx: TestCtx): Pool {
  return ctx.app.get<Pool>(PG_POOL);
}

export async function q<T = Record<string, any>>(ctx: TestCtx, text: string, params: unknown[] = []): Promise<T[]> {
  return (await db(ctx).query(text, params)).rows as T[];
}

export async function matchId(ctx: TestCtx, code: string): Promise<string> {
  return (await q<{ id: string }>(ctx, 'SELECT id FROM matches WHERE public_code = $1', [code]))[0]!.id;
}

export async function signatureId(ctx: TestCtx, s: Session, mId: string): Promise<string> {
  const r = await ctx.http().get(`/v1/waivers/required?match_id=${mId}`).set(s.auth).expect(200);
  return r.body.signature_id;
}

/** Payme orqali booking + to'lov: Check -> Create -> Perform. */
export async function bookAndPayWithPayme(ctx: TestCtx, s: Session, mId: string) {
  const b = await ctx
    .http()
    .post('/v1/bookings')
    .set(s.auth)
    .set('Idempotency-Key', uuid())
    .send({ match_id: mId, payment_method: 'payme', waiver_signature_id: await signatureId(ctx, s, mId) })
    .expect(201);
  const booking = b.body.booking;
  const txId = createHash('md5').update(booking.id).digest('hex').slice(0, 24);
  const params = { amount: booking.total.amount, account: { booking_id: booking.id } };
  expect((await payme(ctx, 'CheckPerformTransaction', params)).result).toMatchObject({ allow: true });
  expect((await payme(ctx, 'CreateTransaction', { id: txId, time: Date.now(), ...params })).result).toMatchObject({ state: 1 });
  expect((await payme(ctx, 'PerformTransaction', { id: txId })).result).toMatchObject({ state: 2 });
  return { bookingId: booking.id as string, txId, amount: booking.total.amount as number };
}
