import { createHash, createHmac, generateKeyPairSync, type KeyObject, randomUUID, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SocialAuthService } from '../src/identity/social/social.service';
import { createTestApp, device, login, q, type Session, type TestCtx } from './helpers';

// ---------------------------------------------------------------------------
// Test JWKS server va token imzolash
// ---------------------------------------------------------------------------
type Alg = 'RS256' | 'ES256';
interface TestKey {
  kid: string;
  alg: Alg;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

function makeKey(alg: Alg, kid = randomUUID()): TestKey {
  const pair = alg === 'RS256' ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { kid, alg, ...pair };
}

function signJwt(k: TestKey, claims: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const h = b64(JSON.stringify({ alg: k.alg, kid: k.kid, typ: 'JWT', ...header }));
  const p = b64(JSON.stringify(claims));
  const data = Buffer.from(`${h}.${p}`);
  const sig = sign('sha256', data, k.alg === 'ES256' ? { key: k.privateKey, dsaEncoding: 'ieee-p1363' } : k.privateKey);
  return `${h}.${p}.${b64(sig)}`;
}

const GOOGLE_AUD = 'e2e-google-ios.apps.googleusercontent.com';
const APPLE_AUD = 'uz.matchup.player';
const BOT_TOKEN = '123456789:e2e-telegram-bot-secret';

function telegramAuth(fields: Record<string, string | number>, token = BOT_TOKEN) {
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const hash = createHmac('sha256', createHash('sha256').update(token).digest()).update(check).digest('hex');
  return { ...fields, hash };
}

describe('Social login (Google / Apple / Telegram) va identity bog\'lash', () => {
  let ctx: TestCtx;
  let server: Server;
  let base: string;
  const googleKeys: TestKey[] = [makeKey('RS256')];
  const appleKeys: TestKey[] = [makeKey('ES256')];
  const hits = { google: 0, apple: 0 };

  const google = (claims: Record<string, unknown> = {}, key = googleKeys[0]!) =>
    signJwt(key, {
      iss: 'https://accounts.google.com',
      aud: GOOGLE_AUD,
      sub: `g-${randomUUID()}`,
      email: 'jasur@gmail.com',
      email_verified: true,
      name: 'Jasur Karimov',
      given_name: 'Jasur',
      family_name: 'Karimov',
      iat: now(),
      exp: now() + 3600,
      jti: randomUUID(),
      ...claims,
    });

  const apple = (claims: Record<string, unknown> = {}, key = appleKeys[0]!) =>
    signJwt(key, {
      iss: 'https://appleid.apple.com',
      aud: APPLE_AUD,
      sub: `001234.${randomUUID().replace(/-/g, '')}.0420`,
      email: 'abc123@privaterelay.appleid.com',
      email_verified: 'true',
      is_private_email: 'true',
      iat: now(),
      exp: now() + 600,
      ...claims,
    });

  const social = (body: Record<string, unknown>) => ctx.http().post('/v1/auth/social').send({ device, ...body });

  beforeAll(async () => {
    server = createServer((req, res) => {
      const which = req.url === '/google' ? 'google' : req.url === '/apple' ? 'apple' : undefined;
      if (!which) {
        res.writeHead(404).end();
        return;
      }
      hits[which]++;
      const keys = (which === 'google' ? googleKeys : appleKeys).map((k) => ({
        ...k.publicKey.export({ format: 'jwk' }),
        kid: k.kid,
        alg: k.alg,
        use: 'sig',
      }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.GOOGLE_JWKS_URL = `${base}/google`;
    process.env.APPLE_JWKS_URL = `${base}/apple`;
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
    await new Promise((r) => server.close(r));
  });

  // -------------------------------------------------------------------------
  // Google
  // -------------------------------------------------------------------------
  it("Google: to'g'ri token -> yangi akkaunt (telefonsiz), keyingi kirish — o'sha akkaunt", async () => {
    const sub = `g-${randomUUID()}`;
    const first = await social({ provider: 'google', id_token: google({ sub }) }).expect(200);
    expect(first.body).toMatchObject({ token_type: 'Bearer', is_new_user: true });
    expect(first.body.user).toMatchObject({ display_name: 'Jasur Karimov', phone: null, email: null, roles: ['player'], country_code: 'UZ' });

    // `iss` ikkinchi shaklda ham qabul qilinadi, aud — ro'yxatdagi boshqa client ID
    const again = await social({
      provider: 'google',
      id_token: google({ sub, iss: 'accounts.google.com', aud: 'e2e-google-web.apps.googleusercontent.com' }),
    }).expect(200);
    expect(again.body).toMatchObject({ is_new_user: false, user: { id: first.body.user.id } });

    const ids = await ctx.http().get('/v1/me/identities').set('Authorization', `Bearer ${again.body.access_token}`).expect(200);
    expect(ids.body).toEqual([expect.objectContaining({ provider: 'google', label: 'jasur@gmail.com' })]);
  });

  it("Google: noto'g'ri aud, muddati o'tgan, begona iss, begona kalit, alg=none/HS256 -> 401", async () => {
    const bad = [
      google({ aud: 'someone-else.apps.googleusercontent.com' }),
      google({ exp: now() - 3600, iat: now() - 7200 }),
      google({ iss: 'https://evil.example' }),
      google({ iat: now() + 3600, exp: now() + 7200 }),
      // Bizning kid bilan, lekin boshqa kalit imzolagan
      google({}, { ...makeKey('RS256'), kid: googleKeys[0]!.kid }),
      // ES256 imzo RSA kalitli kid bilan (alg confusion)
      google({}, { ...makeKey('ES256'), kid: googleKeys[0]!.kid }),
      `${b64(JSON.stringify({ alg: 'none', kid: googleKeys[0]!.kid }))}.${b64(JSON.stringify({ sub: 'x', aud: GOOGLE_AUD }))}.`,
      `${b64(JSON.stringify({ alg: 'HS256', kid: googleKeys[0]!.kid }))}.${b64(JSON.stringify({ sub: 'x' }))}.${b64('sig')}`,
      'not-a-jwt-at-all-really-not',
    ];
    for (const id_token of bad) {
      const r = await social({ provider: 'google', id_token }).set('Accept-Language', 'ru').expect(401);
      expect(r.body).toMatchObject({ code: 'SOCIAL_TOKEN_INVALID', detail: 'Вход не подтверждён или истёк. Попробуйте ещё раз' });
    }
    // exp umuman yo'q
    const claims = JSON.parse(Buffer.from(google().split('.')[1]!, 'base64url').toString());
    delete claims.exp;
    await social({ provider: 'google', id_token: signJwt(googleKeys[0]!, claims) }).expect(401);
  });

  it('Google: token qayta ishlatilsa (replay) -> 401', async () => {
    const token = google();
    await social({ provider: 'google', id_token: token }).expect(200);
    const replay = await social({ provider: 'google', id_token: token }).expect(401);
    expect(replay.body.code).toBe('SOCIAL_TOKEN_INVALID');
  });

  it("JWKS: keshdan o'qiladi; yangi kid — bir marta qayta yuklanadi; noma'lum kid — cooldown", async () => {
    const jwks = ctx.app.get(SocialAuthService).jwks;
    const url = `${base}/google`;
    const before = jwks.fetchCount.get(url)!;
    await social({ provider: 'google', id_token: google() }).expect(200);
    expect(jwks.fetchCount.get(url)).toBe(before); // kesh

    // Google kalitni almashtirdi
    const rotated = makeKey('RS256');
    googleKeys.unshift(rotated);
    await social({ provider: 'google', id_token: google({}, rotated) }).expect(200);
    expect(jwks.fetchCount.get(url)).toBe(before + 1);

    // Tasodifiy kid'lar bilan JWKS'ni qayta-qayta yuklatib bo'lmaydi
    for (let i = 0; i < 3; i++) {
      await social({ provider: 'google', id_token: google({}, { ...rotated, kid: randomUUID() }) }).expect(401);
    }
    expect(jwks.fetchCount.get(url)).toBe(before + 1);
  });

  // -------------------------------------------------------------------------
  // Apple
  // -------------------------------------------------------------------------
  it('Apple: ES256 + nonce (SHA-256) -> 200, ism birinchi kirishda client profilidan', async () => {
    const raw = randomUUID();
    const token = apple({ nonce: createHash('sha256').update(raw).digest('hex') });
    const r = await social({ provider: 'apple', id_token: token, nonce: raw, profile: { first_name: 'Dilnoza', last_name: 'Rahimova' } }).expect(200);
    expect(r.body).toMatchObject({ is_new_user: true, user: { display_name: 'Dilnoza Rahimova', email: null } });
    const [user] = await q(ctx, 'SELECT first_name, last_name, email FROM users WHERE id = $1', [r.body.user.id]);
    expect(user).toEqual({ first_name: 'Dilnoza', last_name: 'Rahimova', email: null });
  });

  it("Apple: nonce mos emas yoki yuborilmagan, noto'g'ri aud, muddati o'tgan -> 401", async () => {
    const raw = randomUUID();
    const hashed = createHash('sha256').update(raw).digest('hex');
    await social({ provider: 'apple', id_token: apple({ nonce: hashed }), nonce: randomUUID() }).expect(401);
    // Token nonce'ga bog'langan, lekin client xom nonce'ni bermadi (o'g'irlangan token)
    await social({ provider: 'apple', id_token: apple({ nonce: hashed }) }).expect(401);
    // Client nonce yubordi, token'da yo'q
    await social({ provider: 'apple', id_token: apple(), nonce: raw }).expect(401);
    await social({ provider: 'apple', id_token: apple({ aud: 'com.other.app' }) }).expect(401);
    await social({ provider: 'apple', id_token: apple({ exp: now() - 60, iat: now() - 700 }) }).expect(401);
    // Apple token Google endpointi orqali (iss/aud/kalit mos emas)
    await social({ provider: 'google', id_token: apple() }).expect(401);
    // Nonce'siz to'g'ri token — o'tadi
    await social({ provider: 'apple', id_token: apple() }).expect(200);
  });

  // -------------------------------------------------------------------------
  // Telegram
  // -------------------------------------------------------------------------
  it("Telegram: to'g'ri hash -> 200; o'zgartirilgan maydon, begona bot, 24 soatdan eski -> 401", async () => {
    const fields = { id: 700100200, first_name: 'Bobur', last_name: 'Aliyev', username: 'bobur_a', auth_date: now() - 60 };
    const ok = await social({ provider: 'telegram', telegram_auth: telegramAuth(fields) }).expect(200);
    expect(ok.body).toMatchObject({ is_new_user: true, user: { display_name: 'Bobur Aliyev', phone: null } });
    const ids = await ctx.http().get('/v1/me/identities').set('Authorization', `Bearer ${ok.body.access_token}`).expect(200);
    expect(ids.body).toEqual([expect.objectContaining({ provider: 'telegram', label: '@bobur_a' })]);

    const tampered = { ...telegramAuth({ ...fields, auth_date: now() - 30 }), id: 700100201 };
    await social({ provider: 'telegram', telegram_auth: tampered }).expect(401);
    await social({ provider: 'telegram', telegram_auth: telegramAuth({ ...fields, auth_date: now() - 20 }, '987:other-bot') }).expect(401);
    const old = await social({ provider: 'telegram', telegram_auth: telegramAuth({ ...fields, auth_date: now() - 86_400 - 120 }) }).expect(401);
    expect(old.body.code).toBe('SOCIAL_TOKEN_INVALID');

    // Keyingi kirish (yangi auth_date) — o'sha akkaunt
    const again = await social({ provider: 'telegram', telegram_auth: telegramAuth({ ...fields, auth_date: now() - 5 }) }).expect(200);
    expect(again.body).toMatchObject({ is_new_user: false, user: { id: ok.body.user.id } });
  });

  it('Telegram OAuth sahifalari: faqat allowlist redirect, return sahifasi natijani ilovaga uzatadi', async () => {
    await ctx.http().get('/v1/auth/telegram/start?redirect_uri=https://evil.example/cb').expect(422);
    const start = await ctx.http().get(`/v1/auth/telegram/start?redirect_uri=${encodeURIComponent('matchup://auth/telegram')}`).expect(302);
    const url = new URL(start.headers.location!);
    expect(url.origin + url.pathname).toBe('https://oauth.telegram.org/auth');
    expect(url.searchParams.get('bot_id')).toBe('123456789');
    expect(url.searchParams.get('origin')).toBe('https://api.e2e.matchup.example');
    expect(url.searchParams.get('return_to')).toBe(
      'https://api.e2e.matchup.example/v1/auth/telegram/return?redirect_uri=matchup%3A%2F%2Fauth%2Ftelegram',
    );

    const json = await ctx
      .http()
      .get(`/v1/auth/telegram/start?redirect_uri=${encodeURIComponent('matchup://auth/telegram')}`)
      .set('Accept', 'application/json')
      .expect(200);
    expect(json.body.url).toBe(start.headers.location);

    const page = await ctx.http().get('/v1/auth/telegram/return?redirect_uri=matchup%3A%2F%2Fauth%2Ftelegram').expect(200);
    expect(page.headers['content-security-policy']).toContain("script-src 'nonce-");
    expect(page.text).toContain('var target = "matchup://auth/telegram";');
    await ctx.http().get(`/v1/auth/telegram/return?redirect_uri=${encodeURIComponent('matchup://x"</script>')}`).expect(422);
  });

  // -------------------------------------------------------------------------
  // Bog'lash va uzish
  // -------------------------------------------------------------------------
  it("email bo'yicha avtomatik bog'lanmaydi: bir xil email — alohida akkaunt", async () => {
    const phoneUser = await login(ctx, '+998935557001');
    await q(ctx, "UPDATE users SET email = 'same@gmail.com' WHERE id = $1", [phoneUser.userId]);
    const r = await social({ provider: 'google', id_token: google({ email: 'same@gmail.com' }) }).expect(200);
    expect(r.body.is_new_user).toBe(true);
    expect(r.body.user.id).not.toBe(phoneUser.userId);
  });

  it("identity bog'lash: telefon user Google qo'shadi; boshqa akkauntdagi identity — 409; ikkinchi Google — 409", async () => {
    const a = await login(ctx, '+998935557002');
    const b = await login(ctx, '+998935557003');
    const sub = `g-${randomUUID()}`;

    const linked = await ctx.http().post('/v1/me/identities').set(a.auth).send({ provider: 'google', id_token: google({ sub }) }).expect(200);
    expect(linked.body.map((i: { provider: string }) => i.provider)).toEqual(['phone', 'google']);
    expect(linked.body[0]).toMatchObject({ provider: 'phone', label: '+998935557002' });

    // Endi Google bilan kirish — telefon akkaunti
    const viaGoogle = await social({ provider: 'google', id_token: google({ sub }) }).expect(200);
    expect(viaGoogle.body).toMatchObject({ is_new_user: false, user: { id: a.userId, phone: '+998935557002' } });

    // Takroriy bog'lash (o'sha identity, o'sha user) — idempotent
    await ctx.http().post('/v1/me/identities').set(a.auth).send({ provider: 'google', id_token: google({ sub }) }).expect(200);

    const stolen = await ctx.http().post('/v1/me/identities').set(b.auth).send({ provider: 'google', id_token: google({ sub }) }).expect(409);
    expect(stolen.body.code).toBe('IDENTITY_IN_USE');
    const second = await ctx.http().post('/v1/me/identities').set(a.auth).send({ provider: 'google', id_token: google() }).expect(409);
    expect(second.body.code).toBe('ALREADY_EXISTS');
    await ctx.http().post('/v1/me/identities').set(a.auth).send({ provider: 'google', id_token: google({ aud: 'x' }) }).expect(401);
    await ctx.http().post('/v1/me/identities').send({ provider: 'google', id_token: google() }).expect(401);

    const audit = await q(ctx, "SELECT action, actor_role, changes FROM audit_logs WHERE entity_id = $1 AND action LIKE 'identity.%'", [a.userId]);
    expect(audit).toEqual([{ action: 'identity.link', actor_role: 'player', changes: { provider: 'google' } }]);
  });

  it("uzish: oxirgi kirish usuli — 409, telefon uzilmaydi, boshqa usul bog'langach — 204", async () => {
    const tg = await social({ provider: 'telegram', telegram_auth: telegramAuth({ id: 700100300, first_name: 'Aziz', auth_date: now() }) }).expect(200);
    const s: Pick<Session, 'auth'> = { auth: { Authorization: `Bearer ${tg.body.access_token}` } };

    const last = await ctx.http().delete('/v1/me/identities/telegram').set(s.auth).expect(409);
    expect(last.body.code).toBe('LAST_LOGIN_METHOD');
    await ctx.http().delete('/v1/me/identities/google').set(s.auth).expect(404);
    await ctx.http().delete('/v1/me/identities/phone').set(s.auth).expect(422);

    await ctx.http().post('/v1/me/identities').set(s.auth).send({ provider: 'apple', id_token: apple() }).expect(200);
    await ctx.http().delete('/v1/me/identities/telegram').set(s.auth).expect(204);
    const ids = await ctx.http().get('/v1/me/identities').set(s.auth).expect(200);
    expect(ids.body.map((i: { provider: string }) => i.provider)).toEqual(['apple']);

    // Uzilgan Telegram bilan kirish endi yangi akkaunt ochadi
    const again = await social({ provider: 'telegram', telegram_auth: telegramAuth({ id: 700100300, first_name: 'Aziz', auth_date: now() - 1 }) }).expect(200);
    expect(again.body.is_new_user).toBe(true);
    expect(again.body.user.id).not.toBe(tg.body.user.id);
  });
});
