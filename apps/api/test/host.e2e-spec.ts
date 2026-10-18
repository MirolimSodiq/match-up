import { randomUUID } from 'node:crypto';
import { bookAndPayWithPayme, createTestApp, login, matchId, q, type Session, type TestCtx } from './helpers';

describe('Host panel: roster, geofence, QR check-in, yakunlash', () => {
  let ctx: TestCtx;
  let host: Session;
  let bsk: string;
  let player: Session;
  let bookingId: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    host = await login(ctx, '+998901110002');
    bsk = await matchId(ctx, 'MU-BSK1');
    player = await login(ctx, '+998902000008');
    ({ bookingId } = await bookAndPayWithPayme(ctx, player, bsk));
  });
  afterAll(() => ctx.close());

  it("player host endpointlariga kira olmaydi; host o'z match'larini ko'radi", async () => {
    await ctx.http().get('/v1/host/matches').set(player.auth).expect(403);
    const r = await ctx.http().get('/v1/host/matches').set(host.auth).expect(200);
    expect(r.body.map((m: { match: { public_code: string } }) => m.match.public_code)).toContain('MU-BSK1');
  });

  it('roster: ticket public key bilan; geofence', async () => {
    const roster = await ctx.http().get(`/v1/host/matches/${bsk}/roster`).set(host.auth).expect(200);
    expect(roster.body.qr_public_key).toMatch(/^[\w-]{43}$/);
    expect(roster.body.sides.map((s: { label: string }) => s.label)).toEqual(['Oranges', 'Blues']);
    expect(roster.body.participants).toEqual([expect.objectContaining({ status: 'confirmed', is_guest: false })]);

    const far = await ctx.http().post(`/v1/host/matches/${bsk}/arrive`).set(host.auth).send({ location: { lat: 41.2995, lng: 69.2401 } }).expect(422);
    expect(far.body.code).toBe('OUTSIDE_GEOFENCE');
    expect(far.body.detail).toMatch(/\d+ m/);
    const near = await ctx.http().post(`/v1/host/matches/${bsk}/arrive`).set(host.auth).send({ location: { lat: 41.3641, lng: 69.2871 } }).expect(200);
    expect(near.body.distance_m).toBeLessThan(200);
  });

  it('QR check-in: imzo tekshiruvi, offline sync idempotentligi', async () => {
    const t = await ctx.http().get(`/v1/bookings/${bookingId}/ticket`).set(player.auth).expect(200);
    const qr = t.body.tickets[0].qr_payload as string;
    const eid = randomUUID();
    const now = new Date().toISOString();
    const tampered = qr.slice(0, -4) + (qr.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const r = await ctx
      .http()
      .post(`/v1/host/matches/${bsk}/checkins`)
      .set(host.auth)
      .send({
        events: [
          { client_event_id: eid, action: 'check_in', method: 'qr', qr_payload: qr, occurred_at: now, location: { lat: 41.364, lng: 69.287 } },
          { client_event_id: eid, action: 'check_in', method: 'qr', qr_payload: qr, occurred_at: now },
          { client_event_id: randomUUID(), action: 'check_in', method: 'qr', qr_payload: tampered, occurred_at: now },
          { client_event_id: randomUUID(), action: 'check_in', method: 'manual', participant_id: randomUUID(), occurred_at: now },
        ],
      })
      .expect(200);
    expect(r.body.results.map((x: { status: string; reason: string | null }) => [x.status, x.reason])).toEqual([
      ['accepted', null],
      ['duplicate', null],
      ['rejected', 'INVALID_SIGNATURE'],
      ['rejected', 'NOT_ON_ROSTER'],
    ]);
    const roster = await ctx.http().get(`/v1/host/matches/${bsk}/roster`).set(host.auth).expect(200);
    expect(roster.body.participants[0]).toMatchObject({ status: 'checked_in' });

    await ctx
      .http()
      .patch(`/v1/host/matches/${bsk}/participants/${roster.body.participants[0].participant_id}`)
      .set(host.auth)
      .send({ side_no: 2 })
      .expect(200);
  });

  it("yakunlash: o'yin boshlanmasdan — 409; keyin hisob, statistika, booking completed", async () => {
    const body = { scores: [{ side_no: 1, score: 21 }, { side_no: 2, score: 18 }], incidents: [{ type: 'other', note: 'test' }] };
    expect((await ctx.http().post(`/v1/host/matches/${bsk}/complete`).set(host.auth).send(body).expect(409)).body.code).toBe('INVALID_STATE');

    // Vaqtni simulyatsiya: o'yin boshlangan
    await q(ctx, "UPDATE matches SET starts_at = now() - interval '80 minutes', ends_at = now() + interval '10 minutes', booking_closes_at = now() - interval '2 hours', min_players_deadline = now() - interval '3 hours' WHERE id = $1", [bsk]);
    const done = await ctx.http().post(`/v1/host/matches/${bsk}/complete`).set(host.auth).send(body).expect(200);
    expect(done.body).toMatchObject({ assignment_status: 'completed', checked_in_count: 1 });
    expect((await q(ctx, 'SELECT status FROM bookings WHERE id = $1', [bookingId]))[0]!.status).toBe('completed');
    const prof = (await q(ctx, "SELECT games_played FROM player_sport_profiles p JOIN sports s ON s.id = p.sport_id WHERE p.user_id = $1 AND s.code = 'basketball'", [player.userId]))[0]!;
    expect(prof.games_played).toBe(1);
    const ev = await q(ctx, "SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'MatchCompleted'", [bsk]);
    expect(ev[0]!.payload.scores).toHaveLength(2);
  });
});
