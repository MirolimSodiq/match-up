import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { ENV, type Env } from '../config/env';
import { formatMoney } from '../common/money';
import { emit } from '../common/outbox';
import { SeatsService, type LockedBooking } from '../commerce/seats.service';
import { DB, type Db, one, pgError, PG, type Tx } from '../db/db';
import { RefundSettlement } from './refund-settlement';

/**
 * Uzum Bank Merchant API (https://developer.uzumbank.uz/merchant): Uzum bizning endpointlarni chaqiradi —
 * /check -> /create -> (Uzum mijoz kartasidan yechadi) -> /confirm; bekor qilish — /reverse,
 * /confirm'da xato yoki timeout bo'lsa — /status (10 martagacha).
 * JSON, summalar tiyin'da, vaqtlar millisekundda. Muvaffaqiyat — HTTP 200, xato — HTTP 400 + `errorCode` (string).
 * /create'dan 30 daqiqa ichida /confirm kelmasa tranzaksiya FAILED.
 */

export type UzumOperation = 'check' | 'create' | 'confirm' | 'reverse' | 'status';
const OPERATIONS: readonly string[] = ['check', 'create', 'confirm', 'reverse', 'status'];

/** Uzum xato kodlari (hujjatdagi "Error Codes" jadvali). */
export const UZUM_ERR = {
  ACCESS_DENIED: '10001',
  JSON_PARSE: '10002',
  INVALID_OPERATION: '10003',
  MISSING_PARAMS: '10005',
  INVALID_SERVICE: '10006',
  NOT_FOUND: '10007',
  ALREADY_PAID: '10008',
  PAYMENT_CANCELLED: '10009',
  TX_EXISTS: '10010',
  INVALID_AMOUNT: '10011',
  TX_NOT_FOUND: '10014',
  TX_CANCELLED: '10015',
  TX_CONFIRMED: '10016',
  CANNOT_REVERSE: '10017',
  TX_REVERSED: '10018',
  INTERNAL: '99999',
} as const;
type UzumCode = (typeof UZUM_ERR)[keyof typeof UZUM_ERR];

/** /create'dan keyin /confirm shu muddatda kelmasa — tranzaksiya muvaffaqiyatsiz (hujjat: 30 daqiqa). */
export const UZUM_CONFIRM_TIMEOUT_MS = 30 * 60_000;

export interface UzumRequest {
  serviceId?: unknown;
  timestamp?: unknown;
  transId?: unknown;
  params?: unknown;
  amount?: unknown;
  paymentSource?: unknown;
  tariff?: unknown;
  processingReferenceNumber?: unknown;
  phone?: unknown;
  cardType?: unknown;
}

export interface UzumReply {
  status: 200 | 400 | 500;
  body: Record<string, unknown>;
}

interface Times {
  transTime?: number | null;
  confirmTime?: number | null;
  reverseTime?: number | null;
}

class UzumError extends Error {
  constructor(
    readonly code: UzumCode,
    readonly times: Times = {},
  ) {
    super(`uzum ${code}`);
  }
}

/** payments.provider_state (Uzum). FAILED — bizning tomonda yakunlangan (timeout, joy yo'q, boshqa usul bilan to'langan). */
interface UzumState {
  state: 'CREATED' | 'CONFIRMED' | 'REVERSED' | 'FAILED';
  service_id: number;
  trans_time: number;
  confirm_time: number | null;
  reverse_time: number | null;
  failed_time?: number;
  failure?: string;
  payment_source?: string | null;
  tariff?: string | null;
  processing_reference_number?: string | null;
  card_type?: number | null;
}

