import { SeatsService } from '../src/commerce/seats.service';
import {
  bookAndPayWithPayme,
  createTestApp,
  login,
  matchId,
  payme,
  q,
  signatureId,
  uuid,
  type Session,
  type TestCtx,
} from './helpers';

describe('Discovery -> waiver -> booking -> Payme', () => {
  let ctx: TestCtx;
  let p2: Session;
  let race: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    p2 = await login(ctx, '+998902000002');
    race = await matchId(ctx, 'MU-RACE');
  });
  afterAll(() => ctx.close());

  it('discovery: radius, sport filtri, keyset pagination', async () => {
    const r = await ctx.http().get('/v1/matches?lat=41.2995&lng=69.2401&radius_km=15&sport=football,basketball').expect(200);
    const codes = r.body.items.map((m: { public_code: string }) => m.public_code);
    expect(codes).toEqual(expect.arrayContaining(['MU-RACE', 'MU-YUN5']));
    expect(codes).not.toContain('MU-SAM1'); // Samarqand — radiusdan tashqarida
    expect(codes).not.toContain('MU-DRFT'); // draft
    const m = r.body.items.find((x: { public_code: string }) => x.public_code === 'MU-RACE');
    expect(m).toMatchObject({
      format: '7v7',
      price: { amount: 4500000, currency: 'UZS', formatted: "45 000 so'm" },
      slots: { max: 14, min_to_play: 10 },
      venue: { name: 'Chilonzor Arena' },
    });
    expect(m.venue.distance_m).toBeGreaterThan(3000);

    const page1 = await ctx.http().get('/v1/matches?lat=41.2995&lng=69.2401&radius_km=15&limit=1').expect(200);
    expect(page1.body.items).toHaveLength(1);
    const page2 = await ctx.http().get(`/v1/matches?lat=41.2995&lng=69.2401&radius_km=15&limit=1&cursor=${page1.body.next_cursor}`).expect(200);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);

    const byDistance = await ctx.http().get('/v1/matches?lat=41.2995&lng=69.2401&radius_km=15&sort=distance').expect(200);
    const d = byDistance.body.items.map((x: { venue: { distance_m: number } }) => x.venue.distance_m);
    expect([...d].sort((a: number, b: number) => a - b)).toEqual(d);

    await ctx.http().get('/v1/matches?lat=100&lng=69').expect(422);
  });

  it('match detail: public_code bilan, auth ixtiyoriy, rus tilida', async () => {
    const anon = await ctx.http().get('/v1/matches/mu-race').set('Accept-Language', 'ru').expect(200);
    expect(anon.body).toMatchObject({ id: race, waiver: { required: true, signed: null }, my_booking: null });
    expect(anon.body.price.formatted).toBe('45 000 сум');
    expect(anon.body.cancellation_policy.summary).toContain('24 ч');
    const authed = await ctx.http().get(`/v1/matches/${race}`).set(p2.auth).expect(200);
    expect(authed.body.waiver.signed).toBe(true);
  });

  it("yangi foydalanuvchi waiver'ni imzolaydi (hash tekshiruvi bilan)", async () => {
    const s = await login(ctx, '+998935550201');
    const req = await ctx.http().get(`/v1/waivers/required?match_id=${race}`).set(s.auth).expect(200);
    expect(req.body).toMatchObject({ signed: false, signature_id: null, template: { code: 'general_liability', version: 1 } });
    const tpl = req.body.template;
    const bad = await ctx
      .http()
      .post(`/v1/waivers/${tpl.id}/signatures`)
      .set(s.auth)
      .send({ accepted: true, method: 'clickwrap', document_sha256: '0'.repeat(64) })
      .expect(409);
    expect(bad.body.code).toBe('WAIVER_OUTDATED');
    const ok = await ctx
      .http()
      .post(`/v1/waivers/${tpl.id}/signatures`)
      .set(s.auth)
      .send({ accepted: true, method: 'clickwrap', document_sha256: tpl.document_sha256, match_id: race })
      .expect(201);
    expect(ok.body.signature_id).toBeDefined();
    const after = await ctx.http().get(`/v1/waivers/required?match_id=${race}`).set(s.auth).expect(200);
    expect(after.body).toMatchObject({ signed: true, signature_id: ok.body.signature_id });
  });

  it("to'lov usullari: wallet + Payme + Click (priority bo'yicha)", async () => {
    const r = await ctx.http().get(`/v1/payment-methods?match_id=${race}`).set(p2.auth).expect(200);
    expect(r.body.methods.map((m: { provider: string }) => m.provider)).toEqual(['wallet', 'payme', 'click']);
    expect(r.body.wallet_balance.amount).toBe(0);
  });

  it("booking: Idempotency-Key majburiy, takror so'rov o'sha booking'ni qaytaradi, ikkinchi booking — ALREADY_BOOKED", async () => {
    const sig = await signatureId(ctx, p2, race);
    const body = { match_id: race, payment_method: 'payme', waiver_signature_id: sig, return_url: 'https://app.matchup.example/return' };
    await ctx.http().post('/v1/bookings').set(p2.auth).send(body).expect(422);

    const key = uuid();
    const r1 = await ctx.http().post('/v1/bookings').set(p2.auth).set('Idempotency-Key', key).send(body).expect(201);
    expect(r1.body.booking).toMatchObject({ status: 'pending_payment', seats: 1, total: { amount: 4500000 } });
    expect(r1.body.checkout.type).toBe('redirect');
    const decoded = Buffer.from(r1.body.checkout.url.split('/').pop(), 'base64').toString();
    expect(decoded).toContain(`ac.booking_id=${r1.body.booking.id}`);
    expect(decoded).toContain('a=4500000');

    const r2 = await ctx.http().post('/v1/bookings').set(p2.auth).set('Idempotency-Key', key).send(body).expect(201);
    expect(r2.body.booking.id).toBe(r1.body.booking.id);

    const other = await matchId(ctx, 'MU-YUN5');
    const conflict = await ctx.http().post('/v1/bookings').set(p2.auth).set('Idempotency-Key', key).send({ ...body, match_id: other }).expect(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const dup = await ctx.http().post('/v1/bookings').set(p2.auth).set('Idempotency-Key', uuid()).send(body).expect(409);
    expect(dup.body.code).toBe('ALREADY_BOOKED');

    const m = (await q(ctx, 'SELECT held_slots, confirmed_slots FROM matches WHERE id = $1', [race]))[0]!;
    expect(m).toEqual({ held_slots: 1, confirmed_slots: 0 });
  });

  it('Payme: auth, summa va buyurtma xatolari', async () => {
    const booking = (await q(ctx, "SELECT b.id FROM bookings b JOIN users u ON u.id = b.user_id WHERE u.phone_e164 = '+998902000002'"))[0]!;
    const params = { amount: 4500000, account: { booking_id: booking.id } };
    expect((await payme(ctx, 'CheckPerformTransaction', params, 'Basic ' + Buffer.from('Paycom:wrong').toString('base64'))).error?.code).toBe(-32504);
    expect((await payme(ctx, 'CheckPerformTransaction', { ...params, amount: 100 })).error?.code).toBe(-31001);
    const nf = await payme(ctx, 'CheckPerformTransaction', { amount: 1, account: { booking_id: uuid() } });
    expect(nf.error).toMatchObject({ code: -31050, data: 'booking_id' });
    expect(nf.error?.message).toMatchObject({ uz: 'Buyurtma topilmadi', ru: 'Заказ не найден' });
    expect((await payme(ctx, 'NoSuchMethod', {})).error?.code).toBe(-32601);
    expect((await payme(ctx, 'PerformTransaction', { id: 'nope' })).error?.code).toBe(-31003);
  });

  it("Payme to'liq oqim: Create (idempotent) -> Perform (idempotent) -> chipta -> statement -> refund", async () => {
    const booking = (await q(ctx, "SELECT b.id FROM bookings b JOIN users u ON u.id = b.user_id WHERE u.phone_e164 = '+998902000002'"))[0]!;
    const params = { amount: 4500000, account: { booking_id: booking.id } };
    expect((await payme(ctx, 'CheckPerformTransaction', params)).result).toEqual({ allow: true });

    const c1 = await payme(ctx, 'CreateTransaction', { id: 'pm-tx-0001', time: Date.now(), ...params });
    expect(c1.result).toMatchObject({ state: 1 });
    const c2 = await payme(ctx, 'CreateTransaction', { id: 'pm-tx-0001', time: Date.now(), ...params });
    expect(c2.result).toEqual(c1.result);
    // Boshqa Payme tranzaksiyasi shu booking uchun — band
    expect((await payme(ctx, 'CreateTransaction', { id: 'pm-tx-0002', time: Date.now(), ...params })).error?.code).toBe(-31053);

    const p1 = await payme(ctx, 'PerformTransaction', { id: 'pm-tx-0001' });
    expect(p1.result).toMatchObject({ state: 2, transaction: c1.result!.transaction });
    const p2r = await payme(ctx, 'PerformTransaction', { id: 'pm-tx-0001' });
    expect(p2r.result).toEqual(p1.result);

    const bk = await ctx.http().get(`/v1/bookings/${booking.id}`).set(p2.auth).expect(200);
    expect(bk.body).toMatchObject({ status: 'confirmed', expires_at: null });
    const m = (await q(ctx, 'SELECT held_slots, confirmed_slots FROM matches WHERE id = $1', [race]))[0]!;
    expect(m).toEqual({ held_slots: 0, confirmed_slots: 1 });
    const outbox = await q(ctx, "SELECT event_type FROM outbox_events WHERE aggregate_id = $1 ORDER BY created_at", [booking.id]);
    expect(outbox.map((e) => e.event_type)).toEqual(['BookingHeld', 'BookingConfirmed']);

    const ct = await payme(ctx, 'CheckTransaction', { id: 'pm-tx-0001' });
    expect(ct.result).toMatchObject({ state: 2, cancel_time: 0, reason: null, perform_time: p1.result!.perform_time });

    const ticket = await ctx.http().get(`/v1/bookings/${booking.id}/ticket`).set(p2.auth).expect(200);
    expect(ticket.body.tickets).toHaveLength(1);
    expect(ticket.body.tickets[0].qr_payload).toMatch(/^mu1\.[\w-]+\.[\w-]+$/);

    const st = await payme(ctx, 'GetStatement', { from: Date.now() - 60_000, to: Date.now() + 1000 });
    expect(st.result!.transactions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'pm-tx-0001', state: 2, account: { booking_id: booking.id } })]),
    );

    // Payme kabinetidan refund: state 2 -> -2, joy qaytadi
    const cancel = await payme(ctx, 'CancelTransaction', { id: 'pm-tx-0001', reason: 5 });
    expect(cancel.result).toMatchObject({ state: -2 });
    expect((await payme(ctx, 'CancelTransaction', { id: 'pm-tx-0001', reason: 5 })).result).toEqual(cancel.result);
    const after = (await q(ctx, 'SELECT status FROM bookings WHERE id = $1', [booking.id]))[0]!;
    expect(after.status).toBe('cancelled');
    const refund = (await q(ctx, 'SELECT destination, status, amount FROM refunds WHERE booking_id = $1', [booking.id]))[0]!;
    expect(refund).toEqual({ destination: 'original_method', status: 'succeeded', amount: 4500000 });
    expect((await q(ctx, 'SELECT confirmed_slots FROM matches WHERE id = $1', [race]))[0]!.confirmed_slots).toBe(0);
  });

  it('late payment: hold muddati o\'tgan bo\'lsa joy bor ekan — qayta hold; joy yo\'q bo\'lsa pul yechilmaydi', async () => {
    const seats = ctx.app.get(SeatsService);
    const p3 = await login(ctx, '+998902000003');
    const b = await ctx
      .http()
      .post('/v1/bookings')
      .set(p3.auth)
      .set('Idempotency-Key', uuid())
      .send({ match_id: race, payment_method: 'payme', waiver_signature_id: await signatureId(ctx, p3, race) })
      .expect(201);
    const id = b.body.booking.id;
    await q(ctx, "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
    expect(await seats.expireDue()).toBeGreaterThanOrEqual(1);
    expect((await q(ctx, 'SELECT status FROM bookings WHERE id = $1', [id]))[0]!.status).toBe('expired');

    const params = { amount: 4500000, account: { booking_id: id } };
    expect((await payme(ctx, 'CheckPerformTransaction', params)).result).toEqual({ allow: true });
    expect((await q(ctx, 'SELECT status FROM bookings WHERE id = $1', [id]))[0]!.status).toBe('pending_payment');

    // Yana muddati o'tadi va match to'ladi -> Payme'ga "joy qolmadi" (pul yechilmaydi)
    await q(ctx, "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
    await seats.expireDue();
    // Boshqalar barcha bo'sh joylarni egalladi (simulyatsiya)
    const before = (await q(ctx, 'SELECT held_slots FROM matches WHERE id = $1', [race]))[0]!.held_slots;
    await q(ctx, 'UPDATE matches SET held_slots = max_players - confirmed_slots WHERE id = $1', [race]);
    expect((await payme(ctx, 'CheckPerformTransaction', params)).error?.code).toBe(-31052);
    await q(ctx, 'UPDATE matches SET held_slots = $2 WHERE id = $1', [race, before]);
  });

  it("o'yinchi bekor qiladi -> 100% hamyonga -> hamyon bilan qayta band qiladi (darhol confirmed)", async () => {
    const p5 = await login(ctx, '+998902000005');
    const { bookingId } = await bookAndPayWithPayme(ctx, p5, race);
    const c = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set(p5.auth)
      .set('Idempotency-Key', uuid())
      .send({ refund_destination: 'wallet', reason: 'plans changed' })
      .expect(200);
    expect(c.body.booking.status).toBe('cancelled');
    expect(c.body.refund).toMatchObject({ amount: { amount: 4500000 }, destination: 'wallet', status: 'succeeded' });

    const methods = await ctx.http().get(`/v1/payment-methods?match_id=${race}`).set(p5.auth).expect(200);
    expect(methods.body.wallet_balance.amount).toBe(4500000);

    const w = await ctx
      .http()
      .post('/v1/bookings')
      .set(p5.auth)
      .set('Idempotency-Key', uuid())
      .send({ match_id: race, payment_method: 'wallet', waiver_signature_id: await signatureId(ctx, p5, race) })
      .expect(201);
    expect(w.body.booking).toMatchObject({ status: 'confirmed', total: { amount: 0 }, wallet_applied: { amount: 4500000 } });
    expect(w.body.checkout).toEqual({ type: 'none' });
    const after = await ctx.http().get(`/v1/payment-methods?match_id=${race}`).set(p5.auth).expect(200);
    expect(after.body.wallet_balance.amount).toBe(0);

    const mine = await ctx.http().get('/v1/me/bookings?scope=upcoming').set(p5.auth).expect(200);
    expect(mine.body.items.map((b: { status: string }) => b.status)).toEqual(['confirmed']);
    const past = await ctx.http().get('/v1/me/bookings?scope=past').set(p5.auth).expect(200);
    expect(past.body.items.map((b: { status: string }) => b.status)).toEqual(['cancelled']);
  });
});
