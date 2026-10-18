import { clickSign, createTestApp, login, matchId, q, signatureId, uuid, type TestCtx } from './helpers';

describe('Click SHOP API', () => {
  let ctx: TestCtx;
  let yun: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    yun = await matchId(ctx, 'MU-YUN5');
  });
  afterAll(() => ctx.close());

  async function book(phone: string) {
    const s = await login(ctx, phone);
    const r = await ctx
      .http()
      .post('/v1/bookings')
      .set(s.auth)
      .set('Idempotency-Key', uuid())
      .send({ match_id: yun, payment_method: 'click', waiver_signature_id: await signatureId(ctx, s, yun) })
      .expect(201);
    expect(r.body.checkout.url).toContain('https://my.click.uz/services/pay?');
    expect(r.body.checkout.url).toContain('amount=35000.00');
    return { s, booking: r.body.booking };
  }

  function form(p: Record<string, string>) {
    return Object.entries(p)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  async function call(path: 'prepare' | 'complete', p: Record<string, string>) {
    const res = await ctx.http().post(`/v1/webhooks/click/${path}`).type('form').send(form(p)).expect(200);
    return res.body as Record<string, any>;
  }

  it('Prepare -> Complete: booking tasdiqlanadi; takroriy Complete -> -4', async () => {
    const { booking } = await book('+998902000006');
    const base = {
      click_trans_id: '900000001',
      service_id: '1000',
      click_paydoc_id: '777001',
      merchant_trans_id: booking.id,
      amount: '35000.00',
      error: '0',
      error_note: 'Success',
      sign_time: '2026-10-18 12:00:00',
    };
    const prep = { ...base, action: '0' };
    expect(await call('prepare', { ...prep, sign_string: 'bad'.padEnd(32, '0') })).toMatchObject({ error: -1 });
    expect(await call('prepare', { ...prep, amount: '1000.00', sign_string: clickSign({ ...prep, amount: '1000.00' }, false) })).toMatchObject({ error: -2 });

    const p = await call('prepare', { ...prep, sign_string: clickSign(prep, false) });
    expect(p).toMatchObject({ error: 0, merchant_prepare_id: 900000001, merchant_trans_id: booking.id });

    const comp = { ...base, action: '1', merchant_prepare_id: String(p.merchant_prepare_id) };
    const c = await call('complete', { ...comp, sign_string: clickSign(comp, true) });
    expect(c).toMatchObject({ error: 0, merchant_confirm_id: 900000001 });
    expect((await q(ctx, 'SELECT status FROM bookings WHERE id = $1', [booking.id]))[0]!.status).toBe('confirmed');
    expect((await q(ctx, "SELECT status FROM payments WHERE provider = 'click' AND provider_transaction_id = '900000001'"))[0]!.status).toBe('succeeded');

    const again = await call('complete', { ...comp, sign_string: clickSign(comp, true) });
    expect(again.error).toBe(-4);
  });

  it("Click tomonda xato (error < 0) -> to'lov bekor, hold ozod qilinadi", async () => {
    const { booking } = await book('+998902000007');
    const held = (await q(ctx, 'SELECT held_slots FROM matches WHERE id = $1', [yun]))[0]!.held_slots;
    const base = { click_trans_id: '900000002', service_id: '1000', merchant_trans_id: booking.id, amount: '35000.00', sign_time: '2026-10-18 12:05:00' };
    const prep = { ...base, action: '0', error: '0' };
    await call('prepare', { ...prep, sign_string: clickSign(prep, false) });
    const comp = { ...base, action: '1', error: '-5017', error_note: 'Insufficient funds', merchant_prepare_id: '900000002' };
    expect(await call('complete', { ...comp, sign_string: clickSign(comp, true) })).toMatchObject({ error: -9 });
    expect((await q(ctx, 'SELECT status FROM bookings WHERE id = $1', [booking.id]))[0]!.status).toBe('cancelled');
    expect((await q(ctx, 'SELECT held_slots FROM matches WHERE id = $1', [yun]))[0]!.held_slots).toBe(held - 1);
  });
});