interface PaymentRow {
  id: string;
  booking_id: string;
  amount: number;
  currency: string;
  provider_state: UzumState;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANS_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** Buzilgan JSON: handler 10002 qaytaradi, xom matn payment_events'ga yoziladi. */
class InvalidJson {
  constructor(readonly raw: string) {}
}

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Uzum webhook'lari uchun JSON parser — Nest'ning global body-parser'idan OLDIN (configureApp). Buzilgan JSON
 * global ProblemFilter'ga (problem+json) tushmasin: so'rov controller'ga yetib boradi, auth tekshiriladi,
 * payment_events'ga yoziladi va Uzum formatidagi 10002 qaytadi.
 */
export function uzumJsonBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.method !== 'POST' || !req.is('application/json')) return next();
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size <= MAX_BODY_BYTES) chunks.push(c);
  });
  req.on('error', next);
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    try {
      if (size > MAX_BODY_BYTES) throw new Error('too large');
      req.body = JSON.parse(raw);
    } catch {
      req.body = new InvalidJson(raw.slice(0, 2000));
    }
    // body-parser bu so'rovni qayta o'qimaydi (1.x: _body, 2.x: oqim tugagan)
    (req as Request & { _body?: boolean })._body = true;
    next();
  });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** payment_events'ga yoziladigan payload: mijoz telefoni maskalanadi. */
function redact(req: UzumRequest): UzumRequest {
  if (typeof req.phone !== 'string') return req;
  return { ...req, phone: req.phone.replace(/^(\d{3})\d+(\d{4})$/, '$1*****$2') };
}

