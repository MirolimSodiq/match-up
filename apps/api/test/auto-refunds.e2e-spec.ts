import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ENV, type Env } from '../src/config/env';
import { AUTO_REFUND_MAX_ATTEMPTS, AutoRefunds } from '../src/payments/auto-refunds';
import {
  bookAndPayWithPayme,
  bookAndPayWithUzum,
  clickSign,
  createTestApp,
  login,
  payme,
  q,
  signatureId,
  uuid,
  uzum,
  type Session,
  type TestCtx,
} from './helpers';

const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');

/**
 * Payme `receipts.cancel` rejimlari (chek id bo'yicha):
 *   webhook — Payme javob berishdan OLDIN bizning CancelTransaction'ni chaqiradi (job lock ushlamasligi shart);
 *   queue   — chek 21 (bekor qilish navbatida), natija keyin `receipts.check` bilan;
 *   reject  — JSON-RPC xato (rad etildi); system — -32400; http500 — HTTP 500 (vaqtinchalik).
 */
type PaymeMode = 'webhook' | 'queue' | 'reject' | 'system' | 'http500';

describe('Avtomatik provider refund (B8): Payme, Click, Uzum, qisman, xatolar, admin', () => {
  let ctx: TestCtx;
  let admin: Session;
  let pitch: string;
  let server: Server;
  const savedEnv = { ...process.env };

  const paymeModes = new Map<string, PaymeMode>();
  const paymeCheck = new Map<string, number>();
  const paymeCalls: { auth: unknown; method: string; id: string }[] = [];
  const paymeWebhookReplies: Record<string, any>[] = [];
  const clickCalls: { path: string; auth: string; method: string }[] = [];
  let clickReply: (paymentId: string) => { status: number; body: unknown } = (id) => ({
    status: 200,
    body: { error_code: 0, error_note: 'Success', payment_id: Number(id) },
  });
  const telegram: string[] = [];

  const auto = () => ctx.app.get(AutoRefunds);
  const env = () => ctx.app.get<Env>(ENV);

  let slot = 0;
  async function createMatch(policy = 'standard'): Promise<string> {
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitch,
        sport: 'football',
        starts_at: inMinutes(40 * 24 * 60 + ++slot * 120),
        duration_min: 60,
        format: '5v5',
        players_per_side: 5,
        min_players: 4,
        max_players: 10,
        price: { amount: 4000000, currency: 'UZS' },
        lease_cost: { amount: 20000000, currency: 'UZS' },
        cancellation_policy_code: policy,
      });
    if (c.status !== 201) throw new Error(JSON.stringify(c.body));
    await ctx.http().post(`/v1/admin/matches/${c.body.id}/publish`).set(admin.auth).expect(200);
    return c.body.id;
  }

  /** Yangi o'yinchi, shu match uchun waiver imzolangan. */
  let phoneSeq = 0;
  async function player(mId: string): Promise<Session> {
    const s = await login(ctx, `+99893730${String(++phoneSeq).padStart(4, '0')}`);
    const tpl = (await ctx.http().get(`/v1/waivers/required?match_id=${mId}`).set(s.auth).expect(200)).body.template;
    await ctx
      .http()
      .post(`/v1/waivers/${tpl.id}/signatures`)
      .set(s.auth)
      .send({ accepted: true, method: 'clickwrap', document_sha256: tpl.document_sha256, match_id: mId })
      .expect(201);
    return s;
  }

  async function cancelMatch(mId: string) {
    await ctx
      .http()
      .post(`/v1/admin/matches/${mId}/cancel`)
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ reason: 'venue_issue', refund_destination: 'original_method' })
      .expect(202);
  }

  const refundOf = async (bookingId: string) =>
    (await q(ctx, 'SELECT * FROM refunds WHERE booking_id = $1 ORDER BY created_at', [bookingId]))[0]!;
  const makeDue = (refundId: string) => q(ctx, 'UPDATE refunds SET auto_next_at = now() WHERE id = $1', [refundId]);
  const issued = async (refundId: string) =>
    (await q(ctx, "SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'RefundIssued'", [refundId])).map((e) => e.payload);
  const auditActions = async (refundId: string) =>
    (await q(ctx, 'SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at, id', [refundId])).map((a) => a.action);

  /** Payme bilan to'langan booking, keyin admin match'ni bekor qiladi -> to'liq refund navbatda. */
  async function paymeRefund(mode: PaymeMode) {
    const mId = await createMatch();
    const s = await player(mId);
    const paid = await bookAndPayWithPayme(ctx, s, mId);
    paymeModes.set(paid.txId, mode);
    await cancelMatch(mId);
    const refund = await refundOf(paid.bookingId);
    return { ...paid, mId, s, refund };
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        res.setHeader('Content-Type', 'application/json');
        const url = req.url ?? '';
        if (url === '/payme/api') {
          const rpc = JSON.parse(body);
          const id = rpc.params.id as string;
          paymeCalls.push({ auth: req.headers['x-auth'], method: rpc.method, id });
          const reply = (payload: Record<string, unknown>) => res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, ...payload }));
          if (rpc.method === 'receipts.check') return reply({ result: { state: paymeCheck.get(id) ?? 21 } });
          switch (paymeModes.get(id)) {
            case 'webhook': {
              // Payme Merchant API kassasi: bekor qilish bizning CancelTransaction (reason 5) orqali yakunlanadi
              paymeWebhookReplies.push(await payme(ctx, 'CancelTransaction', { id, reason: 5 }));
              return reply({ result: { receipt: { _id: id, state: 50 } } });
            }
            case 'queue':
              return reply({ result: { receipt: { _id: id, state: 21 } } });
            case 'system':
              return reply({ error: { code: -32400, message: 'System error' } });
            case 'http500':
              res.statusCode = 500;
              return res.end('{}');
            default:
              return reply({ error: { code: -31602, message: { ru: 'Чек нельзя отменить', uz: "Chekni bekor qilib bo'lmaydi" } } });
          }
        }
        if (url.startsWith('/click/')) {
          clickCalls.push({ path: url, auth: String(req.headers.auth ?? ''), method: req.method ?? '' });
          const r = clickReply(url.split('/').pop()!);
          res.statusCode = r.status;
          return res.end(JSON.stringify(r.body));
        }
        if (url.endsWith('/sendMessage')) {
          telegram.push(JSON.parse(body).text);
          return res.end(JSON.stringify({ ok: true, result: { message_id: telegram.length } }));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    Object.assign(process.env, {
      PAYME_REFUND_ENABLED: 'true',
      PAYME_API_URL: `${base}/payme/api`,
      CLICK_REFUND_ENABLED: 'true',
      CLICK_API_URL: `${base}/click`,
      CLICK_MERCHANT_USER_ID: 'e2e-click-user',
      TELEGRAM_API_URL: base,
      OPS_TELEGRAM_CHAT_ID: '-100777',
      ADMIN_PUBLIC_URL: 'https://admin.e2e.matchup.example',
    });

    ctx = await createTestApp();
    admin = await login(ctx, '+998901110001');
    pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'chilonzor-arena'"))[0]!.id;
    await q(
      ctx,
      `INSERT INTO cancellation_policies (code, name, rules)
       VALUES ('e2e_half', '{"en": "Half"}', '[{"min_hours_before": 0, "refund_pct": 50, "destination": "original_method"}]')
       ON CONFLICT (code) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await ctx.close();
    await new Promise((r) => server.close(r));
    for (const k of [
      'PAYME_REFUND_ENABLED',
      'PAYME_API_URL',
      'CLICK_REFUND_ENABLED',
      'CLICK_API_URL',
      'CLICK_MERCHANT_USER_ID',
      'TELEGRAM_API_URL',
      'OPS_TELEGRAM_CHAT_ID',
      'ADMIN_PUBLIC_URL',
    ]) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("Payme: to'liq refund -> receipts.cancel; Payme shu so'rov ichida CancelTransaction'ni chaqiradi -> refund yakunlanadi, push", async () => {
    const { txId, refund, bookingId } = await paymeRefund('webhook');
    expect(refund).toMatchObject({ status: 'pending', destination: 'original_method', amount: 4000000, auto_status: null, auto_attempts: 0 });

    // Job provider'ni chaqirayotganda refund qatorini lock qilib turmaydi — aks holda webhook kutib qolardi
    expect(await auto().process(refund.id)).toBe('succeeded');
    expect(paymeCalls.filter((c) => c.id === txId)).toEqual([{ auth: 'demo-payme:payme_test_key', method: 'receipts.cancel', id: txId }]);
    expect(paymeWebhookReplies.at(-1)!.result).toMatchObject({ state: -2 });

    const r = await refundOf(bookingId);
    expect(r).toMatchObject({ status: 'succeeded', provider_refund_id: txId, auto_status: null, auto_attempts: 1, processed_by: null });
    const pay = (await q(ctx, 'SELECT status, refunded_amount, provider_state FROM payments WHERE id = $1', [refund.payment_id]))[0]!;
    expect(pay).toMatchObject({ status: 'refunded', refunded_amount: 4000000, provider_state: { state: -2, reason: 5 } });
    // So'ralgan refund yakunlandi — alohida `provider_cancel` qatori yo'q
    expect(await q(ctx, 'SELECT id FROM refunds WHERE booking_id = $1', [bookingId])).toHaveLength(1);
    expect(await issued(refund.id)).toEqual([expect.objectContaining({ amount: 4000000, destination: 'original_method', provider_refund_id: txId })]);

    // Takroriy ishga tushirish — hech narsa qilinmaydi
    expect(await auto().process(refund.id)).toBeNull();
    expect(paymeCalls.filter((c) => c.id === txId)).toHaveLength(1);
  });

  it("Payme: chek 'bekor qilish navbatida' (21) -> submitted; receipts.check 50 -> yakunlanadi; kech kelgan CancelTransaction idempotent", async () => {
    const { txId, refund, bookingId } = await paymeRefund('queue');
    expect(await auto().process(refund.id)).toBe('submitted');
    let r = await refundOf(bookingId);
    expect(r).toMatchObject({ status: 'pending', auto_status: 'submitted', auto_attempts: 1 });
    expect(new Date(r.auto_next_at).getTime()).toBeGreaterThan(Date.now() + 60_000);

    // Navbat vaqti kelmagan — job tegmaydi; admin ham "bajarildi" deya olmaydi (provider javobi kutilmoqda)
    expect(await auto().process(refund.id)).toBeNull();
    await ctx.http().post(`/v1/admin/refunds/${refund.id}/complete`).set(admin.auth).set('Idempotency-Key', uuid()).send({ provider_refund_id: 'X' }).expect(409);
    await ctx.http().post(`/v1/admin/refunds/${refund.id}/to-wallet`).set(admin.auth).set('Idempotency-Key', uuid()).send({}).expect(409);

    // Hali 21 — kutishda davom
    await makeDue(refund.id);
    expect(await auto().process(refund.id)).toBe('submitted');
    expect(paymeCalls.filter((c) => c.id === txId).map((c) => c.method)).toEqual(['receipts.cancel', 'receipts.check']);

    paymeCheck.set(txId, 50);
    await makeDue(refund.id);
    expect(await auto().process(refund.id)).toBe('succeeded');
    r = await refundOf(bookingId);
    expect(r).toMatchObject({ status: 'succeeded', provider_refund_id: txId, auto_status: null, auto_attempts: 1 });
    const pay = (await q(ctx, 'SELECT status, refunded_amount, provider_state FROM payments WHERE id = $1', [refund.payment_id]))[0]!;
    expect(pay).toMatchObject({ status: 'refunded', refunded_amount: 4000000, provider_state: { state: -2, reason: 5 } });
    expect(await auditActions(refund.id)).toEqual(['refund.auto_complete']);
    expect(await issued(refund.id)).toHaveLength(1);

    const late = await payme(ctx, 'CancelTransaction', { id: txId, reason: 5 });
    expect(late.result).toMatchObject({ state: -2 });
    expect(await q(ctx, 'SELECT id FROM refunds WHERE booking_id = $1', [bookingId])).toHaveLength(1);
  });

  it('Click: payment/reversal sinxron — Auth sarlavhasi, click_trans_id; provider rad etsa -> admin navbati', async () => {
    async function clickBooking(clickTransId: string) {
      const mId = await createMatch();
      const s = await player(mId);
      const b = await ctx
        .http()
        .post('/v1/bookings')
        .set(s.auth)
        .set('Idempotency-Key', uuid())
        .send({ match_id: mId, payment_method: 'click', waiver_signature_id: await signatureId(ctx, s, mId) })
        .expect(201);
      const booking = b.body.booking;
      const base = { click_trans_id: clickTransId, service_id: '1000', merchant_trans_id: booking.id, amount: '40000.00', sign_time: '2026-10-22 10:00:00' };
      const form = (p: Record<string, string>) => new URLSearchParams(p).toString();
      const prep = { ...base, action: '0', error: '0' };
      await ctx.http().post('/v1/webhooks/click/prepare').type('form').send(form({ ...prep, sign_string: clickSign(prep, false) })).expect(200);
      const comp = { ...base, action: '1', error: '0', merchant_prepare_id: clickTransId };
      const c = await ctx.http().post('/v1/webhooks/click/complete').type('form').send(form({ ...comp, sign_string: clickSign(comp, true) })).expect(200);
      expect(c.body.error).toBe(0);
      await cancelMatch(mId);
      return refundOf(booking.id);
    }

    const ok = await clickBooking('930000001');
    expect(await auto().process(ok.id)).toBe('succeeded');
    const call = clickCalls.at(-1)!;
    expect(call).toMatchObject({ method: 'DELETE', path: '/click/payment/reversal/1000/930000001' });
    const [user, digest, ts] = call.auth.split(':');
    expect(user).toBe('e2e-click-user');
    expect(digest).toBe(createHash('sha1').update(`${ts}click_test_secret`).digest('hex'));
    expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(60);
    expect(await refundOf(ok.booking_id)).toMatchObject({ status: 'succeeded', provider_refund_id: '930000001', auto_status: null });
    expect((await q(ctx, 'SELECT status, refunded_amount FROM payments WHERE id = $1', [ok.payment_id]))[0]).toEqual({ status: 'refunded', refunded_amount: 4000000 });
    expect(await auditActions(ok.id)).toEqual(['refund.auto_complete']);

    clickReply = () => ({ status: 200, body: { error_code: -5017, error_note: 'Payment can not be reversed' } });
    const bad = await clickBooking('930000002');
    const alerts = telegram.length;
    expect(await auto().process(bad.id)).toBe('manual');
    expect(await refundOf(bad.booking_id)).toMatchObject({
      status: 'pending',
      auto_status: 'manual',
      manual_reason: 'rejected',
      auto_error: 'Click payment/reversal: -5017 Payment can not be reversed',
    });
    expect(telegram).toHaveLength(alerts + 1);
    expect(telegram.at(-1)).toContain('provider rad etdi');
    expect(telegram.at(-1)).toContain(`https://admin.e2e.matchup.example/refunds?q=${bad.id}`);
    expect(telegram.at(-1)).not.toMatch(/\+?998\d{9}/);
  });

  it("qisman refund (50% qoida) -> admin navbati (partial), provider chaqirilmaydi; admin hamyonga o'tkazadi", async () => {
    const mId = await createMatch('e2e_half');
    const s = await player(mId);
    const { bookingId, txId } = await bookAndPayWithPayme(ctx, s, mId);
    paymeModes.set(txId, 'webhook');
    const c = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set(s.auth)
      .set('Idempotency-Key', uuid())
      .send({ refund_destination: 'original_method' })
      .expect(200);
    expect(c.body.refund).toMatchObject({ amount: { amount: 2000000 }, destination: 'original_method', status: 'pending' });
    const refund = await refundOf(bookingId);

    expect(await auto().process(refund.id)).toBe('manual');
    expect(paymeCalls.filter((x) => x.id === txId)).toEqual([]);
    expect(await refundOf(bookingId)).toMatchObject({ status: 'pending', auto_status: 'manual', manual_reason: 'partial', auto_error: null });
    expect(await auditActions(refund.id)).toEqual(['refund.auto_manual']);

    // Admin navbatida: auto maydoni va filtr
    const list = await ctx.http().get('/v1/admin/refunds?auto_status=manual').set(admin.auth).expect(200);
    expect(list.body.items.find((x: { id: string }) => x.id === refund.id)).toMatchObject({
      status: 'pending',
      auto: { status: 'manual', attempts: 0, next_attempt_at: null, manual_reason: 'partial', error: null },
    });
    const queued = await ctx.http().get('/v1/admin/refunds?auto_status=queued,submitted').set(admin.auth).expect(200);
    expect(queued.body.items.map((x: { id: string }) => x.id)).not.toContain(refund.id);

    const player2 = await login(ctx, '+998902000004');
    await ctx.http().post(`/v1/admin/refunds/${refund.id}/to-wallet`).set(player2.auth).set('Idempotency-Key', uuid()).send({}).expect(403);
    await ctx.http().post(`/v1/admin/refunds/${refund.id}/to-wallet`).set(admin.auth).send({}).expect(422); // Idempotency-Key yo'q
    const before = (await ctx.http().get('/v1/me/wallet').set(s.auth).expect(200)).body;
    const w = await ctx
      .http()
      .post(`/v1/admin/refunds/${refund.id}/to-wallet`)
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ note: "Payme qisman qaytarmaydi — hamyonga" })
      .expect(200);
    expect(w.body).toMatchObject({
      id: refund.id,
      destination: 'wallet',
      status: 'succeeded',
      note: "Payme qisman qaytarmaydi — hamyonga",
      processed_by: { id: admin.userId },
      auto: { status: 'manual', manual_reason: 'partial' },
      payment: { status: 'succeeded', refunded: { amount: 0 } },
    });
    const after = (await ctx.http().get('/v1/me/wallet').set(s.auth).expect(200)).body;
    expect(after.balance.amount - (before.balance?.amount ?? 0)).toBe(2000000);
    expect(await issued(refund.id)).toEqual([expect.objectContaining({ amount: 2000000, destination: 'wallet' })]);
    expect(await auditActions(refund.id)).toEqual(['refund.auto_manual', 'refund.to_wallet']);

    // Yakunlangan — boshqa amal yo'q
    await ctx.http().post(`/v1/admin/refunds/${refund.id}/to-wallet`).set(admin.auth).set('Idempotency-Key', uuid()).send({}).expect(409);
    await ctx.http().post(`/v1/admin/refunds/${refund.id}/complete`).set(admin.auth).set('Idempotency-Key', uuid()).send({ provider_refund_id: 'X' }).expect(409);
    await ctx.http().post(`/v1/admin/refunds/${refund.id}/retry`).set(admin.auth).expect(409);
  });

  it("Uzum: refund API yo'q -> admin navbati (unsupported); Uzum kabinetidan bekor qilish (/reverse) refund'ni yakunlaydi, o'yin boshlangan bo'lsa ham", async () => {
    const mId = await createMatch();
    const s = await player(mId);
    const { bookingId, transId } = await bookAndPayWithUzum(ctx, s, mId);
    await cancelMatch(mId);
    const refund = await refundOf(bookingId);
    const alerts = telegram.length;
    expect(await auto().process(refund.id)).toBe('manual');
    const r = await refundOf(bookingId);
    expect(r).toMatchObject({ auto_status: 'manual', manual_reason: 'unsupported' });
    expect(r.auto_error).toContain('Uzum');
    expect(telegram).toHaveLength(alerts); // kutilgan holat — ogohlantirish yo'q

    // Admin Uzum kabinetidan bekor qildi (match vaqti allaqachon o'tgan bo'lsa ham — refund biz tomondan so'ralgan)
    await q(
      ctx,
      `UPDATE matches SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour',
              booking_closes_at = now() - interval '3 hours', min_players_deadline = now() - interval '5 hours' WHERE id = $1`,
      [mId],
    );
    const rev = await uzum(ctx, 'reverse', { transId });
    expect(rev).toMatchObject({ status: 200, body: { status: 'REVERSED' } });
    expect(await refundOf(bookingId)).toMatchObject({ status: 'succeeded', provider_refund_id: transId, auto_status: 'manual', manual_reason: 'unsupported' });
    expect(await q(ctx, 'SELECT id FROM refunds WHERE booking_id = $1', [bookingId])).toHaveLength(1);
    expect((await q(ctx, 'SELECT status, refunded_amount FROM payments WHERE id = $1', [refund.payment_id]))[0]).toEqual({ status: 'refunded', refunded_amount: 4000000 });
    expect(await issued(refund.id)).toEqual([expect.objectContaining({ amount: 4000000, destination: 'original_method', provider_refund_id: transId })]);
  });

  it("vaqtinchalik xatolar: backoff bilan qayta urinish, oxirida admin navbati (failed) + ogohlantirish; admin 'qayta urinish'", async () => {
    const { txId, refund, bookingId } = await paymeRefund('http500');
    expect(await auto().process(refund.id)).toBe('retry');
    let r = await refundOf(bookingId);
    expect(r).toMatchObject({ status: 'pending', auto_status: 'queued', auto_attempts: 1, auto_error: 'Payme receipts.cancel: HTTP 500' });
    const wait = new Date(r.auto_next_at).getTime() - Date.now();
    expect(wait).toBeGreaterThan(30_000);
    expect(wait).toBeLessThan(90_000);

    // -32400 ham vaqtinchalik
    paymeModes.set(txId, 'system');
    const alerts = telegram.length;
    for (let i = 2; i < AUTO_REFUND_MAX_ATTEMPTS; i++) {
      await makeDue(refund.id);
      expect(await auto().process(refund.id)).toBe('retry');
    }
    r = await refundOf(bookingId);
    expect(r).toMatchObject({ auto_status: 'queued', auto_attempts: AUTO_REFUND_MAX_ATTEMPTS - 1 });
    expect(r.auto_error).toContain('-32400');
    await makeDue(refund.id);
    expect(await auto().process(refund.id)).toBe('manual');
    r = await refundOf(bookingId);
    expect(r).toMatchObject({ status: 'pending', auto_status: 'manual', manual_reason: 'failed', auto_attempts: AUTO_REFUND_MAX_ATTEMPTS });
    expect(telegram).toHaveLength(alerts + 1);
    expect(telegram.at(-1)).toContain('urinishlar tugadi');
    expect(paymeCalls.filter((c) => c.id === txId)).toHaveLength(AUTO_REFUND_MAX_ATTEMPTS);

    // Admin: qayta urinish -> navbat, hisoblagich nolga; provider endi ishlaydi
    const retry = await ctx.http().post(`/v1/admin/refunds/${refund.id}/retry`).set(admin.auth).expect(200);
    expect(retry.body.auto).toMatchObject({ status: 'queued', attempts: 0, manual_reason: null, error: null });
    await ctx.http().post(`/v1/admin/refunds/${refund.id}/retry`).set(admin.auth).expect(409); // navbatda — manual emas
    paymeModes.set(txId, 'webhook');
    expect(await auto().process(refund.id)).toBe('succeeded');
    expect(await refundOf(bookingId)).toMatchObject({ status: 'succeeded', provider_refund_id: txId, auto_status: null, auto_attempts: 1 });
    expect(await auditActions(refund.id)).toEqual(['refund.auto_manual', 'refund.auto_retry']);
  });

  it("provider rad etdi (Payme xatosi) va avto-refund o'chiq -> admin navbati; admin qo'lda 'bajarildi'", async () => {
    const rejected = await paymeRefund('reject');
    expect(await auto().process(rejected.refund.id)).toBe('manual');
    const r = await refundOf(rejected.bookingId);
    expect(r).toMatchObject({ auto_status: 'manual', manual_reason: 'rejected', auto_attempts: 1 });
    expect(r.auto_error).toContain('-31602');
    expect(telegram.at(-1)).toContain('provider rad etdi');

    const done = await ctx
      .http()
      .post(`/v1/admin/refunds/${rejected.refund.id}/complete`)
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ provider_refund_id: 'PAYME-MANUAL-1', note: 'kabinetdan' })
      .expect(200);
    expect(done.body).toMatchObject({ status: 'succeeded', provider_refund_id: 'PAYME-MANUAL-1', auto: { status: 'manual', manual_reason: 'rejected' }, payment: { status: 'refunded' } });

    env().PAYME_REFUND_ENABLED = false;
    try {
      const off = await paymeRefund('webhook');
      const alerts = telegram.length;
      expect(await auto().process(off.refund.id)).toBe('manual');
      expect(await refundOf(off.bookingId)).toMatchObject({ auto_status: 'manual', manual_reason: 'disabled', auto_attempts: 0 });
      expect(paymeCalls.filter((c) => c.id === off.txId)).toEqual([]);
      expect(telegram).toHaveLength(alerts);
    } finally {
      env().PAYME_REFUND_ENABLED = true;
    }
  });

  it("run(): navbatdagilarni oladi, admin navbatidagi va eski (legacy) refund'larga tegmaydi", async () => {
    const fresh = await paymeRefund('webhook');
    const legacy = await paymeRefund('webhook');
    await q(ctx, "UPDATE refunds SET auto_status = 'manual', manual_reason = 'legacy' WHERE id = $1", [legacy.refund.id]);

    const res = await auto().run();
    expect(res.processed).toBeGreaterThanOrEqual(1);
    expect(res.succeeded).toBeGreaterThanOrEqual(1);
    expect(await refundOf(fresh.bookingId)).toMatchObject({ status: 'succeeded', provider_refund_id: fresh.txId });
    expect(await refundOf(legacy.bookingId)).toMatchObject({ status: 'pending', auto_status: 'manual', manual_reason: 'legacy' });
    expect(paymeCalls.filter((c) => c.id === legacy.txId)).toEqual([]);
  });
});
