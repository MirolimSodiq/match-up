import { createTestApp, device, login, type TestCtx } from './helpers';

describe('Auth & profil', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('yangi telefon: OTP -> yangi user, onboarding talab qilinadi', async () => {
    const phone = '+998935550101';
    const r = await ctx.http().post('/v1/auth/otp/request').send({ phone: '+998 93 555 01 01' }).expect(200);
    expect(r.body).toMatchObject({ expires_in: 300, resend_after: 1 });
    const code = ctx.otp.codes.get(phone)!;
    const v = await ctx
      .http()
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: r.body.challenge_id, code, device })
      .expect(200);
    expect(v.body.is_new_user).toBe(true);
    expect(v.body.token_type).toBe('Bearer');
    expect(v.body.user).toMatchObject({ phone, roles: ['player'], country_code: 'UZ', onboarded: false });
  });

  it("noto'g'ri kod -> OTP_INVALID, 5 urinishdan keyin bloklanadi", async () => {
    const phone = '+998935550102';
    const r = await ctx.http().post('/v1/auth/otp/request').send({ phone }).expect(200);
    for (let i = 0; i < 5; i++) {
      const bad = await ctx
        .http()
        .post('/v1/auth/otp/verify')
        .set('Accept-Language', 'ru')
        .send({ challenge_id: r.body.challenge_id, code: '000000', device })
        .expect(400);
      expect(bad.headers['content-type']).toContain('application/problem+json');
      expect(bad.body).toMatchObject({ code: 'OTP_INVALID', status: 400, detail: 'Неверный код' });
    }
    const blocked = await ctx
      .http()
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: r.body.challenge_id, code: ctx.otp.codes.get(phone), device })
      .expect(429);
    expect(blocked.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('qayta yuborish cooldown -> 429 + Retry-After', async () => {
    const phone = '+998935550103';
    await ctx.http().post('/v1/auth/otp/request').send({ phone }).expect(200);
    const again = await ctx.http().post('/v1/auth/otp/request').send({ phone }).expect(429);
    expect(again.body.code).toBe('RATE_LIMITED');
    expect(Number(again.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('validatsiya xatosi -> 422 Problem Details maydonlar bilan', async () => {
    const r = await ctx.http().post('/v1/auth/otp/request').send({ phone: '12345' }).expect(422);
    expect(r.body).toMatchObject({ code: 'VALIDATION_FAILED', errors: [expect.objectContaining({ field: 'phone' })] });
  });

  it('refresh rotation va eski token qayta ishlatilsa butun sessiya bekor', async () => {
    const s = await login(ctx, '+998935550104');
    const r1 = await ctx.http().post('/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(200);
    expect(r1.body.refresh_token).not.toBe(s.refresh);
    // Eski token qayta -> TOKEN_REUSED, yangi token ham yaroqsiz bo'ladi
    const reuse = await ctx.http().post('/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(401);
    expect(reuse.body.code).toBe('TOKEN_REUSED');
    await ctx.http().post('/v1/auth/refresh').send({ refresh_token: r1.body.refresh_token }).expect(401);
  });

  it('logout sessiya family\'sini bekor qiladi', async () => {
    const s = await login(ctx, '+998935550105');
    await ctx.http().post('/v1/auth/logout').set(s.auth).expect(204);
    await ctx.http().post('/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(401);
  });

  it('token yo\'q -> 401; seed player kiradi va profilni yangilaydi', async () => {
    await ctx.http().get('/v1/me').expect(401);
    const s = await login(ctx, '+998902000001');
    const me = await ctx.http().get('/v1/me').set(s.auth).expect(200);
    expect(me.body).toMatchObject({ display_name: 'Player 1', onboarded: true });
    expect(me.body.sports[0]).toMatchObject({ sport: 'football' });

    const upd = await ctx
      .http()
      .patch('/v1/me')
      .set(s.auth)
      .send({ display_name: 'Jasur', locale: 'ru', birth_date: '1998-05-14' })
      .expect(200);
    expect(upd.body).toMatchObject({ display_name: 'Jasur', locale: 'ru', birth_date: '1998-05-14' });

    await ctx.http().patch('/v1/me').set(s.auth).send({ home_city_id: 9999 }).expect(422);
    await ctx.http().put('/v1/me/sports/basketball').set(s.auth).send({ self_level: 'advanced' }).expect(200);
    const c = await ctx
      .http()
      .put('/v1/me/consents')
      .set(s.auth)
      .send({ consents: [{ purpose: 'marketing_push', granted: false, document_version: 'privacy-2026-10' }] })
      .expect(200);
    expect(c.body).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'marketing_push', granted: false })]));
  });

  it("GDPR: eksport va o'chirish so'rovlari", async () => {
    const s = await login(ctx, '+998935550106');
    const exp = await ctx.http().post('/v1/me/data-export').set(s.auth).expect(202);
    expect(exp.body).toMatchObject({ type: 'export', status: 'received' });
    await ctx.http().delete('/v1/me').set(s.auth).expect(202);
    const dup = await ctx.http().delete('/v1/me').set(s.auth).expect(409);
    expect(dup.body.code).toBe('ERASURE_PENDING');
  });
});
