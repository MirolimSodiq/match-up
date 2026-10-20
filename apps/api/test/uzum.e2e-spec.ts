import { createHash } from 'node:crypto';
import { SeatsService } from '../src/commerce/seats.service';
import { createTestApp, login, payme, q, signatureId, uuid, uzum, UZUM_AUTH, UZUM_SERVICE_ID, type Session, type TestCtx } from './helpers';

/**
 * Uzum Bank Merchant API (developer.uzumbank.uz/merchant): check / create / confirm / reverse / status.
 * Boshqa spec'lar bilan joy talashmaslik uchun o'z match'i bilan.
 */
describe('Uzum Bank Merchant API', () => {
  let ctx: TestCtx;
  let admin: Session;
  let matchId: string;
  let matchCode: string;
  const PRICE = 3000000;

  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const status = async (table: 'bookings' | 'payments', id: string) => (await q(ctx, `SELECT status FROM ${table} WHERE id = $1`, [id]))[0]!.status;
  const slots = async () => (await q<{ held_slots: number; confirmed_slots: number }>(ctx, 'SELECT held_slots, confirmed_slots FROM matches WHERE id = $1', [matchId]))[0]!;
  const paymentByTx = async (transId: string) =>
    (await q(ctx, "SELECT id, status, amount, failure_code, provider_state FROM payments WHERE provider = 'uzum' AND provider_transaction_id = $1", [transId]))[0];

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await login(ctx, '+998901110001');
    const pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'yunusobod-sport' AND p.name = 'Pitch 1'"))[0]!.id;
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitch,
        sport: 'football',
        starts_at: inHours(24 * 15),
        duration_min: 60,
        format: '5v5',
        players_per_side: 5,
        min_players: 6,
        max_players: 10,
        price: { amount: PRICE, currency: 'UZS' },
        lease_cost: { amount: 10000000, currency: 'UZS' },
        title: { 'uz-Latn': 'Uzum test' },
      })
      .expect(201);
    matchId = c.body.id;
    matchCode = c.body.public_code;
    await ctx.http().post(`/v1/admin/matches/${matchId}/publish`).set(admin.auth).expect(200);
  });
  afterAll(() => ctx.close());

  async function book(phone: string) {
    const s = await login(ctx, phone);
    const r = await ctx
      .http()
      .post('/v1/bookings')
      .set(s.auth)
      .set('Idempotency-Key', uuid())
      .send({ match_id: matchId, payment_method: 'uzum', waiver_signature_id: await signatureId(ctx, s, matchId) })
      .expect(201);
    return { s, id: r.body.booking.id as string, amount: r.body.booking.total.amount as number, checkout: r.body.checkout };
  }

  const confirmBody = (transId: string) => ({
    transId,
    paymentSource: 'UZCARD',
    tariff: null,
    processingReferenceNumber: '000123',
    phone: '998901234567',
    cardType: 2,
  });

  it("to'lov usullarida Uzum Bank bor; booking checkout'i Uzum ilovasi havolasi", async () => {
    const s = await login(ctx, '+998902000004');
    const m = await ctx.http().get(`/v1/payment-methods?match_id=${matchId}`).set(s.auth).expect(200);
    expect(m.body.methods.map((x: { provider: string }) => x.provider)).toEqual(['wallet', 'payme', 'click', 'uzum']);
    expect(m.body.methods.find((x: { provider: string }) => x.provider === 'uzum').display_name).toBe('Uzum Bank');

    const { id, amount, checkout } = await book('+998902000004');
    expect(amount).toBe(PRICE);
    expect(checkout).toMatchObject({ type: 'redirect', provider: 'uzum' });
    const url = new URL(checkout.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://www.uzumbank.uz/open-service');
    expect(Object.fromEntries(url.searchParams)).toEqual({ serviceId: String(UZUM_SERVICE_ID), booking_id: id, amount: String(PRICE) });
    // Booking bilan 'created' qator tayyorlanadi — /create shuni ishlatadi
    expect(await q(ctx, "SELECT status, checkout_url FROM payments WHERE booking_id = $1 AND provider = 'uzum'", [id])).toEqual([
      { status: 'created', checkout_url: checkout.url },
    ]);
  });

  it("auth xatosi: barcha 5 metod 10001 (HTTP 400), payment_events'ga signature_valid=false bilan yoziladi", async () => {
    const bad = 'Basic ' + Buffer.from('uzum_test_login:wrong').toString('base64');
    const transId = uuid();
    for (const op of ['check', 'create', 'confirm', 'reverse', 'status']) {
      for (const auth of [null, bad, 'Bearer x']) {
        const r = await uzum(ctx, op, { transId, params: { booking_id: uuid() }, amount: PRICE }, auth);
        expect(r).toMatchObject({ status: 400, body: { serviceId: UZUM_SERVICE_ID, status: 'FAILED', errorCode: '10001' } });
      }
    }
    const ev = await q(ctx, "SELECT count(*)::int AS n FROM payment_events WHERE provider = 'uzum' AND payload->>'transId' = $1 AND NOT signature_valid AND processing_error = '10001'", [transId]);
    expect(ev[0]!.n).toBe(15);
    expect(await paymentByTx(transId)).toBeUndefined();
  });

  it("to'g'ri oqim: check -> create -> status -> confirm -> status; har biri idempotent", async () => {
    const booking = (await q(ctx, "SELECT b.id FROM bookings b JOIN users u ON u.id = b.user_id WHERE u.phone_e164 = '+998902000004' AND b.match_id = $1", [matchId]))[0]!.id;
    const params = { booking_id: booking };
    const before = await slots();

    // check: pul yechilmaydi, faqat tekshiruv; ilovada ko'rsatiladigan data
    const chk = await uzum(ctx, 'check', { params });
    expect(chk).toMatchObject({ status: 200, body: { serviceId: UZUM_SERVICE_ID, status: 'OK' } });
    expect(chk.body.data).toEqual({ booking_id: { value: booking }, match: { value: matchCode }, total: { value: expect.stringMatching(/^30\s000 so'm$/) } });
    expect(typeof chk.body.timestamp).toBe('number');

    const transId = uuid();
    const cr = await uzum(ctx, 'create', { transId, params, amount: PRICE });
    expect(cr).toMatchObject({ status: 200, body: { serviceId: UZUM_SERVICE_ID, transId, status: 'CREATED', amount: PRICE } });
    const pay = (await paymentByTx(transId))!;
    expect(pay).toMatchObject({ status: 'pending', amount: PRICE, provider_state: { state: 'CREATED', trans_time: cr.body.transTime, confirm_time: null } });
    // Booking bilan tayyorlangan 'created' qator ishlatildi (yangi qator yo'q)
    expect((await q(ctx, "SELECT count(*)::int AS n FROM payments WHERE booking_id = $1 AND provider = 'uzum'", [booking]))[0]!.n).toBe(1);

    // Takroriy /create (o'sha transId) — hujjat bo'yicha 10010, o'sha transTime, yangi qator yo'q
    const again = await uzum(ctx, 'create', { transId, params, amount: PRICE });
    expect(again).toMatchObject({ status: 400, body: { transId, status: 'FAILED', errorCode: '10010', transTime: cr.body.transTime } });
    expect((await q(ctx, "SELECT count(*)::int AS n FROM payments WHERE booking_id = $1 AND provider = 'uzum'", [booking]))[0]!.n).toBe(1);

    const st1 = await uzum(ctx, 'status', { transId });
    expect(st1).toMatchObject({ status: 200, body: { status: 'CREATED', transTime: cr.body.transTime, confirmTime: null, reverseTime: null, amount: PRICE } });

    const cf = await uzum(ctx, 'confirm', confirmBody(transId));
    expect(cf).toMatchObject({ status: 200, body: { serviceId: UZUM_SERVICE_ID, transId, status: 'CONFIRMED', amount: PRICE } });
    expect(await status('bookings', booking)).toBe('confirmed');
    expect((await paymentByTx(transId))!).toMatchObject({
      status: 'succeeded',
      provider_state: { state: 'CONFIRMED', confirm_time: cf.body.confirmTime, payment_source: 'UZCARD', processing_reference_number: '000123', card_type: 2 },
    });
    expect(await slots()).toEqual({ held_slots: before.held_slots - 1, confirmed_slots: before.confirmed_slots + 1 });

    // Takroriy /confirm — 10016 (o'sha confirmTime), ikkinchi PaymentSucceeded yo'q
    const cf2 = await uzum(ctx, 'confirm', confirmBody(transId));
    expect(cf2).toMatchObject({ status: 400, body: { status: 'FAILED', errorCode: '10016', confirmTime: cf.body.confirmTime } });
    const events = await q(ctx, "SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'PaymentSucceeded'", [pay.id]);
    expect(events).toEqual([{ payload: { provider: 'uzum', booking_id: booking, amount: PRICE } }]);
    expect(await slots()).toEqual({ held_slots: before.held_slots - 1, confirmed_slots: before.confirmed_slots + 1 });

    const st2 = await uzum(ctx, 'status', { transId });
    expect(st2).toMatchObject({ status: 200, body: { status: 'CONFIRMED', transTime: cr.body.transTime, confirmTime: cf.body.confirmTime, reverseTime: null } });

    // Endi booking to'langan: yangi check / create — 10008 ("Payment already made")
    expect((await uzum(ctx, 'check', { params })).body.errorCode).toBe('10008');
    expect((await uzum(ctx, 'create', { transId: uuid(), params, amount: PRICE })).body.errorCode).toBe('10008');

    // Har chaqiruv payment_events'da: processed_at, payment_id, telefon maskalangan
    const ev = await q(ctx, "SELECT event_type, payment_id, processing_error, processed_at, payload FROM payment_events WHERE provider = 'uzum' AND payload->>'transId' = $1 ORDER BY received_at", [transId]);
    expect(ev.map((e) => [e.event_type, e.processing_error])).toEqual([
      ['create', null],
      ['create', '10010'],
      ['status', null],
      ['confirm', null],
      ['confirm', '10016'],
      ['status', null],
    ]);
    expect(ev.every((e) => e.payment_id === pay.id && e.processed_at !== null)).toBe(true);
    expect(ev[3]!.payload.phone).toBe('998*****4567');

    // Chipta ham beriladi
    const s = await login(ctx, '+998902000004');
    await ctx.http().get(`/v1/bookings/${booking}/ticket`).set(s.auth).expect(200);
  });

  it("summa va parametr xatolari: 10002, 10003, 10005, 10006, 10007, 10011, 10014", async () => {
    const { id } = await book('+998902000009');
    const params = { booking_id: id };
    const err = async (op: string, body: Record<string, unknown>) => (await uzum(ctx, op, body)).body.errorCode;

    expect(await err('create', { transId: uuid(), params, amount: PRICE - 100 })).toBe('10011');
    expect(await err('create', { transId: uuid(), params, amount: 1.5 })).toBe('10011');
    expect(await err('create', { transId: uuid(), params })).toBe('10005');
    expect(await err('create', { params, amount: PRICE })).toBe('10005');
    expect(await err('create', { transId: uuid(), params, amount: PRICE, serviceId: 999 })).toBe('10006');
    expect(await err('check', { params, serviceId: 999 })).toBe('10006');
    expect(await err('check', { params: {} })).toBe('10005');
    expect(await err('check', { params: { booking_id: 'abc' } })).toBe('10007');
    expect(await err('check', { params: { booking_id: uuid() } })).toBe('10007');
    expect(await err('check', { params, timestamp: 'now' })).toBe('10005');
    for (const op of ['confirm', 'reverse', 'status']) expect(await err(op, { transId: uuid() })).toBe('10014');
    expect(await err('confirm', {})).toBe('10005');
    expect(await err('refund', { params })).toBe('10003');

    const get = await ctx.http().get('/v1/webhooks/uzum/check').set('Authorization', UZUM_AUTH);
    expect(get.status).toBe(400);
    expect(get.body).toMatchObject({ status: 'FAILED', errorCode: '10003' });

    const broken = await ctx.http().post('/v1/webhooks/uzum/create').set('Authorization', UZUM_AUTH).set('Content-Type', 'application/json').send('{"serviceId": 101202,');
    expect(broken.status).toBe(400);
    expect(broken.body).toMatchObject({ status: 'FAILED', errorCode: '10002' });
    const logged = await q(ctx, "SELECT payload FROM payment_events WHERE provider = 'uzum' AND processing_error = '10002' ORDER BY received_at DESC LIMIT 1");
    expect(logged[0]!.payload).toEqual({ invalid_json: '{"serviceId": 101202,' });

    // Xatolar booking'ga tegmadi
    expect(await status('bookings', id)).toBe('pending_payment');
    expect(await q(ctx, "SELECT status FROM payments WHERE booking_id = $1 AND provider = 'uzum'", [id])).toEqual([{ status: 'created' }]);
  });

  it("reverse: CREATED -> to'lov bekor, hold ozod; takroriy reverse -> 10018, keyin confirm -> 10015", async () => {
    const booking = (await q(ctx, "SELECT b.id FROM bookings b JOIN users u ON u.id = b.user_id WHERE u.phone_e164 = '+998902000009' AND b.match_id = $1", [matchId]))[0]!.id;
    const transId = uuid();
    await uzum(ctx, 'create', { transId, params: { booking_id: booking }, amount: PRICE });
    const before = await slots();

    const rv = await uzum(ctx, 'reverse', { transId });
    expect(rv).toMatchObject({ status: 200, body: { transId, status: 'REVERSED', amount: PRICE } });
    expect((await paymentByTx(transId))!).toMatchObject({ status: 'cancelled', provider_state: { state: 'REVERSED', reverse_time: rv.body.reverseTime } });
    expect(await status('bookings', booking)).toBe('cancelled');
    expect((await slots()).held_slots).toBe(before.held_slots - 1);
    expect(await q(ctx, 'SELECT id FROM refunds WHERE booking_id = $1', [booking])).toEqual([]);

    expect(await uzum(ctx, 'reverse', { transId })).toMatchObject({ status: 400, body: { errorCode: '10018', reverseTime: rv.body.reverseTime } });
    expect((await uzum(ctx, 'confirm', confirmBody(transId))).body.errorCode).toBe('10015');
    expect((await uzum(ctx, 'status', { transId })).body).toMatchObject({ status: 'REVERSED', reverseTime: rv.body.reverseTime });
    expect((await slots()).held_slots).toBe(before.held_slots - 1);
  });

  it("reverse: CONFIRMED va o'yin boshlanmagan -> refund, joy qaytadi; takroriy -> 10018", async () => {
    const { s, id } = await book('+998902000023');
    const transId = uuid();
    await uzum(ctx, 'create', { transId, params: { booking_id: id }, amount: PRICE });
    await uzum(ctx, 'confirm', confirmBody(transId));
    const before = await slots();

    const rv = await uzum(ctx, 'reverse', { transId });
    expect(rv).toMatchObject({ status: 200, body: { status: 'REVERSED', amount: PRICE } });
    expect(await status('bookings', id)).toBe('cancelled');
    expect((await paymentByTx(transId))!).toMatchObject({ status: 'refunded', provider_state: { state: 'REVERSED' } });
    expect(await q(ctx, 'SELECT destination, status, amount, reason, provider_refund_id FROM refunds WHERE booking_id = $1', [id])).toEqual([
      { destination: 'original_method', status: 'succeeded', amount: PRICE, reason: 'provider_cancel', provider_refund_id: transId },
    ]);
    expect((await slots()).confirmed_slots).toBe(before.confirmed_slots - 1);

    expect((await uzum(ctx, 'reverse', { transId })).body.errorCode).toBe('10018');
    expect(await q(ctx, 'SELECT count(*)::int AS n FROM refunds WHERE booking_id = $1', [id])).toEqual([{ n: 1 }]);
    expect((await slots()).confirmed_slots).toBe(before.confirmed_slots - 1);
    const b = await ctx.http().get(`/v1/bookings/${id}`).set(s.auth).expect(200);
    expect(b.body.status).toBe('cancelled');
  });

  it("joy yo'q: hold muddati o'tgan va match to'lgan -> check/create 10009 (pul yechilmaydi); joy bo'lsa — qayta hold", async () => {
    const seats = ctx.app.get(SeatsService);
    const { id } = await book('+998902000024');
    const params = { booking_id: id };
    await q(ctx, "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
    await seats.expireDue();
    expect(await status('bookings', id)).toBe('expired');

    // Joy bor — check qayta hold qiladi
    expect((await uzum(ctx, 'check', { params })).status).toBe(200);
    expect(await status('bookings', id)).toBe('pending_payment');

    // Yana muddati o'tadi va boshqalar barcha joyni egallaydi
    await q(ctx, "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
    await seats.expireDue();
    const before = await slots();
    await q(ctx, 'UPDATE matches SET held_slots = max_players - confirmed_slots WHERE id = $1', [matchId]);
    try {
      expect((await uzum(ctx, 'check', { params })).body.errorCode).toBe('10009');
      const transId = uuid();
      expect(await uzum(ctx, 'create', { transId, params, amount: PRICE })).toMatchObject({ status: 400, body: { errorCode: '10009' } });
      expect(await paymentByTx(transId)).toBeUndefined();
      expect(await status('bookings', id)).toBe('expired');
    } finally {
      await q(ctx, 'UPDATE matches SET held_slots = $2 WHERE id = $1', [matchId, before.held_slots]);
    }
  });

  it("confirm paytida joy qolmagan -> FAILED (10015), to'lov bekor, Uzum pulni qaytaradi; status -> FAILED", async () => {
    const seats = ctx.app.get(SeatsService);
    const id = (await q(ctx, "SELECT b.id FROM bookings b JOIN users u ON u.id = b.user_id WHERE u.phone_e164 = '+998902000024' AND b.match_id = $1", [matchId]))[0]!.id;
    const transId = uuid();
    // Joy bor: create qayta hold qiladi
    expect((await uzum(ctx, 'create', { transId, params: { booking_id: id }, amount: PRICE })).status).toBe(200);
    await q(ctx, "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
    await seats.expireDue();
    const before = await slots();
    await q(ctx, 'UPDATE matches SET held_slots = max_players - confirmed_slots WHERE id = $1', [matchId]);
    try {
      const cf = await uzum(ctx, 'confirm', confirmBody(transId));
      expect(cf).toMatchObject({ status: 400, body: { status: 'FAILED', errorCode: '10015' } });
      expect((await paymentByTx(transId))!).toMatchObject({ status: 'cancelled', failure_code: 'no_seat', provider_state: { state: 'FAILED' } });
      expect(await status('bookings', id)).toBe('expired');
      expect(await uzum(ctx, 'status', { transId })).toMatchObject({ status: 400, body: { status: 'FAILED', errorCode: '10015', confirmTime: null } });
    } finally {
      await q(ctx, 'UPDATE matches SET held_slots = $2 WHERE id = $1', [matchId, before.held_slots]);
    }
  });

  it("30 daqiqada confirm kelmasa — FAILED: status 10015, kech confirm 10015, hold ozod", async () => {
    const { id } = await book('+998902000028');
    const transId = uuid();
    await uzum(ctx, 'create', { transId, params: { booking_id: id }, amount: PRICE });
    const before = await slots();
    await q(
      ctx,
      "UPDATE payments SET provider_state = jsonb_set(provider_state, '{trans_time}', to_jsonb((extract(epoch from now()) * 1000)::bigint - 31 * 60000)) WHERE provider = 'uzum' AND provider_transaction_id = $1",
      [transId],
    );
    expect(await uzum(ctx, 'status', { transId })).toMatchObject({ status: 400, body: { status: 'FAILED', errorCode: '10015' } });
    expect((await paymentByTx(transId))!).toMatchObject({ status: 'cancelled', failure_code: 'confirm_timeout' });
    expect(await status('bookings', id)).toBe('cancelled');
    expect((await slots()).held_slots).toBe(before.held_slots - 1);
    expect((await uzum(ctx, 'confirm', confirmBody(transId))).body.errorCode).toBe('10015');
    expect((await uzum(ctx, 'reverse', { transId })).body.errorCode).toBe('10018');
  });

  it("ikki marta to'lov yo'q: booking Payme bilan to'langan -> Uzum confirm rad etiladi (10015)", async () => {
    const { id } = await book('+998902000029');
    const params = { booking_id: id };
    const transId = uuid();
    expect((await uzum(ctx, 'create', { transId, params, amount: PRICE })).status).toBe(200);

    // Mijoz parallel ravishda Payme bilan to'ladi
    const paymeId = createHash('md5').update(`uzum-double-${id}`).digest('hex').slice(0, 24);
    const pp = { amount: PRICE, account: { booking_id: id } };
    expect((await payme(ctx, 'CreateTransaction', { id: paymeId, time: Date.now(), ...pp })).result).toMatchObject({ state: 1 });
    expect((await payme(ctx, 'PerformTransaction', { id: paymeId })).result).toMatchObject({ state: 2 });
    expect(await status('bookings', id)).toBe('confirmed');
    const before = await slots();

    const cf = await uzum(ctx, 'confirm', confirmBody(transId));
    expect(cf).toMatchObject({ status: 400, body: { status: 'FAILED', errorCode: '10015' } });
    expect((await paymentByTx(transId))!).toMatchObject({ status: 'cancelled', failure_code: 'already_paid', provider_state: { state: 'FAILED' } });
    expect(await status('bookings', id)).toBe('confirmed');
    expect(await q(ctx, "SELECT provider FROM payments WHERE booking_id = $1 AND status = 'succeeded'", [id])).toEqual([{ provider: 'payme' }]);
    expect(await slots()).toEqual(before);
    expect((await uzum(ctx, 'check', { params })).body.errorCode).toBe('10008');
  });

  it("reverse: o'yin boshlangan bo'lsa -> 10017 (xizmat ko'rsatilgan)", async () => {
    const tx = (await q(ctx, "SELECT p.provider_transaction_id FROM payments p JOIN users u ON u.id = p.user_id WHERE p.provider = 'uzum' AND p.status = 'succeeded' AND u.phone_e164 = '+998902000004'"))[0]!.provider_transaction_id;
    const orig = (await q(ctx, 'SELECT starts_at, ends_at, booking_closes_at, min_players_deadline FROM matches WHERE id = $1', [matchId]))[0]!;
    await q(
      ctx,
      "UPDATE matches SET starts_at = now() - interval '10 minutes', ends_at = now() + interval '50 minutes', booking_closes_at = now() - interval '1 hour', min_players_deadline = now() - interval '2 hours' WHERE id = $1",
      [matchId],
    );
    try {
      expect(await uzum(ctx, 'reverse', { transId: tx })).toMatchObject({ status: 400, body: { status: 'FAILED', errorCode: '10017' } });
      expect((await paymentByTx(tx))!.status).toBe('succeeded');
    } finally {
      await q(ctx, 'UPDATE matches SET starts_at = $2, ends_at = $3, booking_closes_at = $4, min_players_deadline = $5 WHERE id = $1', [
        matchId,
        orig.starts_at,
        orig.ends_at,
        orig.booking_closes_at,
        orig.min_players_deadline,
      ]);
    }
  });
});
