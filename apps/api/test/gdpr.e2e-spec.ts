import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WalletService } from '../src/commerce/wallet.service';
import { DB, type Db } from '../src/db/db';
import { DataExportService } from '../src/privacy/data-export.service';
import { ErasureService } from '../src/privacy/erasure.service';
import { bookAndPayWithPayme, createTestApp, device, login, q, uuid, type Session, type TestCtx } from './helpers';

describe('GDPR: eksport va erasure job\'lari', () => {
  let ctx: TestCtx;
  let admin: Session;
  let matchId: string;
  let exportsJob: DataExportService;
  let erasureJob: ErasureService;
  const storageDir = process.env.STORAGE_DIR!;

  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');

  /** Admin API orqali alohida match (boshqa testlarning seed match'lariga ta'sir qilmaydi). */
  async function createMatch(hoursAhead: number): Promise<string> {
    const pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'samarkand-mini'"))[0]!.id;
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitch,
        sport: 'football',
        starts_at: inHours(hoursAhead),
        duration_min: 60,
        format: '5v5',
        players_per_side: 5,
        min_players: 6,
        max_players: 10,
        price: { amount: 4000000, currency: 'UZS' },
        lease_cost: { amount: 20000000, currency: 'UZS' },
        host_fee: { amount: 10000000, currency: 'UZS' },
        title: { 'uz-Latn': 'GDPR test' },
      })
      .expect(201);
    await ctx.http().post(`/v1/admin/matches/${c.body.id}/publish`).set(admin.auth).expect(200);
    return c.body.id;
  }

  async function signWaiver(s: Session, mId: string): Promise<void> {
    const req = await ctx.http().get(`/v1/waivers/required?match_id=${mId}`).set(s.auth).expect(200);
    if (req.body.signed) return;
    const tpl = req.body.template;
    await ctx
      .http()
      .post(`/v1/waivers/${tpl.id}/signatures`)
      .set(s.auth)
      .send({ accepted: true, method: 'clickwrap', document_sha256: tpl.document_sha256, typed_full_name: 'Test User', match_id: mId })
      .expect(201);
  }

  /** Muddati yetgan erasure so'rovi (grace o'tkazib yuborilgan). */
  async function requestErasureDue(s: Session): Promise<string> {
    const r = await ctx.http().delete('/v1/me').set(s.auth).expect(202);
    await q(ctx, "UPDATE data_subject_requests SET due_at = now() - interval '1 minute' WHERE id = $1", [r.body.id]);
    return r.body.id;
  }

  const count = async (sql: string, params: unknown[]) => Number((await q<{ n: string }>(ctx, sql, params))[0]!.n);

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await login(ctx, '+998901110001');
    matchId = await createMatch(24 * 30);
    exportsJob = ctx.app.get(DataExportService);
    erasureJob = ctx.app.get(ErasureService);
  });
  afterAll(() => ctx.close());

  // -------------------------------------------------------------------------
  // Eksport
  // -------------------------------------------------------------------------
  it("eksport: so'rov -> job -> completed + DataExportReady; JSON tarkibi to'liq, karta/provider ma'lumotlarisiz", async () => {
    const s = await login(ctx, '+998935558001');
    await ctx.http().patch('/v1/me').set(s.auth).send({ display_name: 'Eksport Test', first_name: 'Eldor', birth_date: '1995-04-12' }).expect(200);
    await ctx.http().put('/v1/me/sports/football').set(s.auth).send({ self_level: 'intermediate' }).expect(200);
    await ctx.http().put('/v1/me/consents').set(s.auth).send({ consents: [{ purpose: 'marketing_sms', granted: true, document_version: 'privacy-2026-10' }] }).expect(200);
    await signWaiver(s, matchId);
    const { bookingId } = await bookAndPayWithPayme(ctx, s, matchId);
    // Host check-in qildi va xabarnoma yuborilgan
    const [participant] = await q(ctx, 'SELECT id FROM match_participants WHERE booking_id = $1', [bookingId]);
    await q(
      ctx,
      `INSERT INTO checkin_events (match_id, participant_id, actor_user_id, action, method, client_event_id, occurred_at)
       VALUES ($1, $2, (SELECT id FROM users WHERE phone_e164 = '+998901110002'), 'check_in', 'qr', $3, now())`,
      [matchId, participant!.id, uuid()],
    );
    await q(ctx, `INSERT INTO notifications (user_id, type, channel, status, locale, payload) VALUES ($1, 'booking.confirmed', 'push', 'sent', 'uz-Latn', '{"match_code": "MU-X"}')`, [s.userId]);

    const r = await ctx.http().post('/v1/me/data-export').set(s.auth).expect(202);
    expect(r.body).toMatchObject({ type: 'export', status: 'received', download_url: null });
    // Takroriy bosish yangi so'rov yaratmaydi
    const again = await ctx.http().post('/v1/me/data-export').set(s.auth).expect(202);
    expect(again.body.id).toBe(r.body.id);
    const notReady = await ctx.http().get(`/v1/me/data-exports/${r.body.id}`).set(s.auth).expect(409);
    expect(notReady.body.code).toBe('EXPORT_NOT_READY');

    expect((await exportsJob.run()).exported).toBeGreaterThanOrEqual(1);
    const [dsr] = await q(ctx, 'SELECT status, export_path, export_size_bytes, export_expires_at > now() + interval \'6 days\' AS long_enough FROM data_subject_requests WHERE id = $1', [r.body.id]);
    expect(dsr).toMatchObject({ status: 'completed', long_enough: true });
    expect(existsSync(join(storageDir, dsr!.export_path))).toBe(true);
    const events = await q(ctx, "SELECT payload FROM outbox_events WHERE event_type = 'DataExportReady' AND aggregate_id = $1", [s.userId]);
    expect(events).toEqual([{ payload: expect.objectContaining({ request_id: r.body.id, user_id: s.userId }) }]);

    const list = await ctx.http().get('/v1/me/data-requests').set(s.auth).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: r.body.id, status: 'completed', download_url: `/v1/me/data-exports/${r.body.id}` });

    const file = await ctx.http().get(`/v1/me/data-exports/${r.body.id}`).set(s.auth).buffer(true).parse((res, cb) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c.toString()));
      res.on('end', () => cb(null, data));
    }).expect(200);
    expect(file.headers['content-disposition']).toMatch(/^attachment; filename="matchup-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(file.headers['cache-control']).toBe('no-store');
    const doc = JSON.parse(file.body as string);

    expect(doc).toMatchObject({ format: 'matchup.personal-data-export', version: 1, request_id: r.body.id });
    expect(doc.profile).toMatchObject({ id: s.userId, phone: '+998935558001', display_name: 'Eksport Test', first_name: 'Eldor', birth_date: '1995-04-12' });
    expect(doc.roles).toEqual([expect.objectContaining({ role: 'player' })]);
    expect(doc.identities).toEqual([expect.objectContaining({ provider: 'phone', provider_uid: '+998935558001' })]);
    expect(doc.sport_profiles).toEqual([expect.objectContaining({ sport: 'football', self_level: 'intermediate' })]);
    expect(doc.consents).toEqual([expect.objectContaining({ purpose: 'marketing_sms', granted: true, document_version: 'privacy-2026-10' })]);
    expect(doc.bookings).toEqual([expect.objectContaining({ id: bookingId, status: 'confirmed', total_amount: 4000000, currency: 'UZS', sport: 'football', venue: expect.any(String) })]);
    expect(doc.payments).toHaveLength(1);
    expect(doc.payments[0]).toMatchObject({ booking_id: bookingId, provider: 'payme', amount: 4000000, status: 'succeeded' });
    expect(Object.keys(doc.payments[0]).sort()).toEqual(
      ['amount', 'booking_id', 'cancelled_at', 'created_at', 'currency', 'id', 'provider', 'refunded_amount', 'status', 'succeeded_at'].sort(),
    );
    const raw = file.body as string;
    for (const leak of ['provider_state', 'provider_transaction_id', 'checkout_url', 'refresh_token_hash', 'push_token', 'card']) {
      expect(raw).not.toContain(leak);
    }
    expect(doc.waiver_signatures).toEqual([
      expect.objectContaining({ template: 'general_liability', method: 'clickwrap', typed_full_name: 'Test User', document_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]);
    expect(doc.checkins).toEqual([expect.objectContaining({ action: 'check_in', method: 'qr' })]);
    expect(doc.notifications).toEqual([expect.objectContaining({ type: 'booking.confirmed', channel: 'push', payload: { match_code: 'MU-X' } })]);
    expect(doc.sessions.length).toBeGreaterThanOrEqual(1);
    expect(doc.host).toBeNull();
    expect(doc.data_requests).toEqual([expect.objectContaining({ id: r.body.id, type: 'export' })]);
  });

  it("yuklab olish: faqat egasi; muddati o'tsa 410 va fayl tozalanadi", async () => {
    const owner = await login(ctx, '+998935558002');
    const other = await login(ctx, '+998935558003');
    const r = await ctx.http().post('/v1/me/data-export').set(owner.auth).expect(202);
    await exportsJob.run();
    await ctx.http().get(`/v1/me/data-exports/${r.body.id}`).set(other.auth).expect(404);
    await ctx.http().get(`/v1/me/data-exports/${r.body.id}`).expect(401);
    await ctx.http().get(`/v1/me/data-exports/${uuid()}`).set(owner.auth).expect(404);
    await ctx.http().get(`/v1/me/data-exports/${r.body.id}`).set(owner.auth).expect(200);

    const { export_path } = (
      await q<{ export_path: string }>(
        ctx,
        "UPDATE data_subject_requests SET export_expires_at = now() - interval '1 second' WHERE id = $1 RETURNING export_path",
        [r.body.id],
      )
    )[0]!;
    const expired = await ctx.http().get(`/v1/me/data-exports/${r.body.id}`).set(owner.auth).expect(410);
    expect(expired.body.code).toBe('EXPORT_EXPIRED');
    expect((await exportsJob.run()).expired).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(storageDir, export_path))).toBe(false);
    const [after] = await q(ctx, 'SELECT export_path FROM data_subject_requests WHERE id = $1', [r.body.id]);
    expect(after!.export_path).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Erasure
  // -------------------------------------------------------------------------
  it("erasure: grace davrida job tegmaydi; bekor qilish; qayta so'rash; ERASURE_PENDING", async () => {
    const s = await login(ctx, '+998935558010');
    const r = await ctx.http().delete('/v1/me').set(s.auth).expect(202);
    expect(r.body).toMatchObject({ type: 'erasure', status: 'received', blocked_reasons: null });
    const graceDays = (new Date(r.body.due_at).getTime() - Date.now()) / 86_400_000;
    expect(graceDays).toBeGreaterThan(29.9);
    expect((await ctx.http().delete('/v1/me').set(s.auth).expect(409)).body.code).toBe('ERASURE_PENDING');

    await erasureJob.run();
    expect((await q(ctx, 'SELECT status, anonymized_at FROM users WHERE id = $1', [s.userId]))[0]).toEqual({ status: 'active', anonymized_at: null });

    const cancelled = await ctx.http().delete('/v1/me/erasure-request').set(s.auth).expect(200);
    expect(cancelled.body).toMatchObject({ id: r.body.id, status: 'cancelled', cancelled_at: expect.any(String) });
    await ctx.http().delete('/v1/me/erasure-request').set(s.auth).expect(404);

    // Bekor qilingan so'rov muddati o'tsa ham bajarilmaydi
    await q(ctx, "UPDATE data_subject_requests SET due_at = now() - interval '1 day' WHERE id = $1", [r.body.id]);
    await erasureJob.run();
    expect((await q(ctx, 'SELECT status FROM users WHERE id = $1', [s.userId]))[0]!.status).toBe('active');
    await ctx.http().delete('/v1/me').set(s.auth).expect(202);
  });

  it('erasure bloklanadi: hamyonda balans — sabab va summa; hech narsa o\'zgarmaydi', async () => {
    const s = await login(ctx, '+998935558011');
    await ctx.app.get(WalletService).credit(ctx.app.get<Db>(DB), { userId: s.userId, currency: 'UZS', amount: 4500000, type: 'promo_credit' });
    const id = await requestErasureDue(s);
    expect(await erasureJob.run()).toMatchObject({ blocked: 1 });

    const [dsr] = await q(ctx, 'SELECT status, blocked_reasons, blocked_at FROM data_subject_requests WHERE id = $1', [id]);
    expect(dsr).toMatchObject({ status: 'received', blocked_reasons: [{ code: 'wallet_balance', amount: 4500000, currency: 'UZS' }] });
    expect((await q(ctx, 'SELECT status, phone_e164 FROM users WHERE id = $1', [s.userId]))[0]).toEqual({ status: 'active', phone_e164: '+998935558011' });
    expect(await count('SELECT count(*) AS n FROM auth_identities WHERE user_id = $1', [s.userId])).toBe(1);

    const list = await ctx.http().get('/v1/me/data-requests').set(s.auth).set('Accept-Language', 'uz-Latn').expect(200);
    expect(list.body.items[0].blocked_reasons).toEqual([
      expect.objectContaining({
        code: 'wallet_balance',
        // Raqam guruhlari orasida bo'linmas bo'sh joy
        balance: { amount: 4500000, currency: 'UZS', formatted: expect.stringMatching(/^45\s000 so'm$/) },
        message: expect.stringMatching(/^Hamyoningizda 45\s000 so'm bor\. Pulni qaytarib olish uchun support'ga murojaat qiling$/),
      }),
    ]);
    // Foydalanuvchi grace/bloklangan holatda ham bekor qila oladi
    await ctx.http().delete('/v1/me/erasure-request').set(s.auth).expect(200);
  });

  it('erasure bloklanadi: faol host tayinlovi (o\'yin o\'tgach — davom etadi)', async () => {
    const s = await login(ctx, '+998935558012');
    const hostMatch = await createMatch(24 * 31);
    await q(ctx, "INSERT INTO host_profiles (user_id, status, home_city_id) VALUES ($1, 'active', (SELECT id FROM cities WHERE slug = 'tashkent'))", [s.userId]);
    await q(
      ctx,
      `INSERT INTO host_assignments (match_id, host_user_id, status, fee_amount, currency, offer_expires_at, responded_at)
       VALUES ($1, $2, 'accepted', 10000000, 'UZS', now() + interval '10 minutes', now())`,
      [hostMatch, s.userId],
    );
    const id = await requestErasureDue(s);
    await erasureJob.run();
    const [dsr] = await q(ctx, 'SELECT status, blocked_reasons FROM data_subject_requests WHERE id = $1', [id]);
    const code = (await q(ctx, 'SELECT public_code FROM matches WHERE id = $1', [hostMatch]))[0]!.public_code;
    expect(dsr).toMatchObject({ status: 'received', blocked_reasons: [expect.objectContaining({ code: 'active_host_assignment', match_code: code, status: 'accepted' })] });
    const list = await ctx.http().get('/v1/me/data-requests').set(s.auth).set('Accept-Language', 'ru').expect(200);
    expect(list.body.items[0].blocked_reasons[0].message).toBe(`Вы ведущий игры ${code}. Аккаунт будет удалён после игры`);

    // Tayinlov yakunlandi -> keyingi ishga tushishda erasure bajariladi
    await q(ctx, "UPDATE host_assignments SET status = 'completed', completed_at = now() WHERE match_id = $1", [hostMatch]);
    await erasureJob.run();
    expect((await q(ctx, 'SELECT status, blocked_reasons FROM data_subject_requests WHERE id = $1', [id]))[0]).toEqual({ status: 'completed', blocked_reasons: null });
    expect((await q(ctx, 'SELECT status FROM users WHERE id = $1', [s.userId]))[0]!.status).toBe('deleted');
  });

  it("erasure: anonimlashtirish — PII null, identity/sessiya/token/teg o'chiriladi, consent/waiver/to'lov qoladi, kelgusi booking bekor", async () => {
    const phone = '+998935558020';
    // Kirish push token bilan (device_tokens yozuvi)
    const req = await ctx.http().post('/v1/auth/otp/request').send({ phone }).expect(200);
    const v = await ctx
      .http()
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: req.body.challenge_id, code: ctx.otp.codes.get(phone), device: { ...device, push_token: `ExponentPushToken[${uuid()}]` } })
      .expect(200);
    const s: Session = { token: v.body.access_token, refresh: v.body.refresh_token, userId: v.body.user.id, auth: { Authorization: `Bearer ${v.body.access_token}` } };
    await ctx.http().patch('/v1/me').set(s.auth).send({ display_name: 'Erase Me', first_name: 'Ism', last_name: 'Familiya', birth_date: '1990-01-01' }).expect(200);
    await q(ctx, "UPDATE users SET email = 'erase.me@example.com' WHERE id = $1", [s.userId]);
    await ctx.http().put('/v1/me/consents').set(s.auth).send({ consents: [{ purpose: 'media_appearance', granted: true }] }).expect(200);
    await q(ctx, "INSERT INTO auth_identities (user_id, provider, provider_uid, display_label) VALUES ($1, 'telegram', '990011', '@erase_me')", [s.userId]);
    await signWaiver(s, matchId);
    const { bookingId, amount } = await bookAndPayWithPayme(ctx, s, matchId);
    // Highlight'da teg
    const [media] = await q(
      ctx,
      `INSERT INTO media_assets (owner_user_id, kind, status, storage_region, bucket, object_key, content_type)
       VALUES ((SELECT id FROM users WHERE phone_e164 = '+998901110002'), 'video', 'ready', 'uz-1', 'e2e', $1, 'video/mp4') RETURNING id`,
      [`h/${uuid()}.mp4`],
    );
    const [hl] = await q(
      ctx,
      `INSERT INTO highlights (match_id, media_asset_id, created_by, source)
       VALUES ($1, $2, (SELECT id FROM users WHERE phone_e164 = '+998901110002'), 'host_manual') RETURNING id`,
      [matchId, media!.id],
    );
    await q(ctx, "INSERT INTO highlight_tags (highlight_id, user_id, tagged_by) VALUES ($1, $2, (SELECT id FROM users WHERE phone_e164 = '+998901110002'))", [hl!.id, s.userId]);
    // Avvalgi eksport fayli ham o'chishi kerak
    const exp = await ctx.http().post('/v1/me/data-export').set(s.auth).expect(202);
    await exportsJob.run();
    const exportPath = (await q(ctx, 'SELECT export_path FROM data_subject_requests WHERE id = $1', [exp.body.id]))[0]!.export_path;
    expect(existsSync(join(storageDir, exportPath))).toBe(true);

    const retained = {
      consents: await count('SELECT count(*) AS n FROM consents WHERE user_id = $1', [s.userId]),
      waivers: await count('SELECT count(*) AS n FROM waiver_signatures WHERE user_id = $1', [s.userId]),
      payments: await count("SELECT count(*) AS n FROM payments WHERE user_id = $1 AND status = 'succeeded'", [s.userId]),
    };
    expect(retained).toEqual({ consents: 1, waivers: 1, payments: 1 });

    const id = await requestErasureDue(s);
    expect(await erasureJob.run()).toMatchObject({ erased: 1 });

    const [user] = await q(
      ctx,
      `SELECT phone_e164, email, first_name, last_name, birth_date, avatar_media_id, display_name, status,
              deleted_at IS NOT NULL AS deleted, anonymized_at IS NOT NULL AS anonymized
       FROM users WHERE id = $1`,
      [s.userId],
    );
    expect(user).toEqual({
      phone_e164: null,
      email: null,
      first_name: null,
      last_name: null,
      birth_date: null,
      avatar_media_id: null,
      display_name: 'Deleted user',
      status: 'deleted',
      deleted: true,
      anonymized: true,
    });
    for (const table of ['auth_identities', 'user_sessions', 'device_tokens', 'highlight_tags']) {
      expect([table, await count(`SELECT count(*) AS n FROM ${table} WHERE user_id = $1`, [s.userId])]).toEqual([table, 0]);
    }
    // Huquqiy dalil va soliq yozuvlari o'zgarmagan
    expect({
      consents: await count('SELECT count(*) AS n FROM consents WHERE user_id = $1', [s.userId]),
      waivers: await count('SELECT count(*) AS n FROM waiver_signatures WHERE user_id = $1', [s.userId]),
      payments: await count("SELECT count(*) AS n FROM payments WHERE user_id = $1 AND status = 'succeeded'", [s.userId]),
    }).toEqual(retained);

    // Kelgusi booking policy bo'yicha bekor (>=24h: 100% kartaga)
    expect((await q(ctx, 'SELECT status, cancel_reason FROM bookings WHERE id = $1', [bookingId]))[0]).toEqual({ status: 'cancelled', cancel_reason: 'account_erasure' });
    expect(await q(ctx, 'SELECT amount, destination, status, reason FROM refunds WHERE booking_id = $1', [bookingId])).toEqual([
      { amount, destination: 'original_method', status: 'pending', reason: 'account_erasure' },
    ]);

    // Eksport fayli o'chirildi
    expect(existsSync(join(storageDir, exportPath))).toBe(false);
    expect((await q(ctx, 'SELECT export_path FROM data_subject_requests WHERE id = $1', [exp.body.id]))[0]!.export_path).toBeNull();

    // Audit, outbox, DSR holati
    const [audit] = await q(ctx, "SELECT actor_user_id, changes FROM audit_logs WHERE action = 'user.erase' AND entity_id = $1", [s.userId]);
    expect(audit).toMatchObject({
      actor_user_id: null,
      changes: {
        request_id: id,
        deleted: { auth_identities: 2, device_tokens: 1, highlight_tags: 1, user_sessions: expect.any(Number) },
        cancelled_bookings: [{ booking_id: bookingId, refund_amount: amount }],
        export_files_removed: 1,
      },
    });
    expect(await count("SELECT count(*) AS n FROM outbox_events WHERE event_type = 'UserErased' AND aggregate_id = $1", [s.userId])).toBe(1);
    expect((await q(ctx, 'SELECT status, completed_at IS NOT NULL AS done FROM data_subject_requests WHERE id = $1', [id]))[0]).toEqual({ status: 'completed', done: true });

    // Eski token'lar ishlamaydi; telefon bo'shadi — qayta kirish yangi akkaunt ochadi
    await ctx.http().post('/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(401);
    await ctx.http().get('/v1/me').set(s.auth).expect(404);
    const fresh = await login(ctx, phone);
    expect(fresh.userId).not.toBe(s.userId);
    expect(await erasureJob.run()).toMatchObject({ erased: 0 });
  });
});
