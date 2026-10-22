import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HostNoShowAlerts, HostPayouts } from '../src/host/host-ops.service';
import { OutboxRelay } from '../src/jobs/jobs.module';
import { ErasureService } from '../src/privacy/erasure.service';
import { glicko2 } from '../src/ratings/glicko2';
import { PostMatchConsumer } from '../src/ratings/ratings.service';
import { bookAndPayWithPayme, createTestApp, login, q, uuid, type Session, type TestCtx } from './helpers';

const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');

describe("O'yindan keyin: Glicko-2 reyting, feedback, host no-show ogohlantirishi, haftalik payout", () => {
  let ctx: TestCtx;
  let admin: Session;
  let host: Session;
  let hostName: string;
  let pitch: string;
  let phoneSeq = 0;

  // Telegram Bot API mock: sendMessage'larni yig'adi; `failNext` — keyingi so'rov 500
  const telegram: { messages: { chat_id: string; text: string }[]; failNext: boolean; paths: string[] } = { messages: [], failNext: false, paths: [] };
  let tgServer: Server;
  const savedEnv = { ...process.env };

  /** Har match o'z vaqtida (bir maydon — ijara ustma-ust tushmasin); keyin test vaqtni SQL bilan suradi. */
  let slot = 0;
  async function createMatch(title: string): Promise<string> {
    const startsInMin = 5 * 24 * 60 + ++slot * 120;
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitch,
        sport: 'football',
        starts_at: inMinutes(startsInMin),
        duration_min: 60,
        format: '5v5',
        players_per_side: 5,
        min_players: 4,
        max_players: 10,
        price: { amount: 4000000, currency: 'UZS' },
        lease_cost: { amount: 20000000, currency: 'UZS' },
        host_fee: { amount: 10000000, currency: 'UZS' },
        title: { 'uz-Latn': title },
      });
    if (c.status !== 201) throw new Error(JSON.stringify(c.body));
    await ctx.http().post(`/v1/admin/matches/${c.body.id}/publish`).set(admin.auth).expect(200);
    return c.body.id;
  }

  async function assignHost(mId: string, status: 'accepted' | 'arrived' = 'accepted') {
    await q(
      ctx,
      `INSERT INTO host_assignments (match_id, host_user_id, status, fee_amount, currency, offer_expires_at, responded_at)
       VALUES ($1, $2, $3, 10000000, 'UZS', now(), now())`,
      [mId, host.userId, status],
    );
  }

  /** Yangi o'yinchi: waiver imzolangan, Payme bilan to'langan booking. */
  async function bookedPlayer(mId: string): Promise<Session> {
    const s = await login(ctx, `+99893800${String(++phoneSeq).padStart(4, '0')}`);
    const tpl = (await ctx.http().get(`/v1/waivers/required?match_id=${mId}`).set(s.auth).expect(200)).body.template;
    await ctx
      .http()
      .post(`/v1/waivers/${tpl.id}/signatures`)
      .set(s.auth)
      .send({ accepted: true, method: 'clickwrap', document_sha256: tpl.document_sha256, match_id: mId })
      .expect(201);
    await bookAndPayWithPayme(ctx, s, mId);
    return s;
  }

  async function pump() {
    const relay = ctx.app.get(OutboxRelay);
    while ((await relay.run()) > 0);
    await ctx.app.get(PostMatchConsumer).drain();
  }

  const rating = async (userId: string) =>
    (
      await q<{ rating: string; rating_deviation: string; rating_volatility: string; games_played: number }>(
        ctx,
        `SELECT p.rating, p.rating_deviation, p.rating_volatility, p.games_played FROM player_sport_profiles p
         JOIN sports s ON s.id = p.sport_id WHERE p.user_id = $1 AND s.code = 'football'`,
        [userId],
      )
    )[0]!;

  beforeAll(async () => {
    tgServer = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        telegram.paths.push(req.url ?? '');
        res.setHeader('content-type', 'application/json');
        if (telegram.failNext) {
          telegram.failNext = false;
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, description: 'Internal Server Error' }));
          return;
        }
        telegram.messages.push(JSON.parse(body));
        res.end(JSON.stringify({ ok: true, result: { message_id: telegram.messages.length } }));
      });
    });
    await new Promise<void>((r) => tgServer.listen(0, '127.0.0.1', r));
    process.env.TELEGRAM_API_URL = `http://127.0.0.1:${(tgServer.address() as AddressInfo).port}`;
    process.env.OPS_TELEGRAM_CHAT_ID = '-100123';
    process.env.ADMIN_PUBLIC_URL = 'https://admin.e2e.matchup.example';

    ctx = await createTestApp();
    admin = await login(ctx, '+998901110001');
    pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'samarkand-mini'"))[0]!.id;
    const city = (await q(ctx, "SELECT id FROM cities WHERE slug = 'samarkand'"))[0]!.id;
    const h = await ctx
      .http()
      .post('/v1/admin/hosts')
      .set(admin.auth)
      .send({ phone: '+998938009000', display_name: 'Post Match Host', city_id: city, base_location: { lat: 39.65, lng: 66.96 }, sports: ['football'], approve: true })
      .expect(201);
    hostName = h.body.display_name;
    host = await login(ctx, '+998938009000');
    await ctx.app.get(PostMatchConsumer).ensureGroup();
  });

  afterAll(async () => {
    await ctx.close();
    await new Promise((r) => tgServer.close(r));
    for (const k of ['TELEGRAM_API_URL', 'OPS_TELEGRAM_CHAT_ID', 'ADMIN_PUBLIC_URL']) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('glicko2: Glickman (2013) namunasi', () => {
    const r = glicko2({ rating: 1500, rd: 200, vol: 0.06 }, [
      { opponent: { rating: 1400, rd: 30 }, score: 1 },
      { opponent: { rating: 1550, rd: 100 }, score: 0 },
      { opponent: { rating: 1700, rd: 300 }, score: 0 },
    ]);
    expect(r.rating).toBeCloseTo(1464.05, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
    expect(r.vol).toBeCloseTo(0.06, 4);
  });

  let rated: string;
  let players: Session[];

  it("reyting: MatchCompleted -> g'oliblar ko'tariladi, yutqazganlar tushadi; kelmagan va jamoasizlar reytingsiz; qayta yetkazish — ikki marta emas", async () => {
    rated = await createMatch('Reyting testi');
    await assignHost(rated);
    players = [];
    for (let i = 0; i < 6; i++) players.push(await bookedPlayer(rated));
    // O'yin boshlangan
    await q(
      ctx,
      `UPDATE matches SET starts_at = now() - interval '70 minutes', ends_at = now() - interval '10 minutes',
              booking_closes_at = now() - interval '2 hours', min_players_deadline = now() - interval '3 hours' WHERE id = $1`,
      [rated],
    );
    const pid = async (s: Session) => (await q(ctx, 'SELECT id FROM match_participants WHERE match_id = $1 AND user_id = $2', [rated, s.userId]))[0]!.id;
    // 0,1 — 1-jamoa; 2,3 — 2-jamoa; 4 — kelgan, lekin jamoasiz; 5 — kelmagan (no-show)
    const sides = [1, 1, 2, 2, null];
    for (let i = 0; i < 5; i++) {
      await ctx
        .http()
        .patch(`/v1/host/matches/${rated}/participants/${await pid(players[i]!)}`)
        .set(host.auth)
        .send({ status: 'checked_in', ...(sides[i] ? { side_no: sides[i] } : {}) })
        .expect(200);
    }
    await ctx
      .http()
      .post(`/v1/host/matches/${rated}/complete`)
      .set(host.auth)
      .send({ scores: [{ side_no: 1, score: 5 }, { side_no: 2, score: 3 }] })
      .expect(200);

    await pump();
    const changes = await q(ctx, 'SELECT user_id, side_no, score FROM player_rating_changes WHERE match_id = $1 ORDER BY side_no, user_id', [rated]);
    expect(changes).toHaveLength(4);
    expect(changes.map((c) => [c.side_no, Number(c.score)])).toEqual([[1, 1], [1, 1], [2, 0], [2, 0]]);

    const [w1, w2, l1, l2, benched, noShow] = await Promise.all(players.map((p) => rating(p.userId)));
    // Hamma 1500/350 dan boshlagan: g'oliblar bir xil ko'tariladi, yutqazganlar shuncha tushadi, RD kamayadi
    expect(Number(w1!.rating)).toBeGreaterThan(1600);
    expect(w1!.rating).toBe(w2!.rating);
    expect(l1!.rating).toBe(l2!.rating);
    expect(Number(w1!.rating) - 1500).toBeCloseTo(1500 - Number(l1!.rating), 1);
    expect(Number(w1!.rating_deviation)).toBeLessThan(350);
    expect(Number(w1!.rating_volatility)).toBeCloseTo(0.06, 3);
    expect({ rating: benched!.rating, games: benched!.games_played }).toEqual({ rating: '1500.00', games: 1 });
    expect(noShow!.rating).toBe('1500.00');

    // At-least-once: event qayta chiqarilsa ham reyting o'zgarmaydi
    await q(ctx, "UPDATE outbox_events SET published_at = NULL WHERE event_type = 'MatchCompleted' AND aggregate_id = $1", [rated]);
    await pump();
    expect(await q(ctx, 'SELECT count(*)::int AS n FROM player_rating_changes WHERE match_id = $1', [rated])).toEqual([{ n: 4 }]);
    expect((await rating(players[0]!.userId)).rating).toBe(w1!.rating);
  });

  it("feedback: faqat kelgan o'yinchi; host reytingi o'rtacha; qayta yuborish yangilaydi; validatsiya va muddat", async () => {
    const [p0, p1, p2, , , noShow] = players;
    const view = await ctx.http().get(`/v1/matches/${rated}/feedback`).set(p0!.auth).expect(200);
    expect(view.body).toMatchObject({ match_id: rated, open: true, host: { user_id: host.userId, display_name: hostName }, given: [] });
    expect(view.body.players.map((p: { user_id: string }) => p.user_id).sort()).toEqual(
      players.slice(1, 5).map((p) => p.userId).sort(),
    );

    // Kelmagan o'yinchi va begona — 403
    await ctx.http().get(`/v1/matches/${rated}/feedback`).set(noShow!.auth).expect(403);
    await ctx.http().post(`/v1/matches/${rated}/feedback`).set(admin.auth).send({ items: [{ target: 'match', rating: 5 }] }).expect(403);

    const r = await ctx
      .http()
      .post(`/v1/matches/${rated}/feedback`)
      .set(p0!.auth)
      .send({
        items: [
          { target: 'host', rating: 5, tags: ['on_time', 'fair_teams'] },
          { target: 'player', to_user_id: p2!.userId, rating: 4, comment: "Yaxshi o'ynadi" },
          { target: 'match', rating: 5 },
        ],
      })
      .expect(200);
    expect(r.body.given).toHaveLength(3);
    expect(r.body.given.find((g: { target: string }) => g.target === 'host')).toMatchObject({ to_user_id: host.userId, rating: 5, tags: ['on_time', 'fair_teams'] });
    const hostRating = async () => (await q(ctx, 'SELECT rating_avg, rating_count FROM host_profiles WHERE user_id = $1', [host.userId]))[0];
    expect(await hostRating()).toEqual({ rating_avg: '5.00', rating_count: 1 });

    await ctx.http().post(`/v1/matches/${rated}/feedback`).set(p1!.auth).send({ items: [{ target: 'host', rating: 4 }] }).expect(200);
    expect(await hostRating()).toEqual({ rating_avg: '4.50', rating_count: 2 });
    // Qayta yuborish — yangi qator emas, yangilash
    const again = await ctx.http().post(`/v1/matches/${rated}/feedback`).set(p0!.auth).send({ items: [{ target: 'host', rating: 2 }] }).expect(200);
    expect(again.body.given).toHaveLength(3);
    expect(await hostRating()).toEqual({ rating_avg: '3.00', rating_count: 2 });

    // O'zini, kelmaganni baholash, match uchun to_user_id — 422
    const bad = await ctx
      .http()
      .post(`/v1/matches/${rated}/feedback`)
      .set(p0!.auth)
      .send({
        items: [
          { target: 'player', to_user_id: p0!.userId, rating: 1 },
          { target: 'player', to_user_id: noShow!.userId, rating: 1 },
          { target: 'venue', to_user_id: p1!.userId, rating: 3 },
        ],
      })
      .expect(422);
    expect(bad.body.errors.map((e: { field: string }) => e.field)).toEqual(['items[0].to_user_id', 'items[1].to_user_id', 'items[2].to_user_id']);
    await ctx.http().post(`/v1/matches/${rated}/feedback`).set(p0!.auth).send({ items: [{ target: 'match', rating: 6 }] }).expect(422);

    // Muddat o'tdi
    await q(ctx, "UPDATE matches SET completed_at = now() - interval '8 days' WHERE id = $1", [rated]);
    expect((await ctx.http().get(`/v1/matches/${rated}/feedback`).set(p0!.auth).expect(200)).body.open).toBe(false);
    expect((await ctx.http().post(`/v1/matches/${rated}/feedback`).set(p0!.auth).send({ items: [{ target: 'match', rating: 1 }] }).expect(409)).body.code).toBe('INVALID_STATE');
    await q(ctx, 'UPDATE matches SET completed_at = now() WHERE id = $1', [rated]);

    // Yakunlanmagan match — 409
    const upcoming = await createMatch('Feedback yopiq');
    const early = await bookedPlayer(upcoming);
    await q(ctx, "UPDATE match_participants SET status = 'checked_in' WHERE match_id = $1 AND user_id = $2", [upcoming, early.userId]);
    expect((await ctx.http().get(`/v1/matches/${upcoming}/feedback`).set(early.auth).expect(409)).body.code).toBe('INVALID_STATE');
  });

  it("erasure: muallifning feedback izohlari o'chadi, baholar (va host reytingi) qoladi", async () => {
    const author = players[0]!;
    const r = await ctx.http().delete('/v1/me').set(author.auth).expect(202);
    await q(ctx, "UPDATE data_subject_requests SET due_at = now() - interval '1 minute' WHERE id = $1", [r.body.id]);
    expect(await ctx.app.get(ErasureService).run()).toMatchObject({ erased: 1 });
    const left = await q(ctx, 'SELECT target, rating, comment FROM match_feedback WHERE match_id = $1 AND from_user_id = $2 ORDER BY target', [rated, author.userId]);
    expect(left).toEqual([
      { target: 'host', rating: 2, comment: null },
      { target: 'player', rating: 4, comment: null },
      { target: 'match', rating: 5, comment: null },
    ]);
    expect((await q(ctx, 'SELECT rating_avg FROM host_profiles WHERE user_id = $1', [host.userId]))[0]!.rating_avg).toBe('3.00');
  });

  let lateMatch: string;

  it("host no-show: T-15 da arrived yo'q -> Telegram ops guruhiga bir marta; arrived — jim; Telegram xatosi — keyingi safar qayta", async () => {
    const job = ctx.app.get(HostNoShowAlerts);
    // Oldingi suite'lardan qolgan muddati yetgan tayinlovlar shu yerda belgilanadi — quyidagi hisoblar faqat bizniki
    await job.run();
    lateMatch = await createMatch('Kech qolgan host');
    const onTime = await createMatch('Host joyida');
    await q(
      ctx,
      `UPDATE matches SET starts_at = now() + interval '10 minutes', ends_at = now() + interval '70 minutes',
              booking_closes_at = now(), min_players_deadline = now() - interval '1 hour' WHERE id = ANY($1::uuid[])`,
      [[lateMatch, onTime]],
    );
    await assignHost(lateMatch, 'accepted');
    await q(
      ctx,
      `INSERT INTO host_assignments (match_id, host_user_id, status, fee_amount, currency, offer_expires_at, responded_at, arrived_at)
       VALUES ($1, (SELECT id FROM users WHERE phone_e164 = '+998901110002'), 'arrived', 10000000, 'UZS', now(), now(), now())`,
      [onTime],
    );
    const code = async (id: string) => (await q(ctx, 'SELECT public_code FROM matches WHERE id = $1', [id]))[0]!.public_code as string;
    const lateCode = await code(lateMatch);
    const onTimeCode = await code(onTime);
    const mine = () => telegram.messages.filter((m) => m.text.includes(lateCode) || m.text.includes(onTimeCode));

    telegram.failNext = true;
    expect(await job.run()).toEqual({ alerted: 0, failed: 1 });
    expect(mine()).toHaveLength(0);
    expect((await q(ctx, 'SELECT no_show_alerted_at FROM host_assignments WHERE match_id = $1', [lateMatch]))[0]!.no_show_alerted_at).toBeNull();

    await job.run();
    expect(mine()).toHaveLength(1);
    const msg = mine()[0]!;
    expect(msg.chat_id).toBe('-100123');
    expect(msg.text).toContain('Host hali yetib kelmadi');
    expect(msg.text).toContain(`${lateCode} · Kech qolgan host`);
    expect(msg.text).toMatch(/\(1[01] daqiqa qoldi\)/);
    expect(msg.text).toContain(`Host: ${hostName}`);
    expect(msg.text).toContain(`https://admin.e2e.matchup.example/matches/${lateMatch}`);
    expect(msg.text).not.toContain('+998');
    expect(telegram.paths.at(-1)).toBe('/bot123456789:e2e-telegram-bot-secret/sendMessage');

    await job.run();
    expect(mine()).toHaveLength(1);
    expect(await q(ctx, "SELECT changes->>'delivered' AS delivered FROM audit_logs WHERE action = 'host.no_show_alert' AND entity_id = $1", [lateMatch])).toEqual([{ delivered: 'true' }]);
  });

  it("haftalik payout: o'tgan hafta bajarilganlar -> bitta payout; joriy hafta keyingisiga; qayta ishga tushirish xavfsiz", async () => {
    // Reyting match'i — o'tgan shanba, kech qolgan host match'i ham bajarilgan (o'tgan hafta), uchinchisi — shu hafta
    const lastSaturday = "(date_trunc('week', now() AT TIME ZONE 'Asia/Tashkent') - interval '2 days' + interval '20 hours') AT TIME ZONE 'Asia/Tashkent'";
    await q(ctx, `UPDATE host_assignments SET completed_at = ${lastSaturday} WHERE match_id = $1`, [rated]);
    await q(ctx, `UPDATE host_assignments SET status = 'completed', arrived_at = now(), completed_at = ${lastSaturday} - interval '1 day' WHERE match_id = $1`, [lateMatch]);
    const thisWeek = await createMatch('Shu hafta');
    await q(
      ctx,
      `INSERT INTO host_assignments (match_id, host_user_id, status, fee_amount, currency, offer_expires_at, completed_at)
       VALUES ($1, $2, 'completed', 7000000, 'UZS', now(), now())`,
      [thisWeek, host.userId],
    );

    const job = ctx.app.get(HostPayouts);
    const res = await job.run();
    const payouts = await q(ctx, 'SELECT id, period_start::text, period_end::text, amount, currency, status, assignments_count FROM host_payouts WHERE host_user_id = $1', [host.userId]);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ period_start: res.period_start, period_end: res.period_end, amount: 20000000, currency: 'UZS', status: 'pending', assignments_count: 2 });
    expect(new Date(res.period_end).getTime() - new Date(res.period_start).getTime()).toBe(6 * 86_400_000);
    const linked = await q(ctx, 'SELECT match_id FROM host_assignments WHERE host_user_id = $1 AND payout_id = $2 ORDER BY match_id', [host.userId, payouts[0]!.id]);
    expect(linked.map((l) => l.match_id).sort()).toEqual([rated, lateMatch].sort());
    expect((await q(ctx, 'SELECT payout_id FROM host_assignments WHERE match_id = $1', [thisWeek]))[0]!.payout_id).toBeNull();

    await job.run();
    expect(await q(ctx, 'SELECT count(*)::int AS n FROM host_payouts WHERE host_user_id = $1', [host.userId])).toEqual([{ n: 1 }]);
  });
});
