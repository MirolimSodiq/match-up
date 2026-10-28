import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SeatsService } from '../src/commerce/seats.service';
import { AutoRefunds } from '../src/payments/auto-refunds';
import { formatTashkentTime } from '../src/payments/multicard.client';
import { MulticardService, multicardSign } from '../src/payments/multicard.service';
import { ReconciliationService } from '../src/payments/reconciliation.service';
import { createTestApp, login, q, uuid, type Session, type TestCtx } from './helpers';

const APP_ID = 'e2e-mc-app';
const SECRET = 'e2e-mc-secret';
const STORE_ID = 6;
const MXIK = '10305008002000000';
const PACKAGE = '1501313';
const PRICE = 4000000;

const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');

/** Stub Multicard'dagi invoys: to'langanda tranzaksiya uuid'i invoysnikidan farq qiladi (ikkalasi ham saqlanishini tekshirish uchun). */
interface StubInvoice {
  uuid: string;
  body: Record<string, any>;
  cancelled: boolean;
  payment: { uuid: string; status: string; ps: string; total_amount: number } | null;
}

/**
 * Rahmat (Multicard) — C9: invoys (server-to-server), imzoli callback, takroriy va noto'g'ri callback, kech to'lov,
 * holatni so'rash job'i, to'liq va qisman refund, reconciliation. Multicard — lokal stub HTTP server.
 */
