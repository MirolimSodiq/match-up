import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { majorStringToMinor } from '../common/money';
import { emit } from '../common/outbox';
import { SeatsService } from '../commerce/seats.service';
import { DB, type Db, one } from '../db/db';

/**
 * Click SHOP API: Prepare (action=0) -> Complete (action=1). Click form-urlencoded yuboradi,
 * summa so'mda (decimal). sign_string = md5(click_trans_id + service_id + SECRET + merchant_trans_id
 * [+ merchant_prepare_id] + amount + action + sign_time).
 */
export interface ClickRequest {
  click_trans_id: string;
  service_id: string;
  click_paydoc_id?: string;
  merchant_trans_id: string;
  merchant_prepare_id?: string;
  amount: string;
  action: string;
  error: string;
  error_note?: string;
  sign_time: string;
  sign_string: string;
}

const ERR = {
  OK: [0, 'Success'],
  SIGN: [-1, 'SIGN CHECK FAILED!'],
  AMOUNT: [-2, 'Incorrect parameter amount'],
  ACTION: [-3, 'Action not found'],
  ALREADY_PAID: [-4, 'Already paid'],
  NOT_FOUND: [-5, 'User does not exist'],
  TX_NOT_FOUND: [-6, 'Transaction does not exist'],
  BAD_REQUEST: [-8, 'Error in request from click'],
  CANCELLED: [-9, 'Transaction cancelled'],
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ClickService {
  private readonly log = new Logger('Click');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly seats: SeatsService,
  ) {}

  sign(r: ClickRequest, withPrepare: boolean): string {
    const parts = [r.click_trans_id, r.service_id, this.env.CLICK_SECRET_KEY, r.merchant_trans_id];
    if (withPrepare) parts.push(r.merchant_prepare_id ?? '');
    parts.push(r.amount, r.action, r.sign_time);
    return createHash('md5').update(parts.join('')).digest('hex');
  }

  private verify(r: ClickRequest, withPrepare: boolean): boolean {
    if (typeof r.sign_string !== 'string' || r.sign_string.length !== 32) return false;
    return timingSafeEqual(Buffer.from(this.sign(r, withPrepare)), Buffer.from(r.sign_string.toLowerCase()));
  }

  private reply(r: Partial<ClickRequest>, err: readonly [number, string], extra: Record<string, unknown> = {}) {
    return {
      click_trans_id: Number(r.click_trans_id) || 0,
      merchant_trans_id: r.merchant_trans_id ?? '',
      ...extra,
      error: err[0],
      error_note: err[1],
    };
  }

  private async logEvent(r: ClickRequest, valid: boolean) {
    await this.db.execute(
      sql`INSERT INTO payment_events (provider, provider_event_id, event_type, payload, signature_valid, processed_at)
          VALUES ('click', ${`${r.click_trans_id}:${r.action}:${r.sign_time}`}, ${r.action === '0' ? 'prepare' : 'complete'},
                  ${JSON.stringify(r)}::jsonb, ${valid}, now())
          ON CONFLICT (provider, provider_event_id) DO NOTHING`,
    );
  }

  async prepare(r: ClickRequest) {
    try {
      const valid = this.verify(r, false);
      await this.logEvent(r, valid);
      if (!valid) return this.reply(r, ERR.SIGN);
      if (r.action !== '0') return this.reply(r, ERR.ACTION);
      if (r.service_id !== this.env.CLICK_SERVICE_ID) return this.reply(r, ERR.BAD_REQUEST);
      if (!UUID_RE.test(r.merchant_trans_id)) return this.reply(r, ERR.NOT_FOUND);
      const amount = majorStringToMinor(r.amount);

      return await this.db.transaction(async (tx) => {
        const b = await this.seats.lockBooking(tx, r.merchant_trans_id);
        if (!b) return this.reply(r, ERR.NOT_FOUND);
        if (b.status === 'confirmed') return this.reply(r, ERR.ALREADY_PAID);
        if (b.total_amount !== amount) return this.reply(r, ERR.AMOUNT);
        const payable = await this.seats.ensurePayable(tx, b);
        if (payable !== 'ok') return this.reply(r, ERR.CANCELLED);

        const state = { click_paydoc_id: r.click_paydoc_id ?? null, prepared_at: Date.now() };
        const updated = await one<{ id: string }>(
          tx,
          sql`UPDATE payments SET provider_transaction_id = ${r.click_trans_id}, status = 'pending',
                     provider_state = ${JSON.stringify(state)}::jsonb
              WHERE id = (SELECT id FROM payments WHERE booking_id = ${b.id} AND provider = 'click'
                          AND (provider_transaction_id IS NULL OR provider_transaction_id = ${r.click_trans_id})
                          AND status IN ('created', 'pending') ORDER BY created_at LIMIT 1)
              RETURNING id`,
        );
        if (!updated) {
          await tx.execute(
            sql`INSERT INTO payments (booking_id, user_id, provider, amount, currency, status, provider_transaction_id, provider_state)
                VALUES (${b.id}, ${b.user_id}, 'click', ${amount}, ${b.currency}, 'pending', ${r.click_trans_id}, ${JSON.stringify(state)}::jsonb)`,
          );
        }
        await this.seats.extendHold(tx, b.id);
        // merchant_prepare_id: Click'ning noyob click_trans_id'si (Complete'da shu bo'yicha topamiz)
        return this.reply(r, ERR.OK, { merchant_prepare_id: Number(r.click_trans_id) });
      });
    } catch (err) {
      this.log.error(err);
      return this.reply(r, ERR.BAD_REQUEST);
    }
  }

  async complete(r: ClickRequest) {
    try {
      const valid = this.verify(r, true);
      await this.logEvent(r, valid);
      if (!valid) return this.reply(r, ERR.SIGN);
      if (r.action !== '1') return this.reply(r, ERR.ACTION);

      return await this.db.transaction(async (tx) => {
        const pay = await one<{ id: string; booking_id: string; amount: number; status: string }>(
          tx,
          sql`SELECT id, booking_id, amount, status FROM payments
              WHERE provider = 'click' AND provider_transaction_id = ${r.click_trans_id} FOR UPDATE`,
        );
        if (!pay || String(r.merchant_prepare_id) !== r.click_trans_id) return this.reply(r, ERR.TX_NOT_FOUND);
        const extra = { merchant_confirm_id: Number(r.click_trans_id) };
        if (pay.status === 'succeeded') return this.reply(r, ERR.ALREADY_PAID, extra);
        if (pay.status === 'cancelled') return this.reply(r, ERR.CANCELLED, extra);
        if (majorStringToMinor(r.amount) !== pay.amount) return this.reply(r, ERR.AMOUNT, extra);

        // Click tomonda xato (masalan, kartada mablag' yo'q) -> to'lov bekor, hold ozod
        if (Number(r.error) < 0) {
          await tx.execute(sql`UPDATE payments SET status = 'cancelled', cancelled_at = now(), failure_code = ${r.error} WHERE id = ${pay.id}`);
          await this.seats.release(tx, pay.booking_id, 'cancelled', 'payment_cancelled', undefined, { onlyPending: true });
          return this.reply(r, ERR.CANCELLED, extra);
        }

        const outcome = await this.seats.confirmPaid(tx, pay.booking_id);
        if (outcome === 'already_confirmed') {
          await tx.execute(sql`UPDATE payments SET status = 'cancelled', cancelled_at = now() WHERE id = ${pay.id}`);
          return this.reply(r, ERR.ALREADY_PAID, extra);
        }
        if (outcome === 'no_seat' || outcome === 'not_payable') {
          // Joy yo'q -> Click to'lovni bekor qiladi (pul yechilmaydi / qaytariladi)
          await tx.execute(sql`UPDATE payments SET status = 'cancelled', cancelled_at = now() WHERE id = ${pay.id}`);
          return this.reply(r, ERR.CANCELLED, extra);
        }
        await tx.execute(sql`UPDATE payments SET status = 'succeeded', succeeded_at = now() WHERE id = ${pay.id}`);
        await emit(tx, 'payment', pay.id, 'PaymentSucceeded', { provider: 'click', booking_id: pay.booking_id, amount: pay.amount });
        return this.reply(r, ERR.OK, extra);
      });
    } catch (err) {
      this.log.error(err);
      return this.reply(r, ERR.BAD_REQUEST);
    }
  }
}
