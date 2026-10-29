import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { emit } from '../common/outbox';
import { SeatsService, type LockedBooking } from '../commerce/seats.service';
import { DB, type Db, one, rows, type Tx } from '../db/db';
import { FISCAL_ITEM_TITLE, fiscalCodes } from './fiscal';
import { RefundSettlement } from './refund-settlement';

/**
 * Payme Merchant API (JSON-RPC 2.0). Payme bizning endpointni chaqiradi:
 * CheckPerformTransaction -> CreateTransaction -> PerformTransaction (yoki CancelTransaction).
 * Summalar tiyin'da, vaqtlar millisekundda. Har doim HTTP 200, xato `error` ichida.
 */

type Msg = { uz: string; ru: string; en: string };

export class PaymeError extends Error {
  constructor(
    readonly code: number,
    readonly msg: Msg,
    readonly data?: string,
  ) {
    super(msg.en);
  }
}

const E = {
  AUTH: () => new PaymeError(-32504, { uz: "Ruxsat yo'q", ru: 'Недостаточно привилегий', en: 'Insufficient privilege' }),
  METHOD: () => new PaymeError(-32601, { uz: 'Metod topilmadi', ru: 'Метод не найден', en: 'Method not found' }),
  PARAMS: () => new PaymeError(-32600, { uz: "So'rov noto'g'ri", ru: 'Неверный запрос', en: 'Invalid request' }),
  SYSTEM: () => new PaymeError(-32400, { uz: 'Tizim xatosi', ru: 'Системная ошибка', en: 'System error' }),
  AMOUNT: () => new PaymeError(-31001, { uz: "Summa noto'g'ri", ru: 'Неверная сумма', en: 'Incorrect amount' }),
  TX_NOT_FOUND: () => new PaymeError(-31003, { uz: 'Tranzaksiya topilmadi', ru: 'Транзакция не найдена', en: 'Transaction not found' }),
  CANNOT_CANCEL: () => new PaymeError(-31007, { uz: "O'yin boshlangan, bekor qilib bo'lmaydi", ru: 'Игра уже началась, отмена невозможна', en: 'Match already started, cannot cancel' }),
  CANNOT_PERFORM: () => new PaymeError(-31008, { uz: "Operatsiyani bajarib bo'lmaydi", ru: 'Невозможно выполнить операцию', en: 'Unable to perform operation' }),
  BOOKING_NOT_FOUND: () => new PaymeError(-31050, { uz: 'Buyurtma topilmadi', ru: 'Заказ не найден', en: 'Booking not found' }, 'booking_id'),
  NOT_PAYABLE: () => new PaymeError(-31051, { uz: "Buyurtmani to'lab bo'lmaydi", ru: 'Заказ недоступен для оплаты', en: 'Booking is not payable' }, 'booking_id'),
  NO_SEATS: () => new PaymeError(-31052, { uz: "O'yinda joy qolmadi", ru: 'Мест не осталось', en: 'No seats left' }, 'booking_id'),
  BUSY: () => new PaymeError(-31053, { uz: "Buyurtma bo'yicha boshqa to'lov jarayonda", ru: 'По заказу уже идёт другая оплата', en: 'Another payment is in progress' }, 'booking_id'),
};

/** Payme tranzaksiyasi 12 soatdan keyin state=1 da qolsa — timeout (reason 4). */
const TX_TIMEOUT_MS = 43_200_000;

export interface PaymeRpc {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

interface PaymeState {
  state: 1 | 2 | -1 | -2;
  time: number;
  create_time: number;
  perform_time: number;
  cancel_time: number;
  reason: number | null;
}

interface PaymentRow {
  id: string;
  booking_id: string;
  amount: number;
  provider_transaction_id: string;
  provider_state: PaymeState;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PaymeService {
  private readonly log = new Logger('Payme');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly seats: SeatsService,
    private readonly refunds: RefundSettlement,
  ) {}

