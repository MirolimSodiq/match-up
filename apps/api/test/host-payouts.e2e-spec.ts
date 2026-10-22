import { HostPayouts } from '../src/host/host-ops.service';
import { OutboxRelay } from '../src/jobs/jobs.module';
import { EventConsumers } from '../src/notifications/notification-jobs';
import { createTestApp, login, q, uuid, type Session, type TestCtx } from './helpers';

const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');

describe("Admin: haftalik host payout'lari — ro'yxat, CSV, \"to'landi\" (bittalab va ommaviy), host'ga push", () => {
  let ctx: TestCtx;
  let admin: Session;
  let pitch: string;
  let city: number;
  let period: { start: string; end: string };

  let hostSeq = 0;
  async function createHost(name: string, payout: { method: string; ref: string } | null = null) {
    const phone = `+99893740${String(++hostSeq).padStart(4, '0')}`;
    const h = await ctx
      .http()
      .post('/v1/admin/hosts')
      .set(admin.auth)
      .send({ phone, display_name: name, city_id: city, base_location: { lat: 39.65, lng: 66.96 }, sports: ['football'], approve: true })
      .expect(201);
    if (payout) {
      await q(ctx, 'UPDATE host_profiles SET payout_method = $2, payout_details_ref = $3 WHERE user_id = $1', [h.body.user_id ?? h.body.id, payout.method, payout.ref]);
    }
    const s = await login(ctx, phone);
    await ctx.http().put('/v1/me/devices').set(s.auth).send({ push_token: `ExponentPushToken[${uuid()}]`, platform: 'android', app_version: '1.0.0' }).expect(200);
    return { ...s, phone, name };
  }

  let slot = 0;
  async function createMatch(): Promise<{ id: string; code: string }> {
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitch,
        sport: 'football',
        starts_at: inMinutes(60 * 24 * 60 + ++slot * 120),
        duration_min: 60,
        format: '5v5',
        players_per_side: 5,
        min_players: 4,
        max_players: 10,
        price: { amount: 4000000, currency: 'UZS' },
        lease_cost: { amount: 20000000, currency: 'UZS' },
        host_fee: { amount: 10000000, currency: 'UZS' },
      });
    if (c.status !== 201) throw new Error(JSON.stringify(c.body));
    return { id: c.body.id, code: c.body.public_code };
  }

  /** O'tgan haftada bajarilgan tayinlov (payout job'i shu davrni oladi). */
  async function completedAssignment(hostId: string, fee: number) {
    const m = await createMatch();
    await q(
      ctx,
      `INSERT INTO host_assignments (match_id, host_user_id, status, fee_amount, currency, offer_expires_at, responded_at, completed_at)
       VALUES ($1, $2, 'completed', $3, 'UZS', now(), now(), now() - interval '7 days')`,
      [m.id, hostId, fee],
    );
    return m;
  }

  const payoutOf = async (hostId: string) =>
    (await q(ctx, 'SELECT * FROM host_payouts WHERE host_user_id = $1 ORDER BY period_start DESC', [hostId]))[0]!;

  async function pump() {
    const relay = ctx.app.get(OutboxRelay);
    while ((await relay.run()) > 0);
    await ctx.app.get(EventConsumers).drain();
  }

  let h1: Awaited<ReturnType<typeof createHost>>;
  let h2: Awaited<ReturnType<typeof createHost>>;
  let h3: Awaited<ReturnType<typeof createHost>>;
  let h1Matches: { id: string; code: string }[];

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await login(ctx, '+998901110001');
    pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'samarkand-mini'"))[0]!.id;
    city = (await q(ctx, "SELECT id FROM cities WHERE slug = 'samarkand'"))[0]!.id;
    // Consumer group event'lardan oldin bo'lsin (yangi group `$` dan o'qiydi)
    await ctx.app.get(EventConsumers).ensureGroups();

    h1 = await createHost('Payout Host Bir', { method: 'card_uzcard', ref: 'vault:kv/hosts/payout-bir' });
    h2 = await createHost('=HYPERLINK("http://x")', { method: 'card_humo', ref: 'vault:kv/hosts/payout-ikki' });
    h3 = await createHost('Payout Host Uch');
    h1Matches = [await completedAssignment(h1.userId, 10000000), await completedAssignment(h1.userId, 15000000)];
    await completedAssignment(h2.userId, 12000000);
    await completedAssignment(h3.userId, 8000000);

    const run = await ctx.app.get(HostPayouts).run();
    period = { start: run.period_start, end: run.period_end };
  });
  afterAll(() => ctx.close());

  it("ro'yxat: faqat admin, filtrlar, host rekvizitlari, jami; tafsilot — tayinlovlar", async () => {
    const player = await login(ctx, '+998902000004');
    await ctx.http().get('/v1/admin/host-payouts').set(player.auth).expect(403);
    await ctx.http().get('/v1/admin/host-payouts').expect(401);
    await ctx.http().get('/v1/admin/host-payouts?status=unknown').set(admin.auth).expect(422);
    await ctx.http().get('/v1/admin/host-payouts?period_from=2026-13-01').set(admin.auth).expect(422);

    const one = await ctx.http().get(`/v1/admin/host-payouts?status=pending&host_id=${h1.userId}`).set(admin.auth).expect(200);
    expect(one.body).toMatchObject({ total: 1, totals: [{ currency: 'UZS', count: 1, amount: { amount: 25000000 } }] });
    const p1 = one.body.items[0];
    expect(p1).toMatchObject({
      host: { id: h1.userId, display_name: 'Payout Host Bir', phone: h1.phone, payout_method: 'card_uzcard', payout_details_ref: 'vault:kv/hosts/payout-bir' },
      period,
      amount: { amount: 25000000, currency: 'UZS', formatted: expect.stringMatching(/^250\s000 so'm$/) },
      status: 'pending',
      assignments_count: 2,
      provider_ref: null,
      paid_at: null,
      paid_by: null,
      note: null,
    });

    // Davr va qidiruv
    const inPeriod = await ctx.http().get(`/v1/admin/host-payouts?period_from=${period.start}&period_to=${period.end}&q=${encodeURIComponent('Payout Host')}`).set(admin.auth).expect(200);
    expect(inPeriod.body.items.map((x: { host: { id: string } }) => x.host.id).sort()).toEqual([h1.userId, h3.userId].sort());
    const byPhone = await ctx.http().get(`/v1/admin/host-payouts?q=${h2.phone.slice(-7)}`).set(admin.auth).expect(200);
    expect(byPhone.body.items.map((x: { host: { id: string } }) => x.host.id)).toEqual([h2.userId]);
    const future = await ctx.http().get('/v1/admin/host-payouts?period_from=2099-01-01').set(admin.auth).expect(200);
    expect(future.body).toMatchObject({ items: [], total: 0, totals: [] });

    const d = await ctx.http().get(`/v1/admin/host-payouts/${p1.id}`).set(admin.auth).expect(200);
    expect(d.body).toMatchObject({ id: p1.id, status: 'pending' });
    expect(d.body.assignments).toHaveLength(2);
    expect(d.body.assignments.map((a: { match: { public_code: string } }) => a.match.public_code).sort()).toEqual(h1Matches.map((m) => m.code).sort());
    expect(d.body.assignments[0]).toMatchObject({ match: { venue_name: 'Samarqand Mini Field', title: 'Futbol 5v5' }, fee: { currency: 'UZS' } });
    await ctx.http().get(`/v1/admin/host-payouts/${uuid()}`).set(admin.auth).expect(404);
  });

  it("CSV: bank o'tkazmasi uchun — BOM, sarlavha, formula injection'dan himoya", async () => {
    await ctx.http().get('/v1/admin/host-payouts/export?status=pending').set((await login(ctx, '+998902000004')).auth).expect(403);
    const res = await ctx.http().get(`/v1/admin/host-payouts/export?status=pending&period_from=${period.start}&period_to=${period.end}`).set(admin.auth).buffer(true).parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (data += c));
      r.on('end', () => cb(null, data));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="host-payouts-\d{4}-\d{2}-\d{2}\.csv"$/);
    const text = res.body as string;
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe('payout_id,host,phone,payout_method,payout_details_ref,amount,currency,period_start,period_end,assignments,status,provider_ref');
    const p1 = await payoutOf(h1.userId);
    expect(lines).toContain(`${p1.id},Payout Host Bir,${h1.phone},card_uzcard,vault:kv/hosts/payout-bir,250000.00,UZS,${period.start},${period.end},2,pending,`);
    const p2 = await payoutOf(h2.userId);
    // `=` bilan boshlangan ism Excel'da formula bo'lib ochilmasin
    expect(lines).toContain(`${p2.id},"'=HYPERLINK(""http://x"")",${h2.phone},card_humo,vault:kv/hosts/payout-ikki,120000.00,UZS,${period.start},${period.end},1,pending,`);
  });

  it("bittalab \"to'landi\": Idempotency-Key, o'tkazma raqami, audit, takror — 409; host'ga push", async () => {
    const p1 = await payoutOf(h1.userId);
    await ctx.http().post(`/v1/admin/host-payouts/${p1.id}/paid`).set(admin.auth).send({ provider_ref: 'TR-1' }).expect(422);
    await ctx.http().post(`/v1/admin/host-payouts/${p1.id}/paid`).set(admin.auth).set('Idempotency-Key', uuid()).send({ provider_ref: '  ' }).expect(422);
    await ctx.http().post(`/v1/admin/host-payouts/${uuid()}/paid`).set(admin.auth).set('Idempotency-Key', uuid()).send({ provider_ref: 'TR-1' }).expect(404);

    const r = await ctx
      .http()
      .post(`/v1/admin/host-payouts/${p1.id}/paid`)
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ provider_ref: 'UZCARD-TR-0001', note: 'Kapitalbank orqali' })
      .expect(200);
    expect(r.body).toMatchObject({
      id: p1.id,
      status: 'paid',
      provider_ref: 'UZCARD-TR-0001',
      note: 'Kapitalbank orqali',
      paid_by: { id: admin.userId },
      paid_at: expect.any(String),
    });
    await ctx.http().post(`/v1/admin/host-payouts/${p1.id}/paid`).set(admin.auth).set('Idempotency-Key', uuid()).send({ provider_ref: 'X' }).expect(409);

    const audits = await q(ctx, "SELECT actor_user_id, changes FROM audit_logs WHERE action = 'host_payout.paid' AND entity_id = $1", [p1.id]);
    expect(audits).toEqual([{ actor_user_id: admin.userId, changes: { provider_ref: 'UZCARD-TR-0001', note: 'Kapitalbank orqali', amount: 25000000, currency: 'UZS' } }]);

    await pump();
    const n = await q(ctx, "SELECT payload, locale FROM notifications WHERE user_id = $1 AND type = 'host.payout_paid'", [h1.userId]);
    expect(n).toHaveLength(1);
    expect(n[0]!.payload).toMatchObject({ title: "Haftalik to'lov o'tkazildi", data: { payout_id: p1.id } });
    expect(n[0]!.payload.body).toMatch(/^250\s000 so'm — .+ kunlari o'tkazgan o'yinlaringiz uchun\.$/);

    // To'langan payout'ga keyingi job yangi tayinlov qo'shmaydi (keyingi davrga qoladi)
    await completedAssignment(h1.userId, 5000000);
    await ctx.app.get(HostPayouts).run();
    expect(await payoutOf(h1.userId)).toMatchObject({ id: p1.id, status: 'paid', amount: 25000000, assignments_count: 2 });
  });

  it("ommaviy \"to'landi\": bitta o'tkazma raqami; to'langan aralashsa — 409 va hech biri o'zgarmaydi", async () => {
    const p1 = await payoutOf(h1.userId);
    const p2 = await payoutOf(h2.userId);
    const p3 = await payoutOf(h3.userId);
    await ctx.http().post('/v1/admin/host-payouts/paid').set(admin.auth).set('Idempotency-Key', uuid()).send({ ids: [], provider_ref: 'B' }).expect(422);
    await ctx.http().post('/v1/admin/host-payouts/paid').set(admin.auth).set('Idempotency-Key', uuid()).send({ ids: ['x'], provider_ref: 'B' }).expect(422);

    await ctx.http().post('/v1/admin/host-payouts/paid').set(admin.auth).set('Idempotency-Key', uuid()).send({ ids: [p1.id, p2.id, p3.id], provider_ref: 'BATCH-1' }).expect(409);
    await ctx.http().post('/v1/admin/host-payouts/paid').set(admin.auth).set('Idempotency-Key', uuid()).send({ ids: [p2.id, uuid()], provider_ref: 'BATCH-1' }).expect(404);
    expect((await payoutOf(h2.userId)).status).toBe('pending');
    expect((await payoutOf(h3.userId)).status).toBe('pending');

    const r = await ctx
      .http()
      .post('/v1/admin/host-payouts/paid')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ ids: [p2.id, p3.id, p2.id], provider_ref: 'HUMO-BATCH-0042' })
      .expect(200);
    expect(r.body.items).toHaveLength(2);
    for (const item of r.body.items) expect(item).toMatchObject({ status: 'paid', provider_ref: 'HUMO-BATCH-0042', paid_by: { id: admin.userId } });

    const audits = await q(ctx, "SELECT entity_id, changes FROM audit_logs WHERE action = 'host_payout.paid' AND entity_id = ANY($1::uuid[]) ORDER BY entity_id", [[p2.id, p3.id]]);
    expect(audits).toHaveLength(2);
    for (const a of audits) expect(a.changes).toMatchObject({ provider_ref: 'HUMO-BATCH-0042', batch_size: 2 });

    await pump();
    for (const h of [h2, h3]) {
      expect(await q(ctx, "SELECT id FROM notifications WHERE user_id = $1 AND type = 'host.payout_paid'", [h.userId])).toHaveLength(1);
    }

    const paid = await ctx.http().get(`/v1/admin/host-payouts?status=paid&q=HUMO-BATCH-0042`).set(admin.auth).expect(200);
    expect(paid.body.items.map((x: { id: string }) => x.id).sort()).toEqual([p2.id, p3.id].sort());
  });
});
