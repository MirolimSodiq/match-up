import { WalletService } from '../src/commerce/wallet.service';
import { DB, type Db } from '../src/db/db';
import { createTestApp, login, matchId, q, type TestCtx } from './helpers';

describe('Hamyon balansi (GET /v1/me/wallet)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  async function credit(userId: string, currency: string, amount: number) {
    await ctx.app.get(WalletService).credit(ctx.app.get<Db>(DB), { userId, currency, amount, type: 'promo_credit' });
  }

  it("token yo'q -> 401", async () => {
    const r = await ctx.http().get('/v1/me/wallet').expect(401);
    expect(r.body.code).toBe('UNAUTHORIZED');
  });

  it("hamyon hali ochilmagan -> asosiy valyutada 0 (shahar tanlanmagan: davlat valyutasi)", async () => {
    const s = await login(ctx, '+998935559901');
    const r = await ctx.http().get('/v1/me/wallet').set(s.auth).expect(200);
    const zero = { amount: 0, currency: 'UZS', formatted: "0 so'm" };
    expect(r.body).toEqual({ balance: zero, balances: [zero] });
  });

  it("balans Accept-Language bo'yicha formatlanadi, asosiy valyuta birinchi", async () => {
    const s = await login(ctx, '+998935559902');
    const [tashkent] = await q<{ id: number }>(ctx, "SELECT id FROM cities WHERE slug = 'tashkent'");
    await ctx.http().patch('/v1/me').set(s.auth).send({ home_city_id: tashkent!.id }).expect(200);
    await credit(s.userId, 'USD', 1250);
    await credit(s.userId, 'UZS', 4500000);

    const ru = await ctx.http().get('/v1/me/wallet').set(s.auth).set('Accept-Language', 'ru').expect(200);
    expect(ru.body.balance).toEqual({ amount: 4500000, currency: 'UZS', formatted: '45\u00a0000 сум' });

    const en = await ctx.http().get('/v1/me/wallet').set(s.auth).set('Accept-Language', 'en').expect(200);
    expect(en.body.balances).toEqual([
      { amount: 4500000, currency: 'UZS', formatted: '45,000 UZS' },
      { amount: 1250, currency: 'USD', formatted: '$12.50' },
    ]);

    // payment-methods dagi wallet_balance bilan bir xil manba
    const race = await matchId(ctx, 'MU-RACE');
    const pm = await ctx.http().get(`/v1/payment-methods?match_id=${race}`).set(s.auth).expect(200);
    expect(pm.body.wallet_balance).toEqual({ amount: 4500000, currency: 'UZS', formatted: "45\u00a0000 so'm" });
  });
});