  /** `Authorization: Basic base64("Paycom:" + KEY)` */
  authorize(header: string | undefined): boolean {
    if (!header?.startsWith('Basic ')) return false;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const expected = Buffer.from(`Paycom:${this.env.PAYME_KEY}`);
    const actual = Buffer.from(decoded);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async handle(rpc: PaymeRpc, authHeader: string | undefined): Promise<Record<string, unknown>> {
    const base = { jsonrpc: '2.0', id: rpc?.id ?? null };
    try {
      if (!this.authorize(authHeader)) throw E.AUTH();
      if (!rpc || typeof rpc.method !== 'string' || typeof rpc.params !== 'object' || rpc.params === null) throw E.PARAMS();
      await this.logEvent(rpc);
      const p = rpc.params;
      let result: Record<string, unknown>;
      switch (rpc.method) {
        case 'CheckPerformTransaction':
          result = await this.checkPerform(p);
          break;
        case 'CreateTransaction':
          result = await this.create(p);
          break;
        case 'PerformTransaction':
          result = await this.perform(p);
          break;
        case 'CancelTransaction':
          result = await this.cancel(p);
          break;
        case 'CheckTransaction':
          result = await this.check(p);
          break;
        case 'GetStatement':
          result = await this.statement(p);
          break;
        default:
          throw E.METHOD();
      }
      return { ...base, result };
    } catch (err) {
      const e = err instanceof PaymeError ? err : (this.log.error(err), E.SYSTEM());
      return { ...base, error: { code: e.code, message: e.msg, ...(e.data ? { data: e.data } : {}) } };
    }
  }

  private async logEvent(rpc: PaymeRpc) {
    const txId = typeof rpc.params?.id === 'string' ? rpc.params.id : '';
    await this.db.execute(
      sql`INSERT INTO payment_events (provider, provider_event_id, event_type, payload, signature_valid, processed_at)
          VALUES ('payme', ${`${rpc.method}:${txId}:${randomUUID()}`}, ${rpc.method!}, ${JSON.stringify(rpc)}::jsonb, true, now())`,
    );
  }

  // ---------------------------------------------------------------------------
  private bookingIdFrom(p: Record<string, unknown>): string {
    const account = p.account as Record<string, unknown> | undefined;
    const id = account?.booking_id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw E.BOOKING_NOT_FOUND();
    return id;
  }

  private amountFrom(p: Record<string, unknown>): number {
    if (typeof p.amount !== 'number' || !Number.isInteger(p.amount) || p.amount <= 0) throw E.AMOUNT();
    return p.amount;
  }

  /** Booking'ni lock qiladi va to'lovga yaroqliligini tekshiradi (kerak bo'lsa qayta hold). */
  private async payableBooking(tx: Tx, bookingId: string, amount: number): Promise<LockedBooking> {
    const b = await this.seats.lockBooking(tx, bookingId);
    if (!b) throw E.BOOKING_NOT_FOUND();
    if (b.total_amount !== amount) throw E.AMOUNT();
    const payable = await this.seats.ensurePayable(tx, b);
    if (payable === 'no_seat') throw E.NO_SEATS();
    if (payable === 'not_payable') throw E.NOT_PAYABLE();
    return b;
  }

  private async lockTx(tx: Tx, paymeId: unknown): Promise<PaymentRow | undefined> {
    if (typeof paymeId !== 'string' || !paymeId) throw E.PARAMS();
    return one<PaymentRow>(
      tx,
      sql`SELECT id, booking_id, amount, provider_transaction_id, provider_state FROM payments
          WHERE provider = 'payme' AND provider_transaction_id = ${paymeId} FOR UPDATE`,
    );
  }

  private async saveState(tx: Tx, paymentId: string, st: PaymeState, status: string) {
    await tx.execute(
      sql`UPDATE payments SET provider_state = ${JSON.stringify(st)}::jsonb, status = ${status}::payment_status,
                 succeeded_at = CASE WHEN ${status} = 'succeeded' THEN now() ELSE succeeded_at END,
                 cancelled_at = CASE WHEN ${status} IN ('cancelled', 'refunded') THEN now() ELSE cancelled_at END,
                 refunded_amount = CASE WHEN ${status} = 'refunded' THEN amount ELSE refunded_amount END
          WHERE id = ${paymentId}`,
    );
  }

  // ---------------------------------------------------------------------------
  private async checkPerform(p: Record<string, unknown>) {
    const bookingId = this.bookingIdFrom(p);
    const amount = this.amountFrom(p);
    return this.db.transaction(async (tx) => {
      await this.payableBooking(tx, bookingId, amount);
      return { allow: true, ...(this.receiptDetail(amount) ?? {}) };
    });
  }

  /** Fiskal chek (OFD) uchun detail — MXIK/IKPU kodi sozlangan bo'lsa. */
  private receiptDetail(amount: number) {
    const codes = fiscalCodes(this.env);
    if (!codes) return undefined;
    return {
      detail: {
        receipt_type: 0,
        items: [{ title: FISCAL_ITEM_TITLE, price: amount, count: 1, code: codes.mxik, package_code: codes.packageCode, vat_percent: 0 }],
      },
    };
  }

  private async create(p: Record<string, unknown>) {
    const paymeId = p.id;
    const time = typeof p.time === 'number' ? p.time : Date.now();
    const bookingId = this.bookingIdFrom(p);
    const amount = this.amountFrom(p);
    return this.db.transaction(async (tx) => {
      const existing = await this.lockTx(tx, paymeId);
      if (existing) {
        const st = existing.provider_state;
        if (st.state !== 1) throw E.CANNOT_PERFORM();
        if (Date.now() - st.create_time > TX_TIMEOUT_MS) {
          await this.cancelPending(tx, existing, 4);
          throw E.CANNOT_PERFORM();
        }
        return { create_time: st.create_time, transaction: existing.id, state: 1 };
      }

      const b = await this.payableBooking(tx, bookingId, amount);
      const busy = await one(
        tx,
        sql`SELECT 1 FROM payments WHERE booking_id = ${b.id} AND provider = 'payme'
            AND provider_transaction_id IS NOT NULL AND (provider_state->>'state')::int = 1`,
      );
      if (busy) throw E.BUSY();

      const st: PaymeState = { state: 1, time, create_time: Date.now(), perform_time: 0, cancel_time: 0, reason: null };
      // Booking yaratilganda tayyorlangan 'created' qatorni ishlatamiz (bo'lmasa — yangi)
      const updated = await one<{ id: string }>(
        tx,
        sql`UPDATE payments SET provider_transaction_id = ${paymeId as string}, status = 'pending',
                   provider_state = ${JSON.stringify(st)}::jsonb
            WHERE id = (SELECT id FROM payments WHERE booking_id = ${b.id} AND provider = 'payme'
                        AND status = 'created' AND provider_transaction_id IS NULL ORDER BY created_at LIMIT 1)
            RETURNING id`,
      );
      const payment =
        updated ??
        (await one<{ id: string }>(
          tx,
          sql`INSERT INTO payments (booking_id, user_id, provider, amount, currency, status, provider_transaction_id, provider_state)
              VALUES (${b.id}, ${b.user_id}, 'payme', ${amount}, ${b.currency}, 'pending', ${paymeId as string}, ${JSON.stringify(st)}::jsonb)
              RETURNING id`,
        ));
      await this.seats.extendHold(tx, b.id);
      return { create_time: st.create_time, transaction: payment!.id, state: 1 };
    });
  }

  private async perform(p: Record<string, unknown>) {
    return this.db.transaction(async (tx) => {
      const pay = await this.lockTx(tx, p.id);
      if (!pay) throw E.TX_NOT_FOUND();
      const st = pay.provider_state;
      if (st.state === 2) return { transaction: pay.id, perform_time: st.perform_time, state: 2 };
      if (st.state !== 1) throw E.CANNOT_PERFORM();
      if (Date.now() - st.create_time > TX_TIMEOUT_MS) {
        await this.cancelPending(tx, pay, 4);
        throw E.CANNOT_PERFORM();
      }
      // Pul yechilishidan oldin oxirgi tekshiruv: joy hali bormi (late payment -> qayta hold)
      const outcome = await this.seats.confirmPaid(tx, pay.booking_id);
      // already_confirmed: booking boshqa to'lov bilan tasdiqlangan — ikkinchi marta pul yechilmaydi
      if (outcome !== 'confirmed') throw E.CANNOT_PERFORM();
      const next: PaymeState = { ...st, state: 2, perform_time: Date.now() };
      await this.saveState(tx, pay.id, next, 'succeeded');
      await emit(tx, 'payment', pay.id, 'PaymentSucceeded', { provider: 'payme', booking_id: pay.booking_id, amount: pay.amount });
      return { transaction: pay.id, perform_time: next.perform_time, state: 2 };
    });
  }

  private async cancelPending(tx: Tx, pay: PaymentRow, reason: number) {
    const next: PaymeState = { ...pay.provider_state, state: -1, cancel_time: Date.now(), reason };
    await this.saveState(tx, pay.id, next, 'cancelled');
    await this.seats.release(tx, pay.booking_id, 'cancelled', 'payment_cancelled', undefined, { onlyPending: true });
    return next;
  }

  private async cancel(p: Record<string, unknown>) {
    const reason = typeof p.reason === 'number' ? p.reason : null;
    return this.db.transaction(async (tx) => {
      const pay = await this.lockTx(tx, p.id);
      if (!pay) throw E.TX_NOT_FOUND();
      const st = pay.provider_state;
      if (st.state === -1 || st.state === -2) return { transaction: pay.id, cancel_time: st.cancel_time, state: st.state };

      if (st.state === 1) {
        const next = await this.cancelPending(tx, pay, reason ?? 3);
        return { transaction: pay.id, cancel_time: next.cancel_time, state: -1 };
      }

      // state = 2: to'langan -> refund. Biz so'ragan refund (avto-refund `receipts.cancel` yoki admin Payme
      // kabinetidan) — o'yin boshlangan bo'lsa ham; so'ralmagan bekor qilishda o'yin boshlangan bo'lsa xizmat
      // ko'rsatilgan hisoblanadi.
      const requested = (await this.refunds.pending(tx, pay.id)).length > 0;
      if (!requested) {
        const started = await one<{ started: boolean }>(
          tx,
          sql`SELECT m.starts_at <= now() AS started FROM bookings b JOIN matches m ON m.id = b.match_id WHERE b.id = ${pay.booking_id}`,
        );
        if (started?.started) throw E.CANNOT_CANCEL();
      }
      await this.seats.release(tx, pay.booking_id, 'cancelled', 'payment_refunded');
      await this.refunds.providerReversed(tx, pay.id, pay.provider_transaction_id);
      const next: PaymeState = { ...st, state: -2, cancel_time: Date.now(), reason };
      await this.saveState(tx, pay.id, next, 'refunded');
      return { transaction: pay.id, cancel_time: next.cancel_time, state: -2 };
    });
  }

  private async check(p: Record<string, unknown>) {
    return this.db.transaction(async (tx) => {
      const pay = await this.lockTx(tx, p.id);
      if (!pay) throw E.TX_NOT_FOUND();
      const st = pay.provider_state;
      return {
        create_time: st.create_time,
        perform_time: st.perform_time,
        cancel_time: st.cancel_time,
        transaction: pay.id,
        state: st.state,
        reason: st.reason,
      };
    });
  }

  private async statement(p: Record<string, unknown>) {
    if (typeof p.from !== 'number' || typeof p.to !== 'number') throw E.PARAMS();
    const list = await rows<PaymentRow>(
      this.db,
      sql`SELECT id, booking_id, amount, provider_transaction_id, provider_state FROM payments
          WHERE provider = 'payme' AND provider_transaction_id IS NOT NULL
            AND (provider_state->>'create_time')::bigint BETWEEN ${p.from} AND ${p.to}
          ORDER BY (provider_state->>'create_time')::bigint`,
    );
    return {
      transactions: list.map((t) => ({
        id: t.provider_transaction_id,
        time: t.provider_state.time,
        amount: t.amount,
        account: { booking_id: t.booking_id },
        create_time: t.provider_state.create_time,
        perform_time: t.provider_state.perform_time,
        cancel_time: t.provider_state.cancel_time,
        transaction: t.id,
        state: t.provider_state.state,
        reason: t.provider_state.reason,
      })),
    };
  }
}
