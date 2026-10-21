import { randomBytes } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import Redis from 'ioredis';
import { OutboxRelay } from '../src/jobs/jobs.module';
import { MediaService } from '../src/media/media.service';
import { EventConsumers } from '../src/notifications/notification-jobs';
import { bookAndPayWithPayme, createTestApp, login, q, uuid, type Session, type TestCtx } from './helpers';

/**
 * AI-Cam Bosqich A: to'liq o'yin yozuvi — kameralar, bib raqamlari, belgilar, yuklash (MinIO), recording_v1 job
 * (alohida stream), soxta worker natijasi -> kamera tayyor -> belgilardan klip'lar (clip_v1) -> player ko'rinishi,
 * HLS ijro, push.
 */
describe('Recordings: to\'liq o\'yin yozuvi va host belgilaridan klip\'lar', () => {
  const PART = 5 * 1024 * 1024;
  const WORKER = { Authorization: 'Bearer e2e-media-worker-token-0123456789abcdef' };
  const OUT = process.env.MEDIA_BUCKET!;
  const RECORDING_STREAM = 'matchup:media-jobs:recording';
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
  const file = randomBytes(PART + 77_777); // 2 qism
  const savedBatch = process.env.MEDIA_UPLOAD_URL_BATCH;

  let ctx: TestCtx;
  let redis: Redis;
  let host: Session;
  let otherHost: Session;
  let tagged: Session; // ishtirokchi, media_appearance bor
  let plain: Session; // ishtirokchi, consent yo'q
  let outsider: Session;
  let matchId: string;
  let startsMs: number;
  let taggedPid: string;
  let plainPid: string;
  const deviceTokens = new Map<string, string>();

  const at = (offsetMs: number) => new Date(startsMs + offsetMs).toISOString();
  const LEFT = uuid();
  const RIGHT = uuid();
  const m = { kickoff: uuid(), left: uuid(), right: uuid(), noSide: uuid(), mistake: uuid(), late: uuid(), outside: uuid() };

  const recordingUrl = () => `/v1/host/matches/${matchId}/recording`;
  const putCamera = (cam: string, body: Record<string, unknown>, s = host) =>
    ctx.http().put(`${recordingUrl()}/cameras/${cam}`).set(s.auth).send(body);
  const markers = (list: Record<string, unknown>[]) => ctx.http().post(`${recordingUrl()}/markers`).set(host.auth).send({ markers: list });

  async function pump() {
    const relay = ctx.app.get(OutboxRelay);
    while ((await relay.run()) > 0);
    await ctx.app.get(EventConsumers).drain();
  }

  async function newPlayer(phone: string, consent: boolean, book: boolean): Promise<Session> {
    const s = await login(ctx, phone);
    await ctx.http().put('/v1/me/consents').set(s.auth).send({ consents: [{ purpose: 'media_appearance', granted: consent }] }).expect(200);
    const token = `ExponentPushToken[${uuid()}]`;
    await ctx.http().put('/v1/me/devices').set(s.auth).send({ push_token: token, platform: 'ios', app_version: '1.0.0' }).expect(200);
    deviceTokens.set(s.userId, token);
    if (book) {
      const tpl = (await ctx.http().get(`/v1/waivers/required?match_id=${matchId}`).set(s.auth).expect(200)).body.template;
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

  async function streamFields(stream: string, id: string) {
    const entries = await redis.xrange(stream, id, id);
    return Object.fromEntries(entries[0]![1].reduce<string[][]>((a, v, i) => (i % 2 ? (a.at(-1)!.push(v), a) : [...a, [v]]), []));
  }

  async function jobOf(mediaId: string) {
    return (await q(ctx, 'SELECT id, status, input, message_id, recording_session_id FROM media_processing_jobs WHERE media_asset_id = $1 ORDER BY queued_at DESC', [mediaId]))[0]!;
  }

  /** Init -> qismlar (URL'lar bittadan: MEDIA_UPLOAD_URL_BATCH=1) -> complete (`parts` siz). */
  async function uploadCamera(cam: string): Promise<string> {
    const init = await ctx
      .http()
      .post(`${recordingUrl()}/cameras/${cam}/upload`)
      .set(host.auth)
      .send({ content_type: 'video/quicktime', size_bytes: file.length, duration_ms: 600_000 })
      .expect(201);
    expect(init.body.upload).toMatchObject({ part_size_bytes: PART, part_count: 2 });
    expect(init.body.upload.parts.map((p: { part_number: number }) => p.part_number)).toEqual([1]);
    const mediaId = init.body.media_id as string;
    expect((await fetch(init.body.upload.parts[0].url, { method: 'PUT', body: file.subarray(0, PART) })).status).toBe(200);
    const resume = await ctx.http().get(`/v1/media/${mediaId}/upload`).set(host.auth).expect(200);
    expect(resume.body.upload.parts.map((p: { part_number: number }) => p.part_number)).toEqual([2]);
    expect((await fetch(resume.body.upload.parts[0].url, { method: 'PUT', body: file.subarray(PART) })).status).toBe(200);
    const done = await ctx.http().post(`/v1/media/${mediaId}/complete`).set(host.auth).send({}).expect(202);
    expect(done.body).toMatchObject({ status: 'processing', highlight_id: null });
    return mediaId;
  }

  async function fakeWorkerReady(jobId: string, renditions: { name: string; bandwidth: number }[], extra: Record<string, unknown> = {}) {
    const start = await ctx.http().post(`/internal/media/jobs/${jobId}/start`).set(WORKER).send({ worker_version: 'e2e/1' }).expect(200);
    const prefix = start.body.output.prefix as string;
    const playlist = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:4', '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXTINF:4.0,', 'seg_000.ts', '#EXT-X-ENDLIST', ''].join('\n');
    for (const r of renditions) {
      await s3.send(new PutObjectCommand({ Bucket: OUT, Key: `${prefix}hls/${r.name}/index.m3u8`, Body: playlist }));
      await s3.send(new PutObjectCommand({ Bucket: OUT, Key: `${prefix}hls/${r.name}/seg_000.ts`, Body: `seg-${r.name}` }));
    }
    await s3.send(new PutObjectCommand({ Bucket: OUT, Key: `${prefix}thumb.jpg`, Body: Buffer.from([0xff, 0xd8]) }));
    const output = {
      hls_master_key: `${prefix}hls/master.m3u8`,
      renditions: renditions.map((r) => ({ name: r.name, width: 1920, height: 1080, bandwidth: r.bandwidth, playlist_key: `${prefix}hls/${r.name}/index.m3u8` })),
      thumbnail_key: `${prefix}thumb.jpg`,
      vertical_key: null,
      duration_ms: 600_000,
      width: 3840,
      height: 2160,
      has_audio: true,
      probe: { fps: 29.97 },
      ...extra,
    };
    const res = await ctx.http().post(`/internal/media/jobs/${jobId}/result`).set(WORKER).send({ status: 'ready', worker_version: 'e2e/1', output }).expect(200);
    return { start: start.body, prefix, res: res.body };
  }

  beforeAll(async () => {
    process.env.MEDIA_UPLOAD_URL_BATCH = '1';
    ctx = await createTestApp();
    redis = new Redis(process.env.REDIS_URL!);
    // Consumer group'lar '$' dan yaratiladi — keyingi event'lar o'tkazib yuborilmasin
    await pump();
    const admin = await login(ctx, '+998901110001');
    const pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'samarkand-mini'"))[0]!.id;
    const startsAt = new Date(Date.now() + 170 * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
    startsMs = Date.parse(startsAt);
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitch, sport: 'football', starts_at: startsAt, duration_min: 60, format: '5v5', players_per_side: 5,
        min_players: 8, max_players: 10, price: { amount: 3000000, currency: 'UZS' }, lease_cost: { amount: 20000000, currency: 'UZS' },
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
    otherHost = await login(ctx, '+998902000019'); // media spec'ida host qilingan, bu match'ga tayinlanmagan

    tagged = await newPlayer('+998937200001', true, true);
    plain = await newPlayer('+998937200002', false, true);
    outsider = await newPlayer('+998937200003', true, false);
    taggedPid = (await q(ctx, 'SELECT id FROM match_participants WHERE match_id = $1 AND user_id = $2', [matchId, tagged.userId]))[0]!.id;
    plainPid = (await q(ctx, 'SELECT id FROM match_participants WHERE match_id = $1 AND user_id = $2', [matchId, plain.userId]))[0]!.id;
  });

  afterAll(async () => {
    if (savedBatch === undefined) delete process.env.MEDIA_UPLOAD_URL_BATCH;
    else process.env.MEDIA_UPLOAD_URL_BATCH = savedBatch;
    s3.destroy();
    await redis.quit();
    await ctx.close();
  });

  it('bib raqami: roster\'da; bitta match\'da takrorlanmaydi; null — olib tashlash', async () => {
    const patch = (pid: string, body: Record<string, unknown>) =>
      ctx.http().patch(`/v1/host/matches/${matchId}/participants/${pid}`).set(host.auth).send(body);
    expect((await patch(taggedPid, { bib_number: 7 }).expect(200)).body).toMatchObject({ participant_id: taggedPid, bib_number: 7 });
    expect((await patch(plainPid, { bib_number: 7 }).expect(409)).body.code).toBe('BIB_TAKEN');
    expect((await patch(plainPid, { bib_number: 100 }).expect(422)).body.code).toBe('VALIDATION_FAILED');
    await patch(plainPid, { bib_number: 10 }).expect(200);
    const roster = await ctx.http().get(`/v1/host/matches/${matchId}/roster`).set(host.auth).expect(200);
    const bibs = Object.fromEntries(roster.body.participants.map((p: { participant_id: string; bib_number: number }) => [p.participant_id, p.bib_number]));
    expect(bibs).toEqual({ [taggedPid]: 7, [plainPid]: 10 });
    expect((await patch(plainPid, { bib_number: null }).expect(200)).body.bib_number).toBeNull();
    await patch(plainPid, { bib_number: 10 }).expect(200);
  });

  it('sessiya: yozuv yo\'q -> 404; kamera ro\'yxatga olinadi (idempotent), ruxsatlar va vaqt oynasi', async () => {
    await ctx.http().get(recordingUrl()).set(host.auth).expect(404);
    await ctx.http().get(`/v1/matches/${matchId}/recording`).set(tagged.auth).expect(404);

    await putCamera(LEFT, { position: 'left', started_at: at(-5 * 60_000) }, otherHost).expect(403);
    await putCamera(LEFT, { position: 'left', started_at: at(-5 * 60_000) }, tagged).expect(403);
    expect((await putCamera(LEFT, { position: 'left', started_at: at(-4 * 3600_000) }).expect(422)).body.errors[0]).toMatchObject({ field: 'started_at' });
    await putCamera(LEFT, { position: 'top', started_at: at(0) }).expect(422);

    const left = await putCamera(LEFT, { position: 'left', started_at: at(-5 * 60_000), device_model: 'iPhone 13', fps: 30, width: 3840, height: 2160, rig_type: 'two_phone' }).expect(200);
    expect(left.body).toMatchObject({ client_camera_id: LEFT, position: 'left', status: 'recording', recorded_by: host.userId, fps: 30, media: null });
    // Takroriy (javob yo'qolgan) — o'sha kamera
    const again = await putCamera(LEFT, { position: 'left', started_at: at(-5 * 60_000) }).expect(200);
    expect(again.body.id).toBe(left.body.id);
    await putCamera(RIGHT, { position: 'right', started_at: at(-4 * 60_000) }).expect(200);

    const s = await ctx.http().get(recordingUrl()).set(host.auth).expect(200);
    expect(s.body).toMatchObject({ match_id: matchId, status: 'recording', rig_type: 'two_phone', kickoff_at: null });
    expect(s.body.cameras.map((c: { position: string }) => c.position)).toEqual(['left', 'right']);
    expect(await q(ctx, 'SELECT count(*)::int AS n FROM recording_cameras')).toEqual([{ n: 2 }]);
  });

  it('belgilar: idempotent to\'plam, kick-off, rad etilganlar, bekor qilish', async () => {
    const r = await markers([
      { client_marker_id: m.kickoff, kind: 'kickoff', occurred_at: at(0) },
      { client_marker_id: m.left, kind: 'highlight', occurred_at: at(60_000), side: 'left', participant_id: taggedPid },
      { client_marker_id: m.right, kind: 'highlight', occurred_at: at(120_000), side: 'right' },
      { client_marker_id: m.noSide, kind: 'highlight', occurred_at: at(180_000), pre_ms: 8_000, post_ms: 2_000 },
      { client_marker_id: m.mistake, kind: 'highlight', occurred_at: at(200_000), side: 'left' },
      { client_marker_id: m.outside, kind: 'highlight', occurred_at: at(9 * 3600_000) },
      { client_marker_id: uuid(), kind: 'highlight', occurred_at: at(70_000), participant_id: uuid() },
    ]).expect(200);
    expect(r.body.results.map((x: { status: string; reason?: string }) => x.reason ?? x.status)).toEqual([
      'accepted', 'accepted', 'accepted', 'accepted', 'accepted', 'OUT_OF_WINDOW', 'UNKNOWN_PARTICIPANT',
    ]);
    expect(r.body.results[1].marker).toMatchObject({ kind: 'highlight', side: 'left', participant_id: taggedPid, pre_ms: 12_000, post_ms: 3_000, highlight_id: null });

    // Offline navbat qayta yubordi
    const dup = await markers([{ client_marker_id: m.left, kind: 'highlight', occurred_at: at(60_000), side: 'left' }]).expect(200);
    expect(dup.body.results[0]).toMatchObject({ status: 'duplicate', marker: { participant_id: taggedPid } });
    // Klip uzunligi 3..60 s
    await markers([{ client_marker_id: uuid(), kind: 'highlight', occurred_at: at(0), pre_ms: 55_000, post_ms: 30_000 }]).expect(422);

    await ctx.http().delete(`${recordingUrl()}/markers/${m.mistake}`).set(host.auth).expect(204);
    await ctx.http().delete(`${recordingUrl()}/markers/${m.mistake}`).set(host.auth).expect(204);
    await ctx.http().delete(`${recordingUrl()}/markers/${uuid()}`).set(host.auth).expect(404);

    const s = await ctx.http().get(recordingUrl()).set(host.auth).expect(200);
    expect(s.body.kickoff_at).toBe(at(0));
    expect(s.body.markers.map((x: { client_marker_id: string }) => x.client_marker_id)).toEqual([m.kickoff, m.left, m.right, m.noSide]);
  });

  let leftMedia: string;
  let leftJob: string;

  it('yuklash: URL\'lar partiyalab, complete ETag\'siz; recording_v1 job alohida stream\'da', async () => {
    const stopped = await putCamera(LEFT, { position: 'left', started_at: at(-5 * 60_000), stopped_at: at(5 * 60_000), duration_ms: 600_000 }).expect(200);
    expect(stopped.body).toMatchObject({ status: 'recorded', duration_ms: 600_000 });
    await ctx.http().post(`${recordingUrl()}/cameras/${uuid()}/upload`).set(host.auth)
      .send({ content_type: 'video/mp4', size_bytes: 1000, duration_ms: 1000 }).expect(404);
    await ctx.http().post(`${recordingUrl()}/cameras/${LEFT}/upload`).set(host.auth)
      .send({ content_type: 'video/mp4', size_bytes: 41 * 1024 ** 3, duration_ms: 1000 }).expect(422);

    leftMedia = await uploadCamera(LEFT);
    const [ma] = await q(ctx, 'SELECT bucket, object_key, status, upload_part_size, context FROM media_assets WHERE id = $1', [leftMedia]);
    expect(ma).toMatchObject({ bucket: 'matchup-e2e-media-raw', object_key: `recordings/${matchId}/${leftMedia}/source.mov`, status: 'processing', upload_part_size: PART });
    expect(ma!.context).toMatchObject({ kind: 'recording', match_id: matchId });

    const job = await jobOf(leftMedia);
    leftJob = job.id;
    expect(job.input).toMatchObject({ profile: 'recording_v1', match_id: matchId });
    expect(job.recording_session_id).toBeTruthy();
    expect(await streamFields(RECORDING_STREAM, job.message_id)).toMatchObject({ job_id: leftJob, type: 'transcode', media_id: leftMedia });
    expect(await redis.xrange('matchup:media-jobs', job.message_id, job.message_id)).toEqual([]);

    // Takroriy complete — o'zgarishsiz
    await ctx.http().post(`/v1/media/${leftMedia}/complete`).set(host.auth).send({}).expect(202);
    expect(await q(ctx, 'SELECT count(*)::int AS n FROM media_processing_jobs WHERE media_asset_id = $1', [leftMedia])).toEqual([{ n: 1 }]);

    const s = await ctx.http().get(recordingUrl()).set(host.auth).expect(200);
    expect(s.body.status).toBe('recording'); // o'ng kamera hali yozmoqda
    expect(s.body.cameras[0]).toMatchObject({ status: 'processing', media: { id: leftMedia, status: 'processing' } });
  });

  let clipLeft: { mediaId: string; highlightId: string; jobId: string };

  it('worker: kamera tayyor -> RecordingReady (bir marta) va belgilardan klip\'lar (o\'ng tomon kutadi)', async () => {
    const { start, prefix, res } = await fakeWorkerReady(leftJob, [{ name: '1080p', bandwidth: 5_000_000 }, { name: '720p', bandwidth: 2_800_000 }]);
    expect(start).toMatchObject({
      profile: 'recording_v1',
      source: { bucket: 'matchup-e2e-media-raw', key: `recordings/${matchId}/${leftMedia}/source.mov` },
      output: { bucket: OUT, prefix: `recordings/${matchId}/${leftMedia}/` },
      limits: { max_duration_ms: 3 * 3600_000, max_bytes: 40 * 1024 ** 3 },
    });
    expect(prefix).toBe(`recordings/${matchId}/${leftMedia}/`);
    expect(res).toEqual({ job_id: leftJob, status: 'succeeded', highlight_id: null });

    const [cam] = await q(ctx, 'SELECT status, duration_ms, width, height, fps::float AS fps FROM recording_cameras WHERE client_camera_id = $1', [LEFT]);
    expect(cam).toEqual({ status: 'ready', duration_ms: 600_000, width: 3840, height: 2160, fps: 29.97 });
    const ev = await q(ctx, "SELECT aggregate_id, payload FROM outbox_events WHERE event_type = 'RecordingReady'");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ match_id: matchId });

    // Chap belgi (chap kamera) va tomonsiz belgi (wide yo'q -> chap) — klip; o'ng belgi o'ng kamerani kutadi
    const rows = await q(
      ctx,
      `SELECT rm.client_marker_id, h.id AS highlight_id, h.media_asset_id, h.match_offset_ms, h.duration_ms, h.source, h.published_at,
              h.recording_session_id IS NOT NULL AS linked, ma.bucket, ma.object_key, ma.status
       FROM recording_markers rm JOIN highlights h ON h.id = rm.highlight_id JOIN media_assets ma ON ma.id = h.media_asset_id
       ORDER BY rm.occurred_at`,
    );
    expect(rows.map((r) => r.client_marker_id)).toEqual([m.left, m.noSide]);
    expect(rows[0]).toMatchObject({ match_offset_ms: 48_000, duration_ms: 15_000, source: 'host_manual', published_at: null, linked: true, bucket: OUT, status: 'processing' });
    expect(rows[0]!.object_key).toBe(`highlights/${matchId}/${rows[0]!.media_asset_id}/source.mp4`);
    expect(rows[1]).toMatchObject({ match_offset_ms: 172_000, duration_ms: 10_000 });
    expect((await q(ctx, 'SELECT user_id FROM highlight_tags WHERE highlight_id = $1', [rows[0]!.highlight_id])).map((r) => r.user_id)).toEqual([tagged.userId]);

    const job = await jobOf(rows[0]!.media_asset_id);
    expect(job.input).toMatchObject({ profile: 'clip_v1', recording_media_id: leftMedia, start_ms: 348_000, duration_ms: 15_000 });
    expect(await streamFields('matchup:media-jobs', job.message_id)).toMatchObject({ job_id: job.id, media_id: rows[0]!.media_asset_id });
    clipLeft = { mediaId: rows[0]!.media_asset_id, highlightId: rows[0]!.highlight_id, jobId: job.id };
  });

  it('clip_v1: manba — yozuvning eng yuqori HLS rendition\'i; natija oddiy highlight sifatida feed\'ga', async () => {
    const { start } = await fakeWorkerReady(clipLeft.jobId, [{ name: '720p', bandwidth: 2_800_000 }], {
      vertical_key: undefined,
      duration_ms: 15_020,
      width: 1920,
      height: 1080,
    });
    expect(start).toMatchObject({
      profile: 'clip_v1',
      source: { bucket: OUT, key: `recordings/${matchId}/${leftMedia}/hls/1080p/index.m3u8`, kind: 'hls', start_ms: 348_000, duration_ms: 15_000 },
      output: { bucket: OUT, prefix: `highlights/${matchId}/${clipLeft.mediaId}/` },
      limits: { max_duration_ms: 60_000 },
    });
    const feed = await ctx.http().get(`/v1/matches/${matchId}/highlights`).set(plain.auth).expect(200);
    expect(feed.body.items.map((h: { id: string }) => h.id)).toEqual([clipLeft.highlightId]);
    expect(feed.body.items[0]).toMatchObject({ source: 'host_manual', match_offset_ms: 48_000, tags: [{ user_id: tagged.userId }] });
    expect(await q(ctx, "SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'HighlightReady' AND aggregate_id = $1", [clipLeft.highlightId])).toEqual([{ n: 1 }]);
  });

  it('player: faqat ishtirokchilar; tayyor kamera HLS bilan, lahzalar kameradagi vaqti bilan', async () => {
    await ctx.http().get(`/v1/matches/${matchId}/recording`).set(outsider.auth).expect(403);
    await ctx.http().get(`/v1/matches/${matchId}/recording`).set(otherHost.auth).expect(403);
    await ctx.http().get(`/v1/matches/${uuid()}/recording`).set(tagged.auth).expect(404);

    const r = await ctx.http().get(`/v1/matches/${matchId}/recording`).set(plain.auth).expect(200);
    expect(r.body).toMatchObject({ match_id: matchId, status: 'recording', kickoff_at: at(0) });
    expect(r.body.ready_at).toBeTruthy();
    const [left, right] = r.body.cameras;
    expect(left).toMatchObject({ position: 'left', status: 'ready', duration_ms: 600_000 });
    expect(left.playback.hls_url).toMatch(/^https:\/\/api\.e2e\.matchup\.example\/v1\/playback\/[\w-]{48}\/master\.m3u8$/);
    expect(left.thumbnail_url).toMatch(/thumb\.jpg\?X-Amz-/);
    expect(right).toMatchObject({ position: 'right', status: 'recording', playback: null, thumbnail_url: null });
    expect(r.body.moments).toEqual([
      { id: expect.any(String), occurred_at: at(60_000), side: 'left', match_offset_ms: 60_000, highlight_id: clipLeft.highlightId, positions: [{ camera_id: left.id, offset_ms: 360_000 }] },
      { id: expect.any(String), occurred_at: at(120_000), side: 'right', match_offset_ms: 120_000, highlight_id: null, positions: [{ camera_id: left.id, offset_ms: 420_000 }] },
      { id: expect.any(String), occurred_at: at(180_000), side: null, match_offset_ms: 180_000, highlight_id: null, positions: [{ camera_id: left.id, offset_ms: 480_000 }] },
    ]);

    // HLS: yozuv kamerasining playlist'lari ham token bilan ochiladi
    const path = new URL(left.playback.hls_url).pathname;
    const master = await ctx.http().get(path).expect(200);
    expect(master.text).toContain('RESOLUTION=1920x1080\n1080p.m3u8');
    const variant = await ctx.http().get(path.replace('master.m3u8', '1080p.m3u8')).expect(200);
    const seg = variant.text.split('\n').find((l) => l && !l.startsWith('#'))!;
    expect(await (await fetch(seg)).text()).toBe('seg-1080p');
  });

  it('push: birinchi kamera tayyor -> ishtirokchilarga recording.ready (host\'ga emas)', async () => {
    await pump();
    const toTagged = ctx.push.to(deviceTokens.get(tagged.userId)!).filter((p) => p.data?.type === 'recording.ready');
    expect(toTagged).toHaveLength(1);
    expect(toTagged[0]!.data).toMatchObject({ url: `/match/${matchId}/recording`, match_id: matchId });
    expect(ctx.push.to(deviceTokens.get(plain.userId)!).filter((p) => p.data?.type === 'recording.ready')).toHaveLength(1);
    expect(ctx.push.to(deviceTokens.get(outsider.userId)!).filter((p) => p.data?.type === 'recording.ready')).toHaveLength(0);
  });

  it('kamera tayyor bo\'lgach belgi — klip darhol; bekor qilinsa klip feed\'dan olinadi va job yopiladi', async () => {
    const r = await markers([{ client_marker_id: m.late, kind: 'highlight', occurred_at: at(240_000), side: 'left' }]).expect(200);
    const marker = r.body.results[0].marker;
    expect(marker.highlight_id).toBeTruthy();
    const [h] = await q(ctx, 'SELECT media_asset_id FROM highlights WHERE id = $1', [marker.highlight_id]);
    const job = await jobOf(h!.media_asset_id);
    expect(job.status).toBe('queued');

    await ctx.http().delete(`${recordingUrl()}/markers/${m.late}`).set(host.auth).expect(204);
    expect((await q(ctx, 'SELECT deleted_at IS NOT NULL AS deleted FROM highlights WHERE id = $1', [marker.highlight_id]))[0]).toEqual({ deleted: true });
    await ctx.http().post(`/internal/media/jobs/${job.id}/start`).set(WORKER).send({ worker_version: 'e2e/1' }).expect(409);
    expect((await jobOf(h!.media_asset_id)).status).toBe('cancelled');
  });

  it('kick-off o\'zgarsa klip\'larning match_offset_ms i qayta hisoblanadi', async () => {
    const early = uuid();
    await markers([{ client_marker_id: early, kind: 'kickoff', occurred_at: at(-30_000) }]).expect(200);
    expect((await q(ctx, 'SELECT match_offset_ms FROM highlights WHERE id = $1', [clipLeft.highlightId]))[0]).toEqual({ match_offset_ms: 78_000 });
    await ctx.http().delete(`${recordingUrl()}/markers/${early}`).set(host.auth).expect(204);
    expect((await q(ctx, 'SELECT match_offset_ms FROM highlights WHERE id = $1', [clipLeft.highlightId]))[0]).toEqual({ match_offset_ms: 48_000 });
  });

  it('ikkinchi kamera: muddati o\'tgan yuklash -> recorded; qayta init; worker xatosi -> failed, sessiya ready', async () => {
    await putCamera(RIGHT, { position: 'right', started_at: at(-4 * 60_000), stopped_at: at(6 * 60_000), duration_ms: 600_000 }).expect(200);
    const init = await ctx.http().post(`${recordingUrl()}/cameras/${RIGHT}/upload`).set(host.auth)
      .send({ content_type: 'video/mp4', size_bytes: file.length, duration_ms: 600_000 }).expect(201);
    // Javob yo'qolgan — takroriy init o'sha yuklash
    const again = await ctx.http().post(`${recordingUrl()}/cameras/${RIGHT}/upload`).set(host.auth)
      .send({ content_type: 'video/mp4', size_bytes: file.length, duration_ms: 600_000 }).expect(201);
    expect(again.body.media_id).toBe(init.body.media_id);

    await q(ctx, "UPDATE media_assets SET upload_expires_at = now() - interval '1 minute' WHERE id = $1", [init.body.media_id]);
    await ctx.app.get(MediaService).housekeeping();
    expect((await q(ctx, 'SELECT status FROM recording_cameras WHERE client_camera_id = $1', [RIGHT]))[0]).toEqual({ status: 'recorded' });
    expect((await q(ctx, 'SELECT status FROM recording_sessions WHERE match_id = $1', [matchId]))[0]).toEqual({ status: 'uploading' });

    const mediaId = await uploadCamera(RIGHT);
    expect(mediaId).not.toBe(init.body.media_id);
    const job = await jobOf(mediaId);
    await ctx.http().post(`/internal/media/jobs/${job.id}/start`).set(WORKER).send({ worker_version: 'e2e/1' }).expect(200);
    await ctx.http().post(`/internal/media/jobs/${job.id}/result`).set(WORKER)
      .send({ status: 'failed', worker_version: 'e2e/1', error_code: 'NOT_A_VIDEO', error_message: 'moov yo\'q' }).expect(200);

    const s = await ctx.http().get(recordingUrl()).set(host.auth).expect(200);
    expect(s.body.status).toBe('ready');
    expect(s.body.cameras.find((c: { client_camera_id: string }) => c.client_camera_id === RIGHT)).toMatchObject({ status: 'failed', failure_code: 'NOT_A_VIDEO' });
    // O'ng belgi uchun o'ng va wide kamera yo'q — klip kesilmaydi
    expect((await q(ctx, 'SELECT highlight_id FROM recording_markers WHERE client_marker_id = $1', [m.right]))[0]).toEqual({ highlight_id: null });
    // Player xato bergan kamerani ko'rmaydi; RecordingReady qayta chiqmaydi
    const r = await ctx.http().get(`/v1/matches/${matchId}/recording`).set(tagged.auth).expect(200);
    expect(r.body.cameras.map((c: { position: string }) => c.position)).toEqual(['left']);
    expect(await q(ctx, "SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'RecordingReady'")).toEqual([{ n: 1 }]);
  });

  it('yuklashni bekor qilish -> kamera cancelled; tayyor kamerani qayta yuklab bo\'lmaydi', async () => {
    const WIDE = uuid();
    await putCamera(WIDE, { position: 'wide', started_at: at(0), stopped_at: at(60_000), duration_ms: 60_000 }).expect(200);
    const init = await ctx.http().post(`${recordingUrl()}/cameras/${WIDE}/upload`).set(host.auth)
      .send({ content_type: 'video/mp4', size_bytes: file.length, duration_ms: 60_000 }).expect(201);
    await ctx.http().delete(`/v1/media/${init.body.media_id}/upload`).set(host.auth).expect(204);
    expect((await q(ctx, 'SELECT status FROM recording_cameras WHERE client_camera_id = $1', [WIDE]))[0]).toEqual({ status: 'cancelled' });
    expect((await ctx.http().post(`${recordingUrl()}/cameras/${WIDE}/upload`).set(host.auth)
      .send({ content_type: 'video/mp4', size_bytes: file.length, duration_ms: 60_000 }).expect(409)).body.code).toBe('INVALID_STATE');
    expect((await ctx.http().post(`${recordingUrl()}/cameras/${LEFT}/upload`).set(host.auth)
      .send({ content_type: 'video/mp4', size_bytes: file.length, duration_ms: 600_000 }).expect(409)).body.code).toBe('INVALID_STATE');
    // Bekor qilingan kamera sessiya holatiga ta'sir qilmaydi
    expect((await q(ctx, 'SELECT status FROM recording_sessions WHERE match_id = $1', [matchId]))[0]).toEqual({ status: 'ready' });
  });
});