describe('Rahmat (Multicard): invoys, callback, sync, refund, reconciliation (C9)', () => {
  let ctx: TestCtx;
  let admin: Session;
  let pitch: string;
  let server: Server;
  const savedEnv = { ...process.env };

  // --- Stub holati ---
  const tokens = new Set<string>();
  let authCalls = 0;
  const calls: { method: string; path: string; auth: string; body: any }[] = [];
  const invoices = new Map<string, StubInvoice>();
  /** POST /payment/invoice rejimi. */
  let invoiceMode: 'ok' | 'http500' | 'reject' = 'ok';
  /** GET /payment/invoice/{uuid} ni majburlash (masalan, "invoys yopilgan"). */
  const invoiceReply = new Map<string, { status: number; body: unknown }>();
  /** DELETE /payment/{uuid} rejimi. */
  let refundMode: 'ok' | 'reject' = 'ok';
  const extraHistory: Record<string, unknown>[] = [];

  const mc = () => ctx.app.get(MulticardService);
  const auto = () => ctx.app.get(AutoRefunds);
  const invoiceOf = (paymentId: string) => [...invoices.values()].find((i) => i.body.invoice_id === paymentId)!;
  const paymentOf = async (bookingId: string) =>
    (await q(ctx, "SELECT * FROM payments WHERE booking_id = $1 AND provider = 'multicard' ORDER BY created_at DESC", [bookingId]))[0]!;
  const bookingStatus = async (id: string) => (await q(ctx, 'SELECT status FROM bookings WHERE id = $1', [id]))[0]!.status;
  const slots = async (mId: string) =>
    (await q<{ held_slots: number; confirmed_slots: number }>(ctx, 'SELECT held_slots, confirmed_slots FROM matches WHERE id = $1', [mId]))[0]!;

  function send(res: ServerResponse, status: number, body: unknown) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  }

  function stub(req: IncomingMessage, res: ServerResponse, raw: string) {
    const url = new URL(req.url ?? '/', 'http://stub');
    const path = url.pathname;
    const body = raw ? JSON.parse(raw) : null;
    if (path === '/auth' && req.method === 'POST') {
      authCalls++;
      if (body?.application_id !== APP_ID || body?.secret !== SECRET) return send(res, 400, { errors: [{ message: [{ message: 'Invalid Credentials' }] }] });
      const token = `tok-${randomUUID()}`;
      tokens.add(token);
      return send(res, 200, { token, role: 'dev', expiry: formatTashkentTime(new Date(Date.now() + 24 * 3600_000)) });
    }
    const auth = String(req.headers.authorization ?? '');
    calls.push({ method: req.method ?? '', path: `${path}${url.search}`, auth, body });
    if (!tokens.has(auth.replace(/^Bearer /, ''))) return send(res, 401, { success: false, error: { code: 'ERROR_AUTH', details: 'Unauthorized' } });

    if (path === '/payment/invoice' && req.method === 'POST') {
      if (invoiceMode === 'http500') return send(res, 502, { message: 'Bad gateway' });
      if (invoiceMode === 'reject') return send(res, 400, { success: false, error: { code: 'ERROR_FIELDS', details: 'Invalid store_id' } });
      const inv: StubInvoice = { uuid: randomUUID(), body, cancelled: false, payment: null };
      invoices.set(inv.uuid, inv);
      return send(res, 200, {
        success: true,
        data: {
          uuid: inv.uuid,
          store_id: body.store_id,
          amount: body.amount,
          invoice_id: body.invoice_id,
          checkout_url: `https://checkout.multicard.example/invoice/${inv.uuid}`,
          short_link: 'https://l.multicard.example/x',
          deeplink: null,
          payment: null,
        },
      });
    }
    let m = /^\/payment\/invoice\/([^/]+)$/.exec(path);
    if (m) {
      const forced = invoiceReply.get(m[1]!);
      if (forced && req.method === 'GET') return send(res, forced.status, forced.body);
      const inv = invoices.get(m[1]!);
      if (!inv) return send(res, 404, { success: false, error: { code: 'ERROR_NOT_FOUND', details: 'Объект не найден' } });
      if (req.method === 'DELETE') {
        if (inv.payment?.status === 'success') {
          return send(res, 400, { success: false, error: { code: 'ERROR_TRANS_NOT_READY', details: 'Транзакция завершена или не готова' } });
        }
        inv.cancelled = true;
        return send(res, 200, { success: true, data: null });
      }
      if (inv.cancelled) return send(res, 400, { success: false, error: { code: 'ERROR_TRANS_NOT_READY', details: 'Транзакция завершена или не готова' } });
      return send(res, 200, { success: true, data: { uuid: inv.uuid, invoice_id: inv.body.invoice_id, amount: inv.body.amount, checkout_url: 'x', payment: inv.payment } });
    }
    m = /^\/payment\/([^/]+)(\/partial)?$/.exec(path);
    if (m && req.method === 'DELETE') {
      const inv = [...invoices.values()].find((i) => i.payment?.uuid === m![1]);
      if (refundMode === 'reject' || !inv?.payment) return send(res, 404, { success: false, error: { code: 'ERROR_NOT_FOUND', details: 'Объект не найден' } });
      if (!m[2]) inv.payment.status = 'revert';
      return send(res, 200, { success: true, data: { ...inv.payment } });
    }
    m = /^\/payment\/store\/(\d+)\/history$/.exec(path);
    if (m && req.method === 'GET') {
      const list = [
        ...[...invoices.values()].map((i) => ({
          uuid: i.payment?.uuid ?? i.uuid,
          status: i.payment?.status ?? (i.cancelled ? 'error' : 'draft'),
          ps: i.payment?.ps ?? null,
          store_invoice_id: i.body.invoice_id,
          payment_amount: i.body.amount,
          added_on: formatTashkentTime(new Date()),
        })),
        ...extraHistory,
      ];
      return send(res, 200, { success: true, data: { pagination: { total: list.length, offset: 0, limit: 100 }, stat: [], list } });
    }
    send(res, 404, { success: false, error: { code: 'ERROR_NOT_FOUND', details: path } });
  }

  // --- Yordamchilar ---
  let slot = 0;
  async function createMatch(opts: { policy?: string; maxPlayers?: number } = {}): Promise<string> {
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitch,
        sport: 'football',
        starts_at: inMinutes(75 * 24 * 60 + ++slot * 120),
        duration_min: 60,
        format: '5v5',
        players_per_side: 5,
        min_players: 2,
        max_players: opts.maxPlayers ?? 10,
        price: { amount: PRICE, currency: 'UZS' },
        lease_cost: { amount: 20000000, currency: 'UZS' },
        cancellation_policy_code: opts.policy ?? 'standard',
      });
    if (c.status !== 201) throw new Error(JSON.stringify(c.body));
    await ctx.http().post(`/v1/admin/matches/${c.body.id}/publish`).set(admin.auth).expect(200);
    return c.body.id;
  }

  let phoneSeq = 0;
  async function player(mId: string): Promise<Session> {
    const s = await login(ctx, `+99893760${String(++phoneSeq).padStart(4, '0')}`);
    const tpl = (await ctx.http().get(`/v1/waivers/required?match_id=${mId}`).set(s.auth).expect(200)).body.template;
    await ctx
      .http()
      .post(`/v1/waivers/${tpl.id}/signatures`)
      .set(s.auth)
      .send({ accepted: true, method: 'clickwrap', document_sha256: tpl.document_sha256, match_id: mId })
      .expect(201);
    return s;
  }

  async function book(s: Session, mId: string, key = uuid(), expected = 201) {
    const sig = (await ctx.http().get(`/v1/waivers/required?match_id=${mId}`).set(s.auth).expect(200)).body.signature_id;
    const r = await ctx
      .http()
      .post('/v1/bookings')
      .set(s.auth)
      .set('Accept-Language', 'ru')
      .set('Idempotency-Key', key)
      .send({ match_id: mId, payment_method: 'multicard', waiver_signature_id: sig, return_url: 'matchup://booking/return' });
    expect(r.status).toBe(expected);
    return r.body;
  }

  /** Multicard to'lov sahifasida to'lov: stub invoysni `success` qiladi (callback'ni test o'zi yuboradi). */
  function payAtMulticard(paymentId: string, ps = 'uzcard') {
    const inv = invoiceOf(paymentId);
    inv.payment = { uuid: randomUUID(), status: 'success', ps, total_amount: inv.body.amount };
    return inv;
  }

  function callbackBody(paymentId: string, over: Record<string, unknown> = {}) {
    const inv = invoiceOf(paymentId);
    const b: Record<string, unknown> = {
      store_id: STORE_ID,
      amount: inv.body.amount,
      invoice_id: paymentId,
      billing_id: '20261028242009869794410864028760',
      payment_time: '2026-10-28 14:36:31',
      phone: '998901234567',
      card_pan: '860030******5959',
      ps: inv.payment?.ps ?? 'uzcard',
      card_token: '6225f3c93f7a880142782fa4',
      uuid: inv.payment?.uuid ?? randomUUID(),
      receipt_url: `https://checkout.multicard.example/check/${inv.payment?.uuid}`,
      ...over,
    };
    b.sign ??= multicardSign(String(b.store_id), String(b.invoice_id), String(b.amount), SECRET);
    return b;
  }

  /** Callback; Multicard javobga qarab tranzaksiyani yakunlaydi: `success: true` — success, aks holda bekor (error). */
  async function callback(body: Record<string, unknown>) {
    const r = await ctx.http().post('/v1/webhooks/multicard').send(body);
    const inv = [...invoices.values()].find((i) => i.body.invoice_id === body.invoice_id && i.payment?.uuid === body.uuid);
    if (inv?.payment) inv.payment.status = r.status === 200 && r.body.success === true ? 'success' : 'error';
    return { status: r.status, body: r.body as { success: boolean; message?: string } };
  }

  /** Booking + Multicard'da to'lov + callback -> confirmed. */
  async function paidBooking(mId: string, ps = 'uzcard') {
    const s = await player(mId);
    const { booking } = await book(s, mId);
    const pay = await paymentOf(booking.id);
    const inv = payAtMulticard(pay.id, ps);
    expect(await callback(callbackBody(pay.id))).toEqual({ status: 200, body: { success: true } });
    return { s, bookingId: booking.id as string, paymentId: pay.id as string, inv };
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => stub(req, res, raw));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    Object.assign(process.env, {
      MULTICARD_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
      MULTICARD_APPLICATION_ID: APP_ID,
      MULTICARD_SECRET: SECRET,
      MULTICARD_STORE_ID: String(STORE_ID),
      MULTICARD_REFUND_ENABLED: 'true',
      MULTICARD_PARTIAL_REFUND_ENABLED: 'true',
      FISCAL_MXIK_CODE: MXIK,
      FISCAL_PACKAGE_CODE: PACKAGE,
    });
    ctx = await createTestApp();
    admin = await login(ctx, '+998901110001');
    pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'chilonzor-arena' ORDER BY p.name LIMIT 1"))[0]!.id;
    await q(
      ctx,
      `INSERT INTO cancellation_policies (code, name, rules)
       VALUES ('e2e_half_mc', '{"en": "Half"}', '[{"min_hours_before": 0, "refund_pct": 50, "destination": "original_method"}]')
       ON CONFLICT (code) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await ctx.close();
    await new Promise((r) => server.close(r));
    for (const k of [
      'MULTICARD_BASE_URL',
      'MULTICARD_APPLICATION_ID',
      'MULTICARD_SECRET',
      'MULTICARD_STORE_ID',
      'MULTICARD_REFUND_ENABLED',
      'MULTICARD_PARTIAL_REFUND_ENABLED',
      'FISCAL_MXIK_CODE',
      'FISCAL_PACKAGE_CODE',
    ]) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("to'lov usullarida Rahmat; booking -> invoys (store_id, tiyin, invoice_id = payments.id, ofd, ttl), checkout_url; replay; token keshi", async () => {
    const mId = await createMatch();
    const s = await player(mId);
    const methods = await ctx.http().get(`/v1/payment-methods?match_id=${mId}`).set(s.auth).expect(200);
    expect(methods.body.methods.map((x: { provider: string }) => x.provider)).toEqual(['wallet', 'payme', 'click', 'uzum', 'multicard']);
    expect(methods.body.methods.at(-1).display_name).toBe('Rahmat');

    const key = uuid();
    const { booking, checkout } = await book(s, mId, key);
    const pay = await paymentOf(booking.id);
    const inv = invoiceOf(pay.id);
    expect(inv.body).toEqual({
      store_id: STORE_ID,
      amount: PRICE,
      invoice_id: pay.id,
      callback_url: 'https://api.e2e.matchup.example/v1/webhooks/multicard',
      return_url: 'matchup://booking/return',
      return_error_url: 'matchup://booking/return',
      lang: 'ru',
      ttl: 15 * 60,
      ofd: [{ qty: 1, price: PRICE, total: PRICE, mxik: MXIK, package_code: PACKAGE, name: "Havaskor sport o'yinida ishtirok", vat: 0 }],
    });
    expect(checkout).toMatchObject({ type: 'redirect', provider: 'multicard', url: `https://checkout.multicard.example/invoice/${inv.uuid}` });
    expect(pay).toMatchObject({
      status: 'pending',
      amount: PRICE,
      provider_transaction_id: inv.uuid,
      checkout_url: checkout.url,
      provider_state: { invoice_uuid: inv.uuid, status: 'draft', lang: 'ru', ttl: 900 },
    });
    expect(booking.status).toBe('pending_payment');

    // Takroriy so'rov (o'sha kalit) — o'sha checkout, ikkinchi invoys yo'q
    const again = await book(s, mId, key);
    expect(again.checkout.url).toBe(checkout.url);
    expect([...invoices.values()].filter((i) => i.body.invoice_id === pay.id)).toHaveLength(1);

    // Token Redis'da keshlangan: ikkinchi booking qayta auth qilmaydi; token bekor qilinsa (401) — yangisi va qayta urinish
    expect(authCalls).toBe(1);
    await book(await player(mId), mId);
    expect(authCalls).toBe(1);
    tokens.clear();
    const third = await book(await player(mId), mId);
    expect(third.checkout.provider).toBe('multicard');
    expect(authCalls).toBe(2);
    expect(calls.filter((c) => c.path === '/payment/invoice').every((c) => c.auth.startsWith('Bearer tok-'))).toBe(true);
  });

  it("callback: imzo to'g'ri -> booking confirmed, PaymentSucceeded; takroriy (summa \"…00\") -> success:true, ikkinchi tasdiq yo'q", async () => {
    const mId = await createMatch();
    const { bookingId, paymentId, inv } = await paidBooking(mId);
    expect(await bookingStatus(bookingId)).toBe('confirmed');
    const pay = await paymentOf(bookingId);
    // Refund va reconciliation tranzaksiya uuid'i bilan: provider_transaction_id = callback uuid, invoys uuid'i state'da
    expect(pay).toMatchObject({
      status: 'succeeded',
      provider_transaction_id: inv.payment!.uuid,
      provider_state: { invoice_uuid: inv.uuid, payment_uuid: inv.payment!.uuid, status: 'success', ps: 'uzcard', card_pan: '860030******5959' },
    });
    expect(await slots(mId)).toEqual({ held_slots: 0, confirmed_slots: 1 });

    const dup = await callback(callbackBody(paymentId, { amount: `${PRICE}.00` }));
    expect(dup).toEqual({ status: 200, body: { success: true } });
    const outbox = await q(ctx, "SELECT id FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'PaymentSucceeded'", [paymentId]);
    expect(outbox).toHaveLength(1);
    expect(await slots(mId)).toEqual({ held_slots: 0, confirmed_slots: 1 });

    const events = await q(ctx, "SELECT payload, signature_valid, processed_at, processing_error, payment_id FROM payment_events WHERE provider = 'multicard' AND payment_id = $1", [paymentId]);
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e).toMatchObject({ signature_valid: true, processing_error: null, payment_id: paymentId });
      expect(e.processed_at).not.toBeNull();
      expect(e.payload.phone).toBe('998*****4567');
      expect(e.payload.card_token).toBeUndefined();
    }
  });

  it("noto'g'ri imzo -> 403 (Multicard pulni qaytaradi); summa / invoys / kassa mos emas -> success:false + sabab", async () => {
    const mId = await createMatch();
    const s = await player(mId);
    const { booking } = await book(s, mId);
    const pay = await paymentOf(booking.id);
    payAtMulticard(pay.id);

    const forged = await callback(callbackBody(pay.id, { sign: multicardSign(STORE_ID, pay.id, PRICE, 'wrong-secret') }));
    expect(forged).toEqual({ status: 403, body: { success: false, message: 'Invalid sign' } });
    // Imzo summani ham qamraydi: imzolangandan keyin o'zgartirilgan summa — 403
    const tampered = callbackBody(pay.id);
    tampered.amount = 1;
    expect((await callback(tampered)).status).toBe(403);
    expect((await callback({ ...callbackBody(pay.id), sign: undefined })).status).toBe(403);
    expect((await callback({ ...callbackBody(pay.id), sign: 'я'.repeat(32) })).status).toBe(403);
    const ev = await q(ctx, "SELECT signature_valid, processing_error FROM payment_events WHERE provider = 'multicard' AND payload->>'invoice_id' = $1 ORDER BY received_at", [pay.id]);
    expect(ev.map((e) => [e.signature_valid, e.processing_error])).toEqual(Array(4).fill([false, 'Invalid sign']));

    // To'g'ri imzolangan, lekin summa booking'nikiga teng emas (Accept-Language: ru bilan yaratilgan — sabab ruscha)
    expect(await callback(callbackBody(pay.id, { amount: PRICE - 100 }))).toEqual({ status: 200, body: { success: false, message: 'Неверная сумма' } });
    expect(await callback(callbackBody(pay.id, { invoice_id: randomUUID() }))).toEqual({
      status: 200,
      body: { success: false, message: 'Buyurtma topilmadi' },
    });
    expect((await callback(callbackBody(pay.id, { invoice_id: 'not-a-uuid' }))).body.success).toBe(false);
    expect((await callback(callbackBody(pay.id, { store_id: STORE_ID + 1 }))).body.success).toBe(false);
    expect(await bookingStatus(booking.id)).toBe('pending_payment');
    expect((await paymentOf(booking.id)).status).toBe('pending');

    // Endi haqiqiy callback — qabul qilinadi
    expect((await callback(callbackBody(pay.id))).body).toEqual({ success: true });
    expect(await bookingStatus(booking.id)).toBe('confirmed');
  });

  it("kech to'lov: hold tugagan, joy bor -> qayta hold va tasdiq; joy qolmagan -> success:false, to'lov cancelled (pulni Multicard qaytaradi)", async () => {
    const seats = ctx.app.get(SeatsService);
    const mId = await createMatch({ maxPlayers: 2 });
    const a = await player(mId);
    const { booking: ba } = await book(a, mId);
    const pa = await paymentOf(ba.id);
    await q(ctx, "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1", [ba.id]);
    await seats.expireDue();
    expect(await bookingStatus(ba.id)).toBe('expired');
    payAtMulticard(pa.id);
    expect((await callback(callbackBody(pa.id))).body).toEqual({ success: true });
    expect(await bookingStatus(ba.id)).toBe('confirmed');

    // Ikkinchi o'yinchining hold'i tugaydi, shu orada uchinchisi oxirgi joyni oladi
    const b = await player(mId);
    const { booking: bb } = await book(b, mId);
    const pb = await paymentOf(bb.id);
    await q(ctx, "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1", [bb.id]);
    await seats.expireDue();
    const c = await player(mId);
    const { booking: bc } = await book(c, mId);
    expect(await slots(mId)).toEqual({ held_slots: 1, confirmed_slots: 1 });

    payAtMulticard(pb.id);
    const late = await callback(callbackBody(pb.id));
    expect(late).toEqual({ status: 200, body: { success: false, message: 'Мест не осталось' } });
    expect(await paymentOf(bb.id)).toMatchObject({ status: 'cancelled', failure_code: 'no_seat', provider_state: { failure: 'no_seat' } });
    expect(await bookingStatus(bb.id)).toBe('expired');
    expect(await q(ctx, 'SELECT id FROM refunds WHERE booking_id = $1', [bb.id])).toHaveLength(0);
    // Javob yo'qolib callback qayta kelsa ham — yana rad (Multicard pulni qaytargan), joy bo'shasa ham tasdiqlanmaydi
    await ctx.http().post(`/v1/bookings/${bc.id}/cancel`).set(c.auth).set('Idempotency-Key', uuid()).send({}).expect(200);
    expect((await callback(callbackBody(pb.id))).body).toEqual({ success: false, message: 'Мест не осталось' });
    expect(await bookingStatus(bb.id)).toBe('expired');
  });

  it('invoys yaratilmadi (Multicard 5xx yoki rad) -> 503, booking bekor, joy ozod, to\'lov failed', async () => {
    const mId = await createMatch();
    for (const mode of ['http500', 'reject'] as const) {
      invoiceMode = mode;
      try {
        const s = await player(mId);
        const r = await book(s, mId, uuid(), 503);
        expect(r.code).toBe('UPSTREAM_UNAVAILABLE');
        const b = (await q(ctx, 'SELECT id, status, cancel_reason FROM bookings WHERE user_id = $1 AND match_id = $2', [s.userId, mId]))[0]!;
        expect(b).toMatchObject({ status: 'cancelled', cancel_reason: 'payment_provider_error' });
        expect(await paymentOf(b.id)).toMatchObject({ status: 'failed', failure_code: 'invoice_failed', provider_transaction_id: null, checkout_url: null });
      } finally {
        invoiceMode = 'ok';
      }
    }
    expect(await slots(mId)).toEqual({ held_slots: 0, confirmed_slots: 0 });
  });

  it("sync: callback kelmadi, Multicard'da success -> tasdiq; billing -> kutadi; hold tugagan -> invoys bekor; invoys yopilgan -> cancelled", async () => {
    const mId = await createMatch();
    // 1) success, callback yo'q
    const s1 = await player(mId);
    const { booking: b1 } = await book(s1, mId);
    const p1 = await paymentOf(b1.id);
    const inv1 = payAtMulticard(p1.id);
    inv1.payment!.status = 'billing';
    expect(await mc().syncOne(p1.id)).toBe('waiting');
    expect((await paymentOf(b1.id)).provider_state).toMatchObject({ status: 'billing' });
    inv1.payment!.status = 'success';
    expect(await mc().syncOne(p1.id)).toBe('confirmed');
    expect(await bookingStatus(b1.id)).toBe('confirmed');
    expect(await paymentOf(b1.id)).toMatchObject({ status: 'succeeded', provider_transaction_id: inv1.payment!.uuid });
    // Kech kelgan callback — idempotent
    expect((await callback(callbackBody(p1.id))).body).toEqual({ success: true });

    // 2) hold tugagan, to'lanmagan -> job darhol oladi (2 daqiqa kutmaydi), invoys bekor qilinadi
    const s2 = await player(mId);
    const { booking: b2 } = await book(s2, mId);
    const p2 = await paymentOf(b2.id);
    expect(await mc().syncOne(p2.id)).toBe('waiting');
    await q(ctx, "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1", [b2.id]);
    const stats = await mc().sync();
    expect(stats.cancelled).toBeGreaterThanOrEqual(1);
    expect(invoiceOf(p2.id).cancelled).toBe(true);
    expect(calls.some((c) => c.method === 'DELETE' && c.path === `/payment/invoice/${invoiceOf(p2.id).uuid}`)).toBe(true);
    expect(await paymentOf(b2.id)).toMatchObject({ status: 'cancelled', failure_code: 'hold_expired', provider_state: { status: 'cancelled' } });
    expect(await bookingStatus(b2.id)).toBe('cancelled');

    // 3) Multicard'da invoys yopilgan (ttl o'tgan) -> to'lov cancelled
    const s3 = await player(mId);
    const { booking: b3 } = await book(s3, mId);
    const p3 = await paymentOf(b3.id);
    invoiceReply.set(invoiceOf(p3.id).uuid, {
      status: 400,
      body: { success: false, error: { code: 'ERROR_TRANS_NOT_READY', details: 'Транзакция завершена или не готова' } },
    });
    expect(await mc().syncOne(p3.id)).toBe('cancelled');
    expect(await paymentOf(b3.id)).toMatchObject({ status: 'cancelled', failure_code: 'invoice_closed' });
    expect(await bookingStatus(b3.id)).toBe('cancelled');
    expect(await slots(mId)).toEqual({ held_slots: 0, confirmed_slots: 1 });

    // 4) Hold tugagan, lekin shu orada to'langan: bekor qilish rad etiladi -> keyingi tekshiruvda success -> tasdiq (qayta hold)
    const s4 = await player(mId);
    const { booking: b4 } = await book(s4, mId);
    const p4 = await paymentOf(b4.id);
    await q(ctx, "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1", [b4.id]);
    const inv4 = payAtMulticard(p4.id);
    // GET hali "progress" ni ko'rsatadi, DELETE esa rad etiladi — to'lov yakunlangan (stub success'da bekor qilmaydi)
    invoiceReply.set(inv4.uuid, { status: 200, body: { success: true, data: { uuid: inv4.uuid, payment: { ...inv4.payment, status: 'progress' } } } });
    expect(await mc().syncOne(p4.id)).toBe('waiting');
    expect(inv4.cancelled).toBe(false);
    invoiceReply.delete(inv4.uuid);
    expect(await mc().syncOne(p4.id)).toBe('confirmed');
    expect(await bookingStatus(b4.id)).toBe('confirmed');
  });

  it("sync: kech success, joy qolmagan -> to'lov succeeded + to'liq refund (late_payment_no_seat) -> avto-refund DELETE /payment/{uuid}", async () => {
    const seats = ctx.app.get(SeatsService);
    const mId = await createMatch({ maxPlayers: 3 });
    const a = await player(mId);
    const { booking: ba } = await book(a, mId);
    const pa = await paymentOf(ba.id);
    await q(ctx, "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1", [ba.id]);
    await seats.expireDue();
    // Joylarni boshqalar oldi (ikkitasi to'lagan, bittasi hold'da — match `full` emas: host dispatch'iga tushmaydi)
    await paidBooking(mId);
    await paidBooking(mId);
    await book(await player(mId), mId);
    const inv = payAtMulticard(pa.id);
    expect(await mc().syncOne(pa.id)).toBe('late_refund');
    expect(await paymentOf(ba.id)).toMatchObject({ status: 'succeeded', failure_code: 'no_seat', provider_transaction_id: inv.payment!.uuid });
    expect(await bookingStatus(ba.id)).toBe('expired');
    const refund = (await q(ctx, 'SELECT * FROM refunds WHERE booking_id = $1', [ba.id]))[0]!;
    expect(refund).toMatchObject({ amount: PRICE, destination: 'original_method', status: 'pending', reason: 'late_payment_no_seat', payment_id: pa.id });

    expect(await auto().process(refund.id)).toBe('succeeded');
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: `/payment/${inv.payment!.uuid}` });
    expect((await q(ctx, 'SELECT status, provider_refund_id FROM refunds WHERE id = $1', [refund.id]))[0]).toEqual({
      status: 'succeeded',
      provider_refund_id: inv.payment!.uuid,
    });
    expect(await paymentOf(ba.id)).toMatchObject({ status: 'refunded', refunded_amount: PRICE, provider_state: { status: 'revert' } });
  });

  it("refund: o'yin bekor -> to'liq refund DELETE /payment/{uuid}; Multicard rad etsa -> admin navbati (rejected)", async () => {
    const mId = await createMatch();
    const ok = await paidBooking(mId);
    const rejected = await paidBooking(mId);
    await ctx
      .http()
      .post(`/v1/admin/matches/${mId}/cancel`)
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ reason: 'venue_issue', refund_destination: 'original_method' })
      .expect(202);
    const refundOf = async (bookingId: string) => (await q(ctx, 'SELECT * FROM refunds WHERE booking_id = $1', [bookingId]))[0]!;

    const r1 = await refundOf(ok.bookingId);
    expect(r1).toMatchObject({ amount: PRICE, status: 'pending', destination: 'original_method' });
    expect(await auto().process(r1.id)).toBe('succeeded');
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: `/payment/${ok.inv.payment!.uuid}` });
    expect(await refundOf(ok.bookingId)).toMatchObject({ status: 'succeeded', provider_refund_id: ok.inv.payment!.uuid, auto_attempts: 1 });
    expect(await paymentOf(ok.bookingId)).toMatchObject({ status: 'refunded', refunded_amount: PRICE });
    expect(await auto().process(r1.id)).toBeNull();

    refundMode = 'reject';
    try {
      const r2 = await refundOf(rejected.bookingId);
      expect(await auto().process(r2.id)).toBe('manual');
      expect(await refundOf(rejected.bookingId)).toMatchObject({
        status: 'pending',
        auto_status: 'manual',
        manual_reason: 'rejected',
        auto_error: 'Multicard revert: ERROR_NOT_FOUND Объект не найден',
      });
    } finally {
      refundMode = 'ok';
    }
  });

  it("qisman refund: kartadan (uzcard) -> DELETE …/partial (qolgan summaga ofd) -> partially_refunded; ilova orqali (payme) -> admin navbati", async () => {
    const mId = await createMatch({ policy: 'e2e_half_mc' });
    const card = await paidBooking(mId, 'uzcard');
    const app = await paidBooking(mId, 'payme');
    const cancel = (p: { s: Session; bookingId: string }) =>
      ctx.http().post(`/v1/bookings/${p.bookingId}/cancel`).set(p.s.auth).set('Idempotency-Key', uuid()).send({ refund_destination: 'original_method' }).expect(200);

    const c1 = await cancel(card);
    expect(c1.body.refund).toMatchObject({ amount: { amount: PRICE / 2 }, destination: 'original_method', status: 'pending' });
    const r1 = (await q(ctx, 'SELECT id FROM refunds WHERE booking_id = $1', [card.bookingId]))[0]!;
    expect(await auto().process(r1.id)).toBe('succeeded');
    expect(calls.at(-1)).toMatchObject({
      method: 'DELETE',
      path: `/payment/${card.inv.payment!.uuid}/partial`,
      body: {
        refund_amount: PRICE / 2,
        ofd: [{ qty: 1, price: PRICE / 2, total: PRICE / 2, mxik: MXIK, package_code: PACKAGE, name: "Havaskor sport o'yinida ishtirok", vat: 0 }],
      },
    });
    expect(await paymentOf(card.bookingId)).toMatchObject({ status: 'partially_refunded', refunded_amount: PRICE / 2 });
    expect((await q(ctx, 'SELECT status, auto_status FROM refunds WHERE id = $1', [r1.id]))[0]).toEqual({ status: 'succeeded', auto_status: null });
    const auditRow = (await q(ctx, "SELECT changes FROM audit_logs WHERE entity_id = $1 AND action = 'refund.auto_complete'", [r1.id]))[0]!;
    expect(auditRow.changes).toMatchObject({ provider: 'multicard', partial: true });

    await cancel(app);
    const r2 = (await q(ctx, 'SELECT id FROM refunds WHERE booking_id = $1', [app.bookingId]))[0]!;
    const before = calls.length;
    expect(await auto().process(r2.id)).toBe('manual');
    expect(calls.length).toBe(before);
    expect((await q(ctx, 'SELECT auto_status, manual_reason FROM refunds WHERE id = $1', [r2.id]))[0]).toEqual({ auto_status: 'manual', manual_reason: 'partial' });
  });

  it("reconciliation: Multicard reyestri (history) bo'yicha — bizdagilar mos, providerdagi noma'lum to'lov -> missing_locally", async () => {
    const unknown = randomUUID();
    extraHistory.push({ uuid: unknown, status: 'success', ps: 'humo', store_invoice_id: randomUUID(), payment_amount: 123400, added_on: formatTashkentTime(new Date()) });
    expect(ctx.app.get(ReconciliationService).supported().map((a) => a.provider)).toContain('multicard');
    const r = await ctx
      .http()
      .post('/v1/admin/finance/reconciliation')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ provider: 'multicard', date_from: new Date(Date.now() - 3 * 3600_000).toISOString(), date_to: new Date(Date.now() + 60_000).toISOString() })
      .expect(201);
    const run = r.body.items[0];
    try {
      expect(run).toMatchObject({ provider: 'multicard', status: 'completed', error: null });
      expect(calls.at(-1)!.path).toMatch(new RegExp(`^/payment/store/${STORE_ID}/history\\?offset=0&limit=100&start_date=`));
      const items = await q(ctx, 'SELECT kind, provider_transaction_id, provider_amount, provider_status FROM reconciliation_items WHERE run_id = $1', [run.id]);
      expect(items).toEqual([{ kind: 'missing_locally', provider_transaction_id: unknown, provider_amount: 123400, provider_status: 'succeeded' }]);
      expect(run.counts.matched).toBeGreaterThan(0);
    } finally {
      // reconciliation spec'i jadvalni bo'sh deb hisoblaydi (spec'lar tartibi kafolatlanmagan)
      await q(ctx, 'DELETE FROM reconciliation_items WHERE run_id = $1', [run.id]);
      await q(ctx, 'DELETE FROM reconciliation_runs WHERE id = $1', [run.id]);
    }
  });
});
