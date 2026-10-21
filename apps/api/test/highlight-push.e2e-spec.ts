import type Redis from 'ioredis';
import { EVENTS_STREAM } from '../src/common/outbox';
import { OutboxRelay } from '../src/jobs/jobs.module';
import { EventConsumers } from '../src/notifications/notification-jobs';
import { REDIS } from '../src/redis/redis.module';
import { bookAndPayWithPayme, createTestApp, login, q, uuid, type Session, type TestCtx } from './helpers';

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
const expoToken = () => `ExponentPushToken[${uuid()}]`;
const WORKER = { Authorization: 'Bearer e2e-media-worker-token-0123456789abcdef' };

/**
 * Highlight push: worker natijasi -> `HighlightReady` (outbox) -> NotificationEvents -> `notifications` -> FakePushSender.
 * Klip `complete` holatiga SQL bilan keltiriladi (yuklash/MinIO media spec'ida); event haqiqiy worker endpoint'idan chiqadi.
 */
describe('Notifications: highlight tayyor / ulashildi push xabarlari', () => {
  let ctx: TestCtx;
  let host: Session;
  let matchId: string;
  let tagged: Session; // ishtirokchi, teglangan, consent bor (ru)
  let revoked: Session; // ishtirokchi, teglangan, keyin media_appearance qaytarib olingan
  let fan: Session; // ishtirokchi, teglanmagan (en)
  let outsider: Session; // ishtirokchi emas
  const devices = new Map<string, string>();
  let phoneSeq = 0;

  /** Outbox -> Redis Stream -> consumer group'lar. */
  async function pump() {
    const relay = ctx.app.get(OutboxRelay);
    while ((await relay.run()) > 0);
    await ctx.app.get(EventConsumers).drain();
  }

  async function newPlayer(locale: string, book: boolean): Promise<Session> {
    const s = await login(ctx, `+99893710${String(++phoneSeq).padStart(4, '0')}`);
    await ctx.http().patch('/v1/me').set(s.auth).send({ locale }).expect(200);
    await ctx.http().put('/v1/me/consents').set(s.auth).send({ consents: [{ purpose: 'media_appearance', granted: true }] }).expect(200);
    const token = expoToken();
    await ctx.http().put('/v1/me/devices').set(s.auth).send({ push_token: token, platform: 'ios', app_version: '1.0.0' }).expect(200);
    devices.set(s.userId, token);
    if (book) {
      const req = await ctx.http().get(`/v1/waivers/required?match_id=${matchId}`).set(s.auth).expect(200);
      const tpl = req.body.template;
      await ctx
        .http()
        .post(`/v1/waivers/${tpl.id}/signatures`)
        .set(s.auth)
        .send({ accepted: true, method: 'clickwrap', document_sha256: tpl.document_sha256, match_id: matchId })
        .expect(201);
      await bookAndPayWithPayme(ctx, s, matchId);
    }
    return s;
  }

  /** Faqat highlight push'lari (booking xabarlari ham shu qurilmalarga boradi). */
  const pushesTo = (s: Session) => ctx.push.to(devices.get(s.userId)!).filter((m) => String(m.data?.type).startsWith('highlight.'));

  async function notificationsOf(s: Session) {
    return q(
      ctx,
      `SELECT type, status, category, locale, payload, dedupe_key FROM notifications
       WHERE user_id = $1 AND type LIKE 'highlight.%' ORDER BY created_at, id`,
      [s.userId],
    );
  }

  /** `POST /media/{id}/complete` natijasi: media processing, highlight (nashr qilinmagan), teglar, queued job. */
  async function createHighlight(title: string | null, taggedIds: string[]) {
    const mediaId = uuid();
    await q(
      ctx,
      `INSERT INTO media_assets (id, owner_user_id, kind, status, storage_region, bucket, object_key, content_type, size_bytes,
                                 duration_ms, uploaded_at, context)
       VALUES ($1, $2, 'video', 'processing', 'uz-1', 'matchup-e2e-media-raw', $3, 'video/mp4', 1000, 15000, now(), $4)`,
      [mediaId, host.userId, `highlights/${matchId}/${mediaId}/source.mp4`, JSON.stringify({ kind: 'highlight', match_id: matchId, title })],
    );
    const [h] = await q(
      ctx,
      `INSERT INTO highlights (match_id, media_asset_id, created_by, source, title, duration_ms, visibility)
       VALUES ($1, $2, $3, 'host_manual', $4, 15000, 'participants') RETURNING id`,
      [matchId, mediaId, host.userId, title],
    );
    for (const userId of taggedIds) {
      await q(ctx, 'INSERT INTO highlight_tags (highlight_id, user_id, tagged_by) VALUES ($1, $2, $3)', [h!.id, userId, host.userId]);
    }
    const [job] = await q(
      ctx,
      `INSERT INTO media_processing_jobs (media_asset_id, type, status, input)
       VALUES ($1, 'transcode', 'queued', $2) RETURNING id`,
      [mediaId, JSON.stringify({ profile: 'highlight_v1', highlight_id: h!.id, match_id: matchId })],
    );
    return { highlightId: h!.id as string, jobId: job!.id as string };
  }

  /** Soxta worker: start -> ready (natija tranzaksiyasida HighlightReady chiqadi). */
  async function workerReady(jobId: string) {
    const start = await ctx.http().post(`/internal/media/jobs/${jobId}/start`).set(WORKER).send({ worker_version: 'e2e/1' }).expect(200);
    const prefix = start.body.output.prefix as string;
    const output = {
      hls_master_key: `${prefix}hls/master.m3u8`,
      renditions: [{ name: '720p', width: 720, height: 1280, bandwidth: 2_800_000, codecs: 'avc1.4d4028,mp4a.40.2', playlist_key: `${prefix}hls/720p/index.m3u8` }],
      thumbnail_key: `${prefix}thumb.jpg`,
      vertical_key: `${prefix}vertical.mp4`,
      duration_ms: 14_870,
      width: 1080,
      height: 1920,
      has_audio: true,
    };
    await ctx.http().post(`/internal/media/jobs/${jobId}/result`).set(WORKER).send({ status: 'ready', worker_version: 'e2e/1', output }).expect(200);
  }

  async function readyEvent(highlightId: string) {
    const ev = await q(ctx, "SELECT * FROM outbox_events WHERE event_type = 'HighlightReady' AND aggregate_id = $1", [highlightId]);
    expect(ev).toHaveLength(1);
    return ev[0]!;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    // Oldingi spec'lardan qolgan event'lar consumer group yaratilishidan oldin stream'ga chiqadi va o'tkazib yuboriladi
    while ((await ctx.app.get(OutboxRelay).run()) > 0);
    await ctx.app.get(EventConsumers).ensureGroups();

    const admin = await login(ctx, '+998901110001');
    const pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'chilonzor-arena'"))[0]!.id;
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitch, sport: 'football', starts_at: inHours(300), duration_min: 90, format: '7v7', players_per_side: 7,
        min_players: 10, max_players: 14, price: { amount: 5000000, currency: 'UZS' }, lease_cost: { amount: 40000000, currency: 'UZS' },
        title: { 'uz-Latn': 'Kechki futbol', ru: 'Вечерний футбол', en: 'Evening football' },
      })
      .expect(201);
    matchId = c.body.id;
    await ctx.http().post(`/v1/admin/matches/${matchId}/publish`).set(admin.auth).expect(200);

    host = await login(ctx, '+998901110002');
    await q(
      ctx,
      `INSERT INTO host_assignments (match_id, host_user_id, status, fee_amount, currency, offer_expires_at, responded_at)
       VALUES ($1, $2, 'accepted', 15000000, 'UZS', now(), now())`,
      [matchId, host.userId],
    );
    const hostToken = expoToken();
    await ctx.http().put('/v1/me/devices').set(host.auth).send({ push_token: hostToken, platform: 'ios' }).expect(200);
    devices.set(host.userId, hostToken);

    tagged = await newPlayer('ru', true);
    revoked = await newPlayer('uz-Latn', true);
    fan = await newPlayer('en', true);
    await ctx.http().patch('/v1/me').set(fan.auth).send({ display_name: 'Aziz' }).expect(200);
    outsider = await newPlayer('uz-Latn', false);
    await pump(); // booking xabarlari
  });

  afterAll(async () => {
    await ctx.close();
  });

  let first: string;

  it("HighlightReady: teglanganga 'sizni belgilashdi', qolgan ishtirokchilarga 'o'yiningizdan highlight'; consent qayta tekshiriladi", async () => {
    const { highlightId, jobId } = await createHighlight('Ajoyib gol', [tagged.userId, revoked.userId]);
    first = highlightId;
    // Teglangandan keyin, klip tayyor bo'lguncha consent qaytarib olindi
    await ctx.http().put('/v1/me/consents').set(revoked.auth).send({ consents: [{ purpose: 'media_appearance', granted: false }] }).expect(200);
    await workerReady(jobId);
    await pump();
    const ev = await readyEvent(highlightId);
    const data = { url: `/highlight/${highlightId}`, highlight_id: highlightId, match_id: matchId };

    const [t] = pushesTo(tagged);
    expect(pushesTo(tagged)).toHaveLength(1);
    expect(t).toMatchObject({ title: 'Вас отметили в хайлайте', data: { ...data, type: 'highlight.tagged' }, priority: 'default' });
    expect(t!.body).toMatch(/^«Ajoyib gol» — «Вечерний футбол», \d{1,2} \S+ в \d{2}:\d{2}\. Нажмите, чтобы посмотреть\.$/);
    expect(await notificationsOf(tagged)).toEqual([
      expect.objectContaining({
        type: 'highlight.tagged',
        status: 'sent',
        category: 'transactional',
        locale: 'ru',
        dedupe_key: `evt:${ev.id}:${tagged.userId}`,
        payload: expect.objectContaining({ data }),
      }),
    ]);

    // Consent'i yo'q — teg haqida xabar emas, oddiy ishtirokchi sifatida
    expect(pushesTo(revoked).map((m) => m.data?.type)).toEqual(['highlight.ready']);
    expect(pushesTo(revoked)[0]).toMatchObject({ title: "O'yiningizdan highlight", data });

    const [f] = pushesTo(fan);
    expect(pushesTo(fan)).toHaveLength(1);
    expect(f).toMatchObject({ title: 'A highlight from your game', data: { ...data, type: 'highlight.ready' } });
    expect(f!.body).toMatch(/^“Ajoyib gol” — Evening football, \S+ \d{1,2} at \d{2}:\d{2}\. Watch the clip!$/);
    expect((await notificationsOf(fan))[0]).toMatchObject({ category: 'transactional', dedupe_key: `evt:${ev.id}:${fan.userId}` });

    // Ishtirokchi emas va klip muallifi (host) — xabar yo'q
    expect(pushesTo(outsider)).toEqual([]);
    expect(pushesTo(host)).toEqual([]);
    expect(await notificationsOf(outsider)).toEqual([]);
    expect(await notificationsOf(host)).toEqual([]);

    // Idempotentlik: xuddi shu outbox event stream'ga qayta tushdi — yangi xabar yo'q
    await ctx.app.get<Redis>(REDIS).xadd(
      EVENTS_STREAM, '*', 'id', ev.id, 'type', ev.event_type, 'aggregate', `highlight:${highlightId}`, 'payload', JSON.stringify(ev.payload),
    );
    await pump();
    for (const s of [tagged, revoked, fan]) expect(pushesTo(s)).toHaveLength(1);
    expect(await q(ctx, "SELECT count(*)::int AS n FROM notifications WHERE dedupe_key LIKE $1", [`evt:${ev.id}:%`])).toEqual([{ n: 3 }]);
  });

  it("ikkinchi klip: teglangan yana xabar oladi, ishtirokchilarga match uchun bitta xabar (spam yo'q)", async () => {
    const { highlightId, jobId } = await createHighlight(null, [tagged.userId]);
    await workerReady(jobId);
    await pump();

    const msgs = pushesTo(tagged);
    expect(msgs.map((m) => m.data?.highlight_id)).toEqual([first, highlightId]);
    expect(msgs[1]!.body).toMatch(/^«Вечерний футбол», /); // klip nomisiz
    expect(pushesTo(fan)).toHaveLength(1);
    expect(pushesTo(revoked)).toHaveLength(1);
  });

  it("navbatda turganda o'chirilgan klip — xabar yo'q", async () => {
    const { highlightId, jobId } = await createHighlight('Tez orada', [tagged.userId]);
    await workerReady(jobId);
    await q(ctx, 'UPDATE highlights SET deleted_at = now() WHERE id = $1', [highlightId]);
    await pump();
    await readyEvent(highlightId);
    expect(pushesTo(tagged).map((m) => m.data?.highlight_id)).not.toContain(highlightId);
    expect(await q(ctx, "SELECT 1 FROM notifications WHERE payload->'data'->>'highlight_id' = $1", [highlightId])).toEqual([]);
  });

  it("HighlightShared: teglanganlarga (consent bilan) bir marta, ulashganning o'ziga yo'q", async () => {
    await ctx.http().post(`/v1/highlights/${first}/share`).set(fan.auth).send({ channel: 'telegram' }).expect(201);
    await pump();

    const shared = pushesTo(tagged).filter((m) => m.data?.type === 'highlight.shared');
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ title: 'Вашим хайлайтом поделились', data: { url: `/highlight/${first}`, highlight_id: first, match_id: matchId } });
    expect(shared[0]!.body).toMatch(/^Aziz поделился\(-ась\) клипом, где вы отмечены, — «Вечерний футбол», /);
    const [ev] = await q(ctx, "SELECT id FROM outbox_events WHERE event_type = 'HighlightShared' AND aggregate_id = $1", [first]);
    expect((await notificationsOf(tagged)).at(-1)).toMatchObject({ type: 'highlight.shared', dedupe_key: `evt:${ev!.id}:${tagged.userId}` });
    // Consent qaytarib olingan teg va ulashganning o'zi — xabar yo'q
    expect(pushesTo(revoked).filter((m) => m.data?.type === 'highlight.shared')).toEqual([]);
    expect(pushesTo(fan).filter((m) => m.data?.type === 'highlight.shared')).toEqual([]);

    // Keyingi ulashishlar jim: boshqa ishtirokchi yana ulashdi, teglangan o'zi ulashdi
    await ctx.http().post(`/v1/highlights/${first}/share`).set(revoked.auth).send({ channel: 'link' }).expect(201);
    await ctx.http().post(`/v1/highlights/${first}/share`).set(tagged.auth).send({ channel: 'instagram' }).expect(201);
    await pump();
    expect(pushesTo(tagged).filter((m) => m.data?.type === 'highlight.shared')).toHaveLength(1);
    expect(
      await q(ctx, "SELECT count(*)::int AS n FROM notifications WHERE type = 'highlight.shared' AND payload->'data'->>'highlight_id' = $1", [first]),
    ).toEqual([{ n: 1 }]);
  });
});
