import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { emit } from '../common/outbox';
import { SeatsService } from '../commerce/seats.service';
import { DB, type Db, one, rows, type Tx } from '../db/db';
import { MulticardClient, type MulticardPayment, type MulticardStatus } from './multicard.client';

/**
 * Rahmat (Multicard) to'lov sahifasi (docs.multicard.uz, "Оплата на платежной странице Multicard"):
 *   1) booking yaratilganda biz invoys yaratamiz (BookingsService.openInvoice) — o'yinchi `checkout_url` da to'laydi;
 *   2) pul yechilgach Multicard callback yuboradi (`POST /v1/webhooks/multicard`, IP 195.158.26.90):
 *      `sign = md5(store_id + invoice_id + amount + secret)`. Javob — HTTP 200 va `{success: true}`; boshqa javob
 *      (yoki `success != true`) bo'lsa Multicard to'lovni bekor qiladi va pulni qaytaradi — joy qolmagan kech to'lovda
 *      shuni ishlatamiz (Uzum `confirm` dagi FAILED kabi). Timeout yoki 500 da tranzaksiya "muzlaydi" va callback
 *      qayta yuboriladi — shuning uchun o'sha `uuid` bilan takroriy callback idempotent `success: true`.
 *   3) callback kelmasa (yoki hold tugasa) — `multicard-sync` job'i invoys holatini so'raydi, kerak bo'lsa bekor qiladi.
 */

/** payments.provider_state (Multicard). `status` — oxirgi ma'lum Multicard holati; `cancelled` — invoys bekor/yopilgan. */
export interface MulticardState {
  invoice_uuid: string;
  status: MulticardStatus | 'cancelled';
  lang?: 'uz' | 'ru' | 'en';
  ttl?: number;
  created_time?: number;
  /** Callback'dagi tranzaksiya uuid'i (refund shu bilan). */
  payment_uuid?: string;
  ps?: string | null;
  card_pan?: string | null;
  receipt_url?: string | null;
  payment_time?: string | null;
  billing_id?: string | null;
  confirm_time?: number;
  checked_time?: number;
  cancel_time?: number;
  failure?: string;
}

export interface MulticardReply {
  status: 200 | 403 | 500;
  body: { success: boolean; message?: string };
}

interface PaymentRow {
  id: string;
  booking_id: string;
  amount: number;
  currency: string;
  status: string;
  provider_transaction_id: string | null;
  provider_state: MulticardState;
}

type Msg = { uz: string; ru: string; en: string };
/** To'lov sahifasida o'yinchiga ko'rsatiladigan sabablar (`message`). */
const MSG = {
  NOT_FOUND: { uz: 'Buyurtma topilmadi', ru: 'Заказ не найден', en: 'Order not found' },
  AMOUNT: { uz: "Summa noto'g'ri", ru: 'Неверная сумма', en: 'Incorrect amount' },
  ALREADY_PAID: { uz: "Buyurtma allaqachon to'langan", ru: 'Заказ уже оплачен', en: 'Order already paid' },
  NO_SEATS: { uz: "O'yinda joy qolmadi", ru: 'Мест не осталось', en: 'No seats left' },
  NOT_PAYABLE: { uz: "Buyurtmani to'lab bo'lmaydi", ru: 'Заказ недоступен для оплаты', en: 'Booking is not payable' },
} satisfies Record<string, Msg>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Callback summasi butun tiyin: "50000", "50000.0", "50000.00" (imzo butun ko'rinish bo'yicha). */
const AMOUNT_RE = /^(\d{1,15})(?:\.0+)?$/;

/** `multicard-sync`: oxirgi tekshiruvdan shuncha soniya o'tgan pending to'lovlar so'raladi (callback'ga vaqt). */
export const MULTICARD_SYNC_AFTER_S = 120;
const SYNC_BATCH = 20;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v.slice(0, 255) : null);

/** Callback imzosi: md5(store_id + invoice_id + amount + secret), summa butun ko'rinishda. */
export function multicardSign(storeId: string | number, invoiceId: string, amount: string | number, secret: string): string {
  const a = String(amount).replace(/\.0+$/, '');
  return createHash('md5').update(`${storeId}${invoiceId}${a}${secret}`).digest('hex');
}