@Injectable()
export class UzumService {
  private readonly log = new Logger('Uzum');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly seats: SeatsService,
    private readonly refunds: RefundSettlement,
  ) {}

  /** `Authorization: Basic base64(login:parol)`; SHA-256 dan keyin solishtirish — uzunlik ham sizib chiqmaydi. */
  authorize(header: string | undefined): boolean {
    if (!header?.startsWith('Basic ')) return false;
    const actual = createHash('sha256').update(Buffer.from(header.slice(6).trim(), 'base64')).digest();
    const expected = createHash('sha256').update(`${this.env.UZUM_LOGIN}:${this.env.UZUM_PASSWORD}`).digest();
    return timingSafeEqual(actual, expected);
  }

  async handle(operation: string, httpMethod: string, body: unknown, authHeader: string | undefined): Promise<UzumReply> {
    const req: UzumRequest = isObject(body) && !(body instanceof InvalidJson) ? body : {};
    const op = operation.slice(0, 16);
    const ctx: { paymentId?: string } = {};
    let eventId: string | undefined;
    let reply: UzumReply;
    try {
      const authorized = this.authorize(authHeader);
      eventId = await this.logEvent(op, body instanceof InvalidJson ? { invalid_json: body.raw } : req, authorized);
      if (!authorized) throw new UzumError(UZUM_ERR.ACCESS_DENIED);
      if (httpMethod !== 'POST' || !OPERATIONS.includes(op)) throw new UzumError(UZUM_ERR.INVALID_OPERATION);
      if (!isObject(body) || body instanceof InvalidJson) throw new UzumError(UZUM_ERR.JSON_PARSE);
      switch (op as UzumOperation) {
        case 'check':
          reply = await this.check(req);
          break;
        case 'create':
          reply = await this.create(req, ctx);
          break;
        case 'confirm':
          reply = await this.confirm(req, ctx);
          break;
        case 'reverse':
          reply = await this.reverse(req, ctx);
          break;
        case 'status':
          reply = await this.status(req, ctx);
          break;
      }
    } catch (err) {
      if (err instanceof UzumError) reply = this.failure(op, req, err.code, err.times);
      else {
        // Kutilmagan xato (DB va h.k.): 5xx — /confirm'da Uzum /status bilan haqiqiy holatni so'raydi
        this.log.error(err);
        reply = this.failure(op, req, UZUM_ERR.INTERNAL, {}, 500);
      }
    }
    if (eventId) await this.finishEvent(eventId, reply, ctx.paymentId).catch((e: unknown) => this.log.error(e));
    return reply;
  }

  /** Har bir chaqiruv (auth xatosi bilan ham) payment_events'ga; natija — processed_at / processing_error. */
  private async logEvent(op: string, req: UzumRequest & { invalid_json?: string }, valid: boolean): Promise<string> {
    const transId = typeof req.transId === 'string' ? req.transId.slice(0, 64) : '-';
    const row = await one<{ id: string }>(
      this.db,
      sql`INSERT INTO payment_events (provider, provider_event_id, event_type, payload, signature_valid)
          VALUES ('uzum', ${`${op}:${transId}:${randomUUID()}`}, ${op}, ${JSON.stringify(redact(req))}::jsonb, ${valid})
          RETURNING id`,
    );
    return row!.id;
  }

  private async finishEvent(eventId: string, reply: UzumReply, paymentId: string | undefined) {
    const error = reply.status === 200 ? null : String(reply.body.errorCode);
    await this.db.execute(
      sql`UPDATE payment_events SET processed_at = now(), payment_id = ${paymentId ?? null}, processing_error = ${error}
          WHERE id = ${eventId}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Javoblar
  // ---------------------------------------------------------------------------
  private ok(body: Record<string, unknown>): UzumReply {
    return { status: 200, body };
  }

  /** Xato javobi: hujjatdagi har operatsiyaning 400 sxemasi (vaqt maydonlari operatsiyaga qarab). */
  private failure(op: string, req: UzumRequest, code: UzumCode, t: Times = {}, httpStatus: 400 | 500 = 400): UzumReply {
    const now = Date.now();
    const body: Record<string, unknown> = {
      serviceId: Number.isInteger(req.serviceId) ? req.serviceId : this.env.UZUM_SERVICE_ID,
      ...(typeof req.transId === 'string' ? { transId: req.transId } : {}),
      status: 'FAILED',
    };
    if (op === 'create') body.transTime = t.transTime ?? now;
    else if (op === 'confirm') body.confirmTime = t.confirmTime ?? now;
    else if (op === 'reverse') body.reverseTime = t.reverseTime ?? now;
    else if (op === 'status') Object.assign(body, { transTime: t.transTime ?? null, confirmTime: t.confirmTime ?? null, reverseTime: t.reverseTime ?? null });
    else body.timestamp = now;
    body.errorCode = code;
    return { status: httpStatus, body };
  }

  /** Uzum ilovasida ko'rsatiladigan qo'shimcha ma'lumot: `{kalit: {value: string}}`. */
  private async data(ex: Tx, bookingId: string): Promise<Record<string, { value: string }>> {
    const m = await one<{ public_code: string; total_amount: number; currency: string }>(
      ex,
      sql`SELECT m.public_code, b.total_amount, b.currency FROM bookings b JOIN matches m ON m.id = b.match_id WHERE b.id = ${bookingId}`,
    );
    return {
      [this.env.UZUM_ACCOUNT_PARAM]: { value: bookingId },
      ...(m ? { match: { value: m.public_code }, total: { value: formatMoney(m.total_amount, m.currency, 'uz-Latn') } } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Validatsiya
  // ---------------------------------------------------------------------------
  /** serviceId + timestamp majburiy (10005); serviceId bizniki bo'lmasa — 10006 (faqat /check, /create). */
  private serviceIdFrom(req: UzumRequest, checkOwner: boolean): number {
    if (!Number.isInteger(req.serviceId) || !Number.isInteger(req.timestamp)) throw new UzumError(UZUM_ERR.MISSING_PARAMS);
    if (checkOwner && req.serviceId !== this.env.UZUM_SERVICE_ID) throw new UzumError(UZUM_ERR.INVALID_SERVICE);
    return req.serviceId as number;
  }

  private transIdFrom(req: UzumRequest): string {
    if (typeof req.transId !== 'string' || !TRANS_ID_RE.test(req.transId)) throw new UzumError(UZUM_ERR.MISSING_PARAMS);
    return req.transId;
  }

  private bookingIdFrom(req: UzumRequest): string {
    if (!isObject(req.params)) throw new UzumError(UZUM_ERR.MISSING_PARAMS);
    const raw = req.params[this.env.UZUM_ACCOUNT_PARAM];
    if (raw === undefined || raw === null || raw === '') throw new UzumError(UZUM_ERR.MISSING_PARAMS);
    const id = String(raw).trim();
    if (!UUID_RE.test(id)) throw new UzumError(UZUM_ERR.NOT_FOUND);
    return id.toLowerCase();
  }

  private amountFrom(req: UzumRequest): number {
    if (req.amount === undefined || req.amount === null) throw new UzumError(UZUM_ERR.MISSING_PARAMS);
    if (typeof req.amount !== 'number' || !Number.isSafeInteger(req.amount) || req.amount <= 0) throw new UzumError(UZUM_ERR.INVALID_AMOUNT);
    return req.amount;
  }

  /**
   * Booking'ni lock qiladi va to'lovga yaroqliligini tekshiradi: tasdiqlangan — 10008; bekor qilingan
   * yoki hold muddati o'tib joy qolmagan — 10009 (pul yechilmaydi); muddati o'tgan, joy bor — qayta hold.
   */
  private async payableBooking(tx: Tx, bookingId: string, amount?: number): Promise<LockedBooking> {
    const b = await this.seats.lockBooking(tx, bookingId);
    if (!b) throw new UzumError(UZUM_ERR.NOT_FOUND);
    if (b.status === 'confirmed' || b.status === 'completed') throw new UzumError(UZUM_ERR.ALREADY_PAID);
    if (amount !== undefined && (b.total_amount !== amount || b.currency !== 'UZS')) throw new UzumError(UZUM_ERR.INVALID_AMOUNT);
    if ((await this.seats.ensurePayable(tx, b)) !== 'ok') throw new UzumError(UZUM_ERR.PAYMENT_CANCELLED);
    return b;
  }

  private async lockTx(tx: Tx, transId: string): Promise<PaymentRow | undefined> {
    return one<PaymentRow>(
      tx,
      sql`SELECT id, booking_id, amount, currency, provider_state FROM payments
          WHERE provider = 'uzum' AND provider_transaction_id = ${transId} FOR UPDATE`,
    );
  }

  private async saveState(tx: Tx, pay: PaymentRow, st: UzumState, status: 'succeeded' | 'cancelled' | 'refunded') {
    pay.provider_state = st;
    await tx.execute(
      sql`UPDATE payments SET provider_state = ${JSON.stringify(st)}::jsonb, status = ${status}::payment_status, updated_at = now(),
                 succeeded_at = CASE WHEN ${status} = 'succeeded' THEN now() ELSE succeeded_at END,
                 cancelled_at = CASE WHEN ${status} IN ('cancelled', 'refunded') THEN now() ELSE cancelled_at END,
                 refunded_amount = CASE WHEN ${status} = 'refunded' THEN amount ELSE refunded_amount END,
                 failure_code = ${st.state === 'FAILED' ? (st.failure ?? null) : null}
          WHERE id = ${pay.id}`,
    );
  }

  /** Bizning tomonda yakunlash (FAILED): to'lov bekor, hold ozod (boshqa usul bilan tasdiqlangan booking'ga tegilmaydi). */
  private async failTx(tx: Tx, pay: PaymentRow, reason: string) {
    await this.saveState(tx, pay, { ...pay.provider_state, state: 'FAILED', failed_time: Date.now(), failure: reason }, 'cancelled');
    await this.seats.release(tx, pay.booking_id, 'cancelled', 'payment_cancelled', undefined, { onlyPending: true });
  }

  private expired(st: UzumState): boolean {
    return st.state === 'CREATED' && Date.now() - st.trans_time > UZUM_CONFIRM_TIMEOUT_MS;
  }

  // ---------------------------------------------------------------------------
  // Operatsiyalar
  // ---------------------------------------------------------------------------
  private async check(req: UzumRequest): Promise<UzumReply> {
    const serviceId = this.serviceIdFrom(req, true);
    const bookingId = this.bookingIdFrom(req);
    return this.db.transaction(async (tx) => {
      const b = await this.payableBooking(tx, bookingId);
      return this.ok({ serviceId, timestamp: Date.now(), status: 'OK', data: await this.data(tx, b.id) });
    });
  }

  private async create(req: UzumRequest, ctx: { paymentId?: string }): Promise<UzumReply> {
    const serviceId = this.serviceIdFrom(req, true);
    const transId = this.transIdFrom(req);
    const bookingId = this.bookingIdFrom(req);
    const amount = this.amountFrom(req);
    try {
      return await this.db.transaction(async (tx) => {
        // Hujjat bo'yicha takroriy /create (o'sha transId) — 10010; ikkinchi payments qatori yaratilmaydi
        const existing = await this.lockTx(tx, transId);
        if (existing) {
          ctx.paymentId = existing.id;
          throw new UzumError(UZUM_ERR.TX_EXISTS, { transTime: existing.provider_state.trans_time });
        }
        const b = await this.payableBooking(tx, bookingId, amount);
        const st: UzumState = { state: 'CREATED', service_id: serviceId, trans_time: Date.now(), confirm_time: null, reverse_time: null };
        // Booking yaratilganda tayyorlangan 'created' qatorni ishlatamiz (bo'lmasa — yangi). Booking lock'i ostida.
        const updated = await one<{ id: string }>(
          tx,
          sql`UPDATE payments SET provider_transaction_id = ${transId}, status = 'pending', updated_at = now(),
                     provider_state = ${JSON.stringify(st)}::jsonb
              WHERE id = (SELECT id FROM payments WHERE booking_id = ${b.id} AND provider = 'uzum'
                          AND status = 'created' AND provider_transaction_id IS NULL ORDER BY created_at LIMIT 1)
              RETURNING id`,
        );
        const payment =
          updated ??
          (await one<{ id: string }>(
            tx,
            sql`INSERT INTO payments (booking_id, user_id, provider, amount, currency, status, provider_transaction_id, provider_state)
                VALUES (${b.id}, ${b.user_id}, 'uzum', ${amount}, ${b.currency}, 'pending', ${transId}, ${JSON.stringify(st)}::jsonb)
                RETURNING id`,
          ));
        await this.seats.extendHold(tx, b.id);
        ctx.paymentId = payment!.id;
        return this.ok({ serviceId, transId, status: 'CREATED', transTime: st.trans_time, data: await this.data(tx, b.id), amount });
      });
    } catch (err) {
      // Parallel takroriy /create — birinchisi yutdi
      if (!(err instanceof UzumError) && pgError(err)?.code === PG.UNIQUE_VIOLATION) throw new UzumError(UZUM_ERR.TX_EXISTS);
      throw err;
    }
  }

  private async confirm(req: UzumRequest, ctx: { paymentId?: string }): Promise<UzumReply> {
    const serviceId = this.serviceIdFrom(req, false);
    const transId = this.transIdFrom(req);
    const fail = (code: UzumCode, t: Times = {}) => this.failure('confirm', req, code, t);
    return this.db.transaction(async (tx) => {
      const pay = await this.lockTx(tx, transId);
      if (!pay) return fail(UZUM_ERR.TX_NOT_FOUND);
      ctx.paymentId = pay.id;
      const st = pay.provider_state;
      if (st.state === 'CONFIRMED') return fail(UZUM_ERR.TX_CONFIRMED, { confirmTime: st.confirm_time });
      if (st.state !== 'CREATED') return fail(UZUM_ERR.TX_CANCELLED);
      if (this.expired(st)) {
        await this.failTx(tx, pay, 'confirm_timeout');
        return fail(UZUM_ERR.TX_CANCELLED);
      }
      // Pul yechilgan, lekin xizmat berilmaydi: joy qolmagan yoki booking boshqa usul bilan to'langan ->
      // FAILED qaytaramiz, Uzum mijozga pulni qaytaradi (ikki marta yechilmaydi)
      const outcome = await this.seats.confirmPaid(tx, pay.booking_id);
      if (outcome !== 'confirmed') {
        await this.failTx(tx, pay, outcome === 'already_confirmed' ? 'already_paid' : outcome);
        return fail(UZUM_ERR.TX_CANCELLED);
      }
      const next: UzumState = {
        ...st,
        state: 'CONFIRMED',
        confirm_time: Date.now(),
        payment_source: str(req.paymentSource),
        tariff: str(req.tariff),
        processing_reference_number: str(req.processingReferenceNumber),
        card_type: Number.isInteger(req.cardType) ? (req.cardType as number) : null,
      };
      await this.saveState(tx, pay, next, 'succeeded');
      await emit(tx, 'payment', pay.id, 'PaymentSucceeded', { provider: 'uzum', booking_id: pay.booking_id, amount: pay.amount });
      return this.ok({
        serviceId,
        transId,
        status: 'CONFIRMED',
        confirmTime: next.confirm_time,
        data: await this.data(tx, pay.booking_id),
        amount: pay.amount,
      });
    });
  }

  private async reverse(req: UzumRequest, ctx: { paymentId?: string }): Promise<UzumReply> {
    const serviceId = this.serviceIdFrom(req, false);
    const transId = this.transIdFrom(req);
    const fail = (code: UzumCode, t: Times = {}) => this.failure('reverse', req, code, t);
    return this.db.transaction(async (tx) => {
      const pay = await this.lockTx(tx, transId);
      if (!pay) return fail(UZUM_ERR.TX_NOT_FOUND);
      ctx.paymentId = pay.id;
      const st = pay.provider_state;
      if (st.state === 'REVERSED') return fail(UZUM_ERR.TX_REVERSED, { reverseTime: st.reverse_time });
      if (st.state === 'FAILED') return fail(UZUM_ERR.TX_REVERSED, { reverseTime: st.failed_time ?? null });

      const next: UzumState = { ...st, state: 'REVERSED', reverse_time: Date.now() };
      if (st.state === 'CREATED') {
        // Pul hali yechilmagan: to'lov bekor, hold ozod
        await this.saveState(tx, pay, next, 'cancelled');
        await this.seats.release(tx, pay.booking_id, 'cancelled', 'payment_cancelled', undefined, { onlyPending: true });
      } else {
        // CONFIRMED -> refund. Admin Uzum kabinetidan bizning navbatdagi refund'ni bajargan bo'lsa — o'yin boshlangan
        // bo'lsa ham; so'ralmagan bekor qilishda o'yin boshlangan bo'lsa xizmat ko'rsatilgan hisoblanadi.
        const requested = (await this.refunds.pending(tx, pay.id)).length > 0;
        if (!requested) {
          const started = await one<{ started: boolean }>(
            tx,
            sql`SELECT m.starts_at <= now() AS started FROM bookings b JOIN matches m ON m.id = b.match_id WHERE b.id = ${pay.booking_id}`,
          );
          if (started?.started) return fail(UZUM_ERR.CANNOT_REVERSE);
        }
        await this.seats.release(tx, pay.booking_id, 'cancelled', 'payment_refunded');
        await this.refunds.providerReversed(tx, pay.id, transId);
        await this.saveState(tx, pay, next, 'refunded');
      }
      return this.ok({
        serviceId,
        transId,
        status: 'REVERSED',
        reverseTime: next.reverse_time,
        data: await this.data(tx, pay.booking_id),
        amount: pay.amount,
      });
    });
  }

  private async status(req: UzumRequest, ctx: { paymentId?: string }): Promise<UzumReply> {
    const serviceId = this.serviceIdFrom(req, false);
    const transId = this.transIdFrom(req);
    return this.db.transaction(async (tx) => {
      const pay = await this.lockTx(tx, transId);
      if (!pay) return this.failure('status', req, UZUM_ERR.TX_NOT_FOUND);
      ctx.paymentId = pay.id;
      if (this.expired(pay.provider_state)) await this.failTx(tx, pay, 'confirm_timeout');
      const st = pay.provider_state;
      const times = { transTime: st.trans_time, confirmTime: st.confirm_time, reverseTime: st.reverse_time };
      if (st.state === 'FAILED') return this.failure('status', req, UZUM_ERR.TX_CANCELLED, times);
      return this.ok({ serviceId, transId, status: st.state, ...times, data: await this.data(tx, pay.booking_id), amount: pay.amount });
    });
  }
}
