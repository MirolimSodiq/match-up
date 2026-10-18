import { AdminService } from '../src/admin/admin.service';
import { DispatchService } from '../src/host/host.service';
import { OutboxRelay } from '../src/jobs/jobs.module';
import { bookAndPayWithPayme, createTestApp, login, q, signatureId, uuid, type Session, type TestCtx } from './helpers';

describe('Admin: match yaratish/nashr/bekor qilish, dispatch, oversell', () => {
  let ctx: TestCtx;
  let admin: Session;
  let pitchA: string;
  let pitch1: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await login(ctx, '+998901110001');
    pitchA = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'chilonzor-arena'"))[0]!.id;
    pitch1 = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'yunusobod-sport' AND p.name = 'Pitch 1'"))[0]!.id;
  });
  afterAll(() => ctx.close());

  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const matchBody = (pitch: string, startsAt: string, extra: Record<string, unknown> = {}) => ({
    pitch_id: pitch,
    sport: 'football',
    starts_at: startsAt,
    duration_min: 90,
    format: '7v7',
    players_per_side: 7,
    min_players: 10,
    max_players: 14,
    price: { amount: 5000000, currency: 'UZS' },
    lease_cost: { amount: 40000000, currency: 'UZS' },
    host_fee: { amount: 15000000, currency: 'UZS' },
    title: { 'uz-Latn': 'Kechki futbol', ru: 'Вечерний футбол' },
    ...extra,
  });

  async function createAndPublish(body: Record<string, unknown>) {
    const c = await ctx.http().post('/v1/admin/matches').set(admin.auth).set('Idempotency-Key', uuid()).send(body);
    if (c.status !== 201) throw new Error(JSON.stringify(c.body));
    expect(c.body.status).toBe('draft');
    const p = await ctx.http().post(`/v1/admin/matches/${c.body.id}/publish`).set(admin.auth).expect(200);
    expect(p.body.status).toBe('open');
    return c.body.id as string;
  }

  it("player admin endpointiga kira olmaydi; ustma-ust lease rad etiladi", async () => {
    const player = await login(ctx, '+998902000010');
    await ctx.http().post('/v1/admin/matches').set(player.auth).set('Idempotency-Key', uuid()).send(matchBody(pitchA, inHours(5))).expect(403);

    const raceStart = (await q(ctx, "SELECT starts_at FROM matches WHERE public_code = 'MU-RACE'"))[0]!.starts_at as Date;
    const overlap = new Date(raceStart.getTime() + 30 * 60_000).toISOString();
    const r = await ctx.http().post('/v1/admin/matches').set(admin.auth).set('Idempotency-Key', uuid()).send(matchBody(pitchA, overlap)).expect(409);
    expect(r.body.code).toBe('LEASE_OVERLAP');
  });

  it("host dispatch: minimumga yetgan match -> offer -> accept -> boshqa offer'lar yopiladi", async () => {
    const id = await createAndPublish(matchBody(pitchA, inHours(5)));
    // 10 ta to'langan joy (simulyatsiya) -> T-12h ichida minimum bajarildi
    await q(ctx, 'UPDATE matches SET confirmed_slots = 10 WHERE id = $1', [id]);
    const dispatch = ctx.app.get(DispatchService);
    expect((await dispatch.run()).offered).toBe(1);
    expect((await dispatch.run()).offered).toBe(0); // offer kutilmoqda — qayta yuborilmaydi

    const host = await login(ctx, '+998901110002');
    const offers = await ctx.http().get('/v1/host/offers').set(host.auth).expect(200);
    const offer = offers.body.find((o: { match: { id: string } }) => o.match.id === id);
    expect(offer).toMatchObject({ fee: { amount: 15000000 }, kit_required: true });
    const acc = await ctx.http().post(`/v1/host/offers/${offer.assignment_id}/accept`).set(host.auth).expect(200);
    expect(acc.body.assignment_status).toBe('accepted');
    expect((await ctx.http().get(`/v1/matches/${id}`).expect(200)).body.host_assigned).toBe(true);
    await q(ctx, 'UPDATE matches SET confirmed_slots = 0 WHERE id = $1', [id]);
  });

  it("bekor qilish: barcha to'lovlar hamyonga +10% bonus bilan qaytadi", async () => {
    const id = await createAndPublish(matchBody(pitch1, inHours(30), { format: '5v5', players_per_side: 5, min_players: 8, max_players: 10 }));
    const p11 = await login(ctx, '+998902000011');
    const p12 = await login(ctx, '+998902000012');
    await bookAndPayWithPayme(ctx, p11, id);
    await bookAndPayWithPayme(ctx, p12, id);

    const r = await ctx
      .http()
      .post(`/v1/admin/matches/${id}/cancel`)
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ reason: 'weather', refund_destination: 'wallet', wallet_bonus_pct: 10 })
      .expect(202);
    expect(r.body.refunds_queued).toBe(2);
    const w = await ctx.http().get(`/v1/payment-methods?match_id=${id}`).set(p11.auth).expect(200);
    expect(w.body.wallet_balance.amount).toBe(5500000);
    const m = (await q(ctx, 'SELECT status, confirmed_slots FROM matches WHERE id = $1', [id]))[0]!;
    expect(m).toEqual({ status: 'cancelled', confirmed_slots: 0 });
    await ctx.http().post(`/v1/admin/matches/${id}/cancel`).set(admin.auth).set('Idempotency-Key', uuid()).send({ reason: 'weather' }).expect(409);
  });

  it("minimumga yetmagan match deadline'da avtomatik bekor qilinadi", async () => {
    const id = await createAndPublish(matchBody(pitch1, inHours(2)));
    expect(await ctx.app.get(AdminService).cancelUnderfilled()).toBeGreaterThanOrEqual(1);
    expect((await q(ctx, 'SELECT status, cancel_reason FROM matches WHERE id = $1', [id]))[0]).toEqual({
      status: 'cancelled',
      cancel_reason: 'min_players_not_reached',
    });
  });

  it('OVERSELL: 6 joyli match, 10 ta parallel booking -> aniq 6 ta 201, 4 ta 409 MATCH_FULL', async () => {
    const id = await createAndPublish(matchBody(pitch1, inHours(50), { format: '3v3', players_per_side: 3, min_players: 4, max_players: 6 }));
    const players = [];
    for (let i = 13; i <= 22; i++) players.push(await login(ctx, `+9989020000${i}`));
    const sigs = await Promise.all(players.map((p) => signatureId(ctx, p, id)));
    const results = await Promise.all(
      players.map((p, i) =>
        ctx
          .http()
          .post('/v1/bookings')
          .set(p.auth)
          .set('Idempotency-Key', uuid())
          .send({ match_id: id, payment_method: 'payme', waiver_signature_id: sigs[i] }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(6);
    expect(results.filter((r) => r.status === 409).map((r) => r.body.code)).toEqual(['MATCH_FULL', 'MATCH_FULL', 'MATCH_FULL', 'MATCH_FULL']);
    const m = (await q(ctx, 'SELECT held_slots, confirmed_slots FROM matches WHERE id = $1', [id]))[0]!;
    expect(m).toEqual({ held_slots: 6, confirmed_slots: 0 });
  });

  it('outbox relay event\'larni Redis Stream\'ga chiqaradi', async () => {
    const relay = ctx.app.get(OutboxRelay);
    let total = 0;
    for (let n = await relay.run(); n > 0; n = await relay.run()) total += n;
    expect(total).toBeGreaterThan(10);
    expect((await q(ctx, 'SELECT count(*)::int AS n FROM outbox_events WHERE published_at IS NULL'))[0]!.n).toBe(0);
  });
});