/** payment_events'ga yoziladigan payload: telefon maskalanadi, karta tokeni yozilmaydi. */
function redact(body: Record<string, unknown>): Record<string, unknown> {
  const { card_token: _token, ...rest } = body;
  if (typeof rest.phone === 'string') rest.phone = rest.phone.replace(/^(\d{3})\d+(\d{4})$/, '$1*****$2');
  return rest;
}

@Injectable()
export class MulticardService {
  private readonly log = new Logger('Multicard');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly seats: SeatsService,
    private readonly client: MulticardClient,
  ) {}

  // ---------------------------------------------------------------------------
  // Callback (success)
  // ---------------------------------------------------------------------------
  async callback(raw: unknown): Promise<MulticardReply> {
    const body = isObject(raw) ? raw : {};
    const ctx: { paymentId?: string } = {};
    let eventId: string | undefined;
    let reply: MulticardReply;
    try {
      const valid = this.verify(body);
      eventId = await this.logEvent(body, valid);
      reply = valid ? await this.settleCallback(body, ctx) : { status: 403, body: { success: false, message: 'Invalid sign' } };
    } catch (err) {
      // Kutilmagan xato (DB va h.k.): 500 — Multicard tranzaksiyani muzlatadi va callback'ni qayta yuboradi
      this.log.error(err);
      reply = { status: 500, body: { success: false } };
    }
    if (eventId) await this.finishEvent(eventId, reply, ctx.paymentId).catch((e: unknown) => this.log.error(e));
    return reply;
  }

  /** Imzo constant-time solishtiriladi; secret sozlanmagan bo'lsa hech qaysi callback qabul qilinmaydi. */
  verify(body: Record<string, unknown>): boolean {
    const secret = this.env.MULTICARD_SECRET;
    const sign = typeof body.sign === 'string' ? body.sign.toLowerCase() : '';
    if (!secret || sign.length !== 32) return false;
    const fields = [body.store_id, body.invoice_id, body.amount];
    if (fields.some((v) => typeof v !== 'string' && typeof v !== 'number')) return false;
    const expected = Buffer.from(multicardSign(String(body.store_id), String(body.invoice_id), String(body.amount), secret));
    const actual = Buffer.from(sign);
    // Uzunlik baytlarda: ASCII bo'lmagan belgilar bilan 32 "belgi" — exception (500) emas, 403
    return actual.length === expected.length && timingSafeEqual(expected, actual);
  }

  private async logEvent(body: Record<string, unknown>, valid: boolean): Promise<string> {
    const uuid = typeof body.uuid === 'string' ? body.uuid.slice(0, 64) : '-';
    const row = await one<{ id: string }>(
      this.db,
      sql`INSERT INTO payment_events (provider, provider_event_id, event_type, payload, signature_valid)
          VALUES ('multicard', ${`callback:${uuid}:${randomUUID()}`}, 'callback', ${JSON.stringify(redact(body))}::jsonb, ${valid})
          RETURNING id`,
    );
    return row!.id;
  }

  private async finishEvent(eventId: string, reply: MulticardReply, paymentId: string | undefined) {
    const error = reply.body.success ? null : (reply.body.message ?? `HTTP ${reply.status}`);
    await this.db.execute(
      sql`UPDATE payment_events SET processed_at = now(), payment_id = ${paymentId ?? null}, processing_error = ${error}
          WHERE id = ${eventId}`,
    );
  }

  private async settleCallback(body: Record<string, unknown>, ctx: { paymentId?: string }): Promise<MulticardReply> {
    const refuse = (m: Msg, lang?: string) => ({ status: 200 as const, body: { success: false, message: lang === 'ru' ? m.ru : lang === 'en' ? m.en : m.uz } });
    if (String(body.store_id) !== String(this.env.MULTICARD_STORE_ID)) return refuse(MSG.NOT_FOUND);
    const invoiceId = String(body.invoice_id);
    if (!UUID_RE.test(invoiceId)) return refuse(MSG.NOT_FOUND);
    const amountMatch = AMOUNT_RE.exec(String(body.amount));
    const uuid = str(body.uuid);
    if (!amountMatch || !uuid) return refuse(MSG.AMOUNT);
    const amount = Number(amountMatch[1]);

    return this.db.transaction(async (tx) => {
      const pay = await this.lockPayment(tx, invoiceId);
      if (!pay) return refuse(MSG.NOT_FOUND);
      ctx.paymentId = pay.id;
      const lang = pay.provider_state.lang;
      if (amount !== pay.amount) return refuse(MSG.AMOUNT, lang);
      const paid: MulticardPayment = {
        uuid,
        status: 'success',
        ps: str(body.ps),
        card_pan: str(body.card_pan),
        receipt_url: str(body.receipt_url),
        payment_time: str(body.payment_time),
      };
      const outcome = await this.settle(tx, pay, paid, { billing_id: str(body.billing_id) });
      if (outcome === 'confirmed' || outcome === 'duplicate') return { status: 200 as const, body: { success: true } };
      // Pul yechilgan, lekin xizmat berilmaydi: `success: false` — Multicard to'lovni bekor qilib pulni qaytaradi
      return refuse(outcome === 'already_paid' ? MSG.ALREADY_PAID : outcome === 'no_seat' ? MSG.NO_SEATS : MSG.NOT_PAYABLE, lang);
    });
  }

  private lockPayment(tx: Tx, paymentId: string): Promise<PaymentRow | undefined> {
    return one<PaymentRow>(
      tx,
      sql`SELECT id, booking_id, amount, currency, status, provider_transaction_id, provider_state FROM payments
          WHERE id = ${paymentId} AND provider = 'multicard' FOR UPDATE`,
    );
  }

  /**
   * Multicard'da muvaffaqiyatli to'lov -> booking tasdiqlanadi (kerak bo'lsa qayta hold — kech to'lov). Natija:
   *   confirmed / duplicate (o'sha tranzaksiya allaqachon hisobga olingan) — to'lov `succeeded`;
   *   already_paid / no_seat / not_payable — to'lov `cancelled`, hold ozod: callback'da `success: false` (pulni
   *   Multicard qaytaradi), sync'da — Multicard to'lovni yakunlagan, refund navbatga (`late_payment_no_seat`).
   */
  private async settle(
    tx: Tx,
    pay: PaymentRow,
    paid: MulticardPayment,
    extra: Partial<MulticardState> = {},
  ): Promise<'confirmed' | 'duplicate' | 'already_paid' | 'no_seat' | 'not_payable'> {
    const st = pay.provider_state;
    if (['succeeded', 'partially_refunded', 'refunded'].includes(pay.status)) {
      return st.payment_uuid === paid.uuid ? 'duplicate' : 'already_paid';
    }
    // O'sha tranzaksiya avval rad etilgan (javob yo'qolib callback qayta kelgan) — Multicard pulni qaytargan: yana rad
    if (pay.status === 'cancelled' && st.payment_uuid === paid.uuid && st.failure) {
      return st.failure === 'already_paid' || st.failure === 'no_seat' ? st.failure : 'not_payable';
    }
    const outcome = await this.seats.confirmPaid(tx, pay.booking_id);
    const next: MulticardState = {
      ...st,
      ...extra,
      status: 'success',
      payment_uuid: paid.uuid,
      ps: paid.ps ?? st.ps ?? null,
      card_pan: paid.card_pan ?? st.card_pan ?? null,
      receipt_url: paid.receipt_url ?? st.receipt_url ?? null,
      payment_time: paid.payment_time ?? st.payment_time ?? null,
    };
    // Refund va reconciliation tranzaksiya uuid'i bilan ishlaydi (invoys uuid'i provider_state.invoice_uuid'da qoladi)
    if (outcome !== 'confirmed') {
      const failure = outcome === 'already_confirmed' ? 'already_paid' : outcome;
      await this.saveState(tx, pay.id, { ...next, failure, cancel_time: Date.now() }, 'cancelled', failure, paid.uuid);
      await this.seats.release(tx, pay.booking_id, 'cancelled', 'payment_cancelled', undefined, { onlyPending: true });
      return failure;
    }
    await this.saveState(tx, pay.id, { ...next, confirm_time: Date.now() }, 'succeeded', null, paid.uuid);
    await emit(tx, 'payment', pay.id, 'PaymentSucceeded', { provider: 'multicard', booking_id: pay.booking_id, amount: pay.amount });
    return 'confirmed';
  }

  private async saveState(
    tx: Tx,
    paymentId: string,
    st: MulticardState,
    status: 'pending' | 'succeeded' | 'cancelled',
    failure: string | null = null,
    transactionId?: string,
  ) {
    await tx.execute(
      sql`UPDATE payments SET provider_state = ${JSON.stringify(st)}::jsonb, status = ${status}::payment_status, updated_at = now(),
                 provider_transaction_id = coalesce(${transactionId ?? null}, provider_transaction_id),
                 succeeded_at = CASE WHEN ${status} = 'succeeded' THEN now() ELSE succeeded_at END,
                 cancelled_at = CASE WHEN ${status} = 'cancelled' THEN now() ELSE cancelled_at END,
                 failure_code = ${failure}
          WHERE id = ${paymentId}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Holatni so'rash (callback kelmasa) va hold tugaganda invoysni bekor qilish
  // ---------------------------------------------------------------------------
  /**
   * `multicard-sync` (har daqiqa): pending to'lovlar — booking endi to'lanmaydigan bo'lsa (hold tugagan, bekor
   * qilingan) darhol, aks holda oxirgi tekshiruvdan MULTICARD_SYNC_AFTER_S o'tgach.
   */
  async sync(): Promise<{ checked: number; confirmed: number; cancelled: number; late_refunds: number }> {
    const stats = { checked: 0, confirmed: 0, cancelled: 0, late_refunds: 0 };
    if (!this.client.configured) return stats;
    const due = await rows<{ id: string }>(
      this.db,
      sql`SELECT p.id FROM payments p JOIN bookings b ON b.id = p.booking_id
          WHERE p.provider = 'multicard' AND p.status = 'pending' AND p.provider_state ? 'invoice_uuid'
            AND (b.status <> 'pending_payment' OR b.expires_at <= now()
                 OR p.updated_at < now() - make_interval(secs => ${MULTICARD_SYNC_AFTER_S}))
          ORDER BY p.updated_at, p.id
          LIMIT ${SYNC_BATCH}`,
    );
    for (const { id } of due) {
      try {
        const r = await this.syncOne(id);
        stats.checked++;
        if (r === 'confirmed') stats.confirmed++;
        else if (r === 'cancelled') stats.cancelled++;
        else if (r === 'late_refund') stats.late_refunds++;
      } catch (err) {
        this.log.warn(`multicard sync ${id}: ${(err as Error).message}`);
        await this.touch(id, {}).catch(() => undefined);
      }
    }
    return stats;
  }

  /** Bitta pending to'lov: Multicard'dagi invoys holati -> tasdiqlash / bekor qilish / kutish. */
  async syncOne(paymentId: string): Promise<'confirmed' | 'cancelled' | 'late_refund' | 'waiting' | null> {
    const pay = await one<PaymentRow & { payable: boolean }>(
      this.db,
      sql`SELECT p.id, p.booking_id, p.amount, p.currency, p.status, p.provider_transaction_id, p.provider_state,
                 (b.status = 'pending_payment' AND b.expires_at > now()) AS payable
          FROM payments p JOIN bookings b ON b.id = p.booking_id
          WHERE p.id = ${paymentId} AND p.provider = 'multicard' AND p.status = 'pending'`,
    );
    if (!pay?.provider_state.invoice_uuid) return null;
    const invoiceUuid = pay.provider_state.invoice_uuid;

    const inv = await this.client.invoice(invoiceUuid);
    if (!inv.ok) {
      // 404 yoki ERROR_TRANS_NOT_READY ("Инвойс отменен (истек)") — invoys yopilgan, pul yechilmagan
      if (inv.status === 404 || inv.code === 'ERROR_NOT_FOUND' || inv.code === 'ERROR_TRANS_NOT_READY') {
        return (await this.close(pay.id, 'invoice_closed')) ? 'cancelled' : null;
      }
      throw new Error(`invoys holati: ${inv.code} ${inv.details}`);
    }
    const p = inv.data.payment ?? null;
    const status = p?.status ?? 'draft';

    if (status === 'success' && p) {
      // Callback kelmagan (yoki yetib bormagan), lekin Multicard to'lovni yakunlagan
      return this.db.transaction(async (tx) => {
        const cur = await this.lockPayment(tx, pay.id);
        if (!cur || cur.status !== 'pending') return null;
        if (p.total_amount !== undefined && p.total_amount !== cur.amount) {
          this.log.error(`multicard ${cur.id}: summa farqi (bizda ${cur.amount}, Multicard ${p.total_amount}) — tasdiqlanmadi`);
          await this.touchTx(tx, cur, { status, failure: 'amount_mismatch' });
          return 'waiting';
        }
        const outcome = await this.settle(tx, cur, p);
        if (outcome === 'confirmed' || outcome === 'duplicate') return 'confirmed';
        await this.lateRefund(tx, cur, outcome);
        return 'late_refund';
      });
    }
    if (status === 'revert') return (await this.close(pay.id, 'reverted', 'revert')) ? 'cancelled' : null;
    // billing — Multicard callback'ni yubormoqda (yoki muzlatilgan, qayta yuboradi): kutamiz
    if (status === 'billing' || pay.payable) {
      await this.touch(pay.id, { status });
      return 'waiting';
    }
    // Hold tugagan yoki booking bekor qilingan, pul yechilmagan — invoysni bekor qilamiz. Rad etilsa (shu orada
    // to'langan) — keyingi tekshiruvda callback yoki `success` holati hal qiladi.
    const cancelled = await this.client.cancelInvoice(invoiceUuid);
    if (!cancelled.ok) {
      await this.touch(pay.id, { status });
      return 'waiting';
    }
    return (await this.close(pay.id, 'hold_expired')) ? 'cancelled' : null;
  }

  /** To'lov yechilmay yopildi: `cancelled`, hold ozod (boshqa usul bilan tasdiqlangan booking'ga tegilmaydi). */
  private async close(paymentId: string, reason: string, status: MulticardState['status'] = 'cancelled'): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const pay = await this.lockPayment(tx, paymentId);
      if (!pay || pay.status !== 'pending') return false;
      await this.saveState(tx, pay.id, { ...pay.provider_state, status, failure: reason, cancel_time: Date.now() }, 'cancelled', reason);
      await this.seats.release(tx, pay.booking_id, 'cancelled', 'payment_cancelled', undefined, { onlyPending: true });
      return true;
    });
  }

  /**
   * Multicard yakunlagan, lekin xizmat berilmaydigan to'lov (callback yo'qolgan, joy qolmagan): to'lov `succeeded`
   * (pul bizda) va to'liq `original_method` refund'i — avto-refund job'i Multicard'da qaytaradi (yoki admin navbati).
   * Booking boshqa to'lov bilan tasdiqlangan bo'lsa to'lov `cancelled` qoladi (bitta booking'da ikkinchi `succeeded`
   * bo'lmaydi) — refund admin navbatiga tushadi.
   */
  private async lateRefund(tx: Tx, pay: PaymentRow, outcome: string) {
    if (outcome !== 'already_paid') {
      await tx.execute(
        sql`UPDATE payments SET status = 'succeeded', succeeded_at = now(), cancelled_at = NULL, updated_at = now(), failure_code = ${outcome}
            WHERE id = ${pay.id}`,
      );
    }
    const refund = await one<{ id: string }>(
      tx,
      sql`INSERT INTO refunds (payment_id, booking_id, amount, currency, destination, status, reason)
          VALUES (${pay.id}, ${pay.booking_id}, ${pay.amount}, ${pay.currency}, 'original_method', 'pending', 'late_payment_no_seat')
          RETURNING id`,
    );
    await emit(tx, 'refund', refund!.id, 'RefundRequested', { booking_id: pay.booking_id, payment_id: pay.id, amount: pay.amount });
  }

  private async touch(paymentId: string, patch: Partial<MulticardState>) {
    await this.db.execute(
      sql`UPDATE payments SET updated_at = now(),
                 provider_state = provider_state || ${JSON.stringify({ ...patch, checked_time: Date.now() })}::jsonb
          WHERE id = ${paymentId} AND status = 'pending'`,
    );
  }

  private async touchTx(tx: Tx, pay: PaymentRow, patch: Partial<MulticardState>) {
    await this.saveState(tx, pay.id, { ...pay.provider_state, ...patch, checked_time: Date.now() }, 'pending', patch.failure ?? null);
  }
}

/** `multicard-sync` job'i (har daqiqa) — o'z navbatida: tashqi API kutishi maintenance job'larini to'smaydi. */
@Injectable()
export class MulticardJobs implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MulticardJobs');
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly multicard: MulticardService,
  ) {}

  async onModuleInit() {
    if (!this.env.RUN_WORKERS) return;
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue('multicard', { connection: this.connection });
    await this.queue.upsertJobScheduler(
      'multicard-sync',
      { every: 60_000 },
      { name: 'multicard-sync', opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );
    this.worker = new Worker('multicard', () => this.multicard.sync(), { connection: this.connection, concurrency: 1 });
    this.worker.on('failed', (job, err) => this.log.error(`${job?.name} xato: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }
}

