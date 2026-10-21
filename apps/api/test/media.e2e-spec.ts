import { randomBytes } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import Redis from 'ioredis';
import { MediaService } from '../src/media/media.service';
import { bookAndPayWithPayme, createTestApp, login, q, uuid, type Session, type TestCtx } from './helpers';

/**
 * Highlight pipeline (MinIO bilan): upload init -> qismlarni PUT -> resume -> complete -> navbat ->
 * soxta worker natijasi -> feed / ijro / like / share; ruxsatlar va consent filtri.
 */
describe('Media: highlight yuklash, qayta ishlash va feed', () => {
  const PART = 5 * 1024 * 1024;
  const WORKER = { Authorization: 'Bearer e2e-media-worker-token-0123456789abcdef' };
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
  const OUT = process.env.MEDIA_BUCKET!;

  let ctx: TestCtx;
  let redis: Redis;
  let host: Session;
  let otherHost: Session;
  let tagged: Session; // ishtirokchi, consent bor
  let noConsent: Session; // ishtirokchi, media_appearance qaytarib olingan
  let outsider: Session; // ishtirokchi emas
  let matchId: string;
  let participantId: string;

  const file = randomBytes(PART + 123_456); // 2 qism: 5 MiB + qolgani
  const put = (url: string, body: Uint8Array) => fetch(url, { method: 'PUT', body });

  async function initUpload(s: Session, extra: Record<string, unknown> = {}, expectStatus = 201) {
    return ctx
      .http()
      .post(`/v1/host/matches/${matchId}/highlights/uploads`)
      .set(s.auth)
      .send({ content_type: 'video/mp4', size_bytes: file.length, duration_ms: 15_000, ...extra })
      .expect(expectStatus);
  }

  /** Init + barcha qismlar + complete -> { mediaId, highlightId, jobId } */
  async function uploadAll(extra: Record<string, unknown> = {}) {
    const init = await initUpload(host, extra);
    const parts = [];
    for (const p of init.body.upload.parts) {
      const res = await put(p.url, file.subarray((p.part_number - 1) * PART, (p.part_number - 1) * PART + p.size_bytes));
      expect(res.status).toBe(200);
      parts.push({ part_number: p.part_number, etag: res.headers.get('etag')! });
    }
    const c = await ctx.http().post(`/v1/media/${init.body.media_id}/complete`).set(host.auth).send({ parts }).expect(202);
    const [job] = await q(ctx, 'SELECT id FROM media_processing_jobs WHERE media_asset_id = $1', [init.body.media_id]);
    return { mediaId: init.body.media_id as string, highlightId: c.body.highlight_id as string, jobId: job!.id as string };
  }

  /** Soxta worker: start -> chiqish fayllarini MinIO'ga yozadi -> progress -> ready. */
  async function fakeWorkerReady(jobId: string) {
    const start = await ctx.http().post(`/internal/media/jobs/${jobId}/start`).set(WORKER).send({ worker_version: 'e2e/1' }).expect(200);
    const prefix = start.body.output.prefix as string;
    const playlist = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:4', '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXTINF:4.0,', 'seg_000.ts', '#EXTINF:3.5,', 'seg_001.ts', '#EXT-X-ENDLIST', ''].join('\n');
    const objects: [string, string | Buffer, string][] = [
      [`${prefix}hls/720p/index.m3u8`, playlist, 'application/vnd.apple.mpegurl'],
      [`${prefix}hls/720p/seg_000.ts`, Buffer.from('segment-0'), 'video/mp2t'],
      [`${prefix}hls/720p/seg_001.ts`, Buffer.from('segment-1'), 'video/mp2t'],
      [`${prefix}thumb.jpg`, Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'],
      [`${prefix}vertical.mp4`, Buffer.from('mp4'), 'video/mp4'],
    ];
    for (const [Key, Body, ContentType] of objects) await s3.send(new PutObjectCommand({ Bucket: OUT, Key, Body, ContentType }));
    await ctx.http().post(`/internal/media/jobs/${jobId}/progress`).set(WORKER).send({ stage: 'hls' }).expect(200);
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
    return { start: start.body, output, prefix };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    redis = new Redis(process.env.REDIS_URL!);
    const admin = await login(ctx, '+998901110001');
    const pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'samarkand-mini'"))[0]!.id;
    const startsAt = new Date(Date.now() + 150 * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
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

    // Boshqa host (shu match'ga tayinlanmagan)
    const [u] = await q(ctx, "SELECT id FROM users WHERE phone_e164 = '+998902000019'");
    await q(ctx, "INSERT INTO user_roles (user_id, role) VALUES ($1, 'host')", [u!.id]);
    await q(
      ctx,
      `INSERT INTO host_profiles (user_id, status, home_city_id, base_location, max_travel_km, has_kit, verified_at)
       SELECT id, 'active', home_city_id, ST_SetSRID(ST_MakePoint(69.21, 41.28), 4326)::geography, 10, true, now() FROM users WHERE id = $1`,
      [u!.id],
    );
    otherHost = await login(ctx, '+998902000019');

    tagged = await login(ctx, '+998902000015');
    noConsent = await login(ctx, '+998902000016');
    outsider = await login(ctx, '+998902000017');
    await bookAndPayWithPayme(ctx, tagged, matchId);
    await bookAndPayWithPayme(ctx, noConsent, matchId);
    await ctx.http().put('/v1/me/consents').set(noConsent.auth).send({ consents: [{ purpose: 'media_appearance', granted: false }] }).expect(200);
    participantId = (await q(ctx, 'SELECT id FROM match_participants WHERE match_id = $1 AND user_id = $2', [matchId, tagged.userId]))[0]!.id;
  });

  afterAll(async () => {
    s3.destroy();
    await redis.quit();
    await ctx.close();
  });

  it('upload init: faqat tayinlangan host; cheklovlar (≤ 60 s, ≤ 150 MB, mp4/mov)', async () => {
    await initUpload(tagged, {}, 403); // player
    expect((await initUpload(otherHost, {}, 403)).body.code).toBe('FORBIDDEN');
    for (const bad of [{ size_bytes: 150 * 1024 * 1024 + 1 }, { duration_ms: 60_001 }, { content_type: 'video/webm' }]) {
      expect((await initUpload(host, bad, 422)).body.code).toBe('VALIDATION_FAILED');
    }
    const r = await initUpload(host);
    expect(r.body.media).toMatchObject({ status: 'uploading', match_id: matchId, highlight_id: null, size_bytes: file.length });
    expect(r.body.upload).toMatchObject({ type: 's3_multipart', part_size_bytes: PART, part_count: 2, uploaded_parts: [] });
    expect(r.body.upload.parts.map((p: { part_number: number; size_bytes: number }) => [p.part_number, p.size_bytes])).toEqual([
      [1, PART],
      [2, 123_456],
    ]);
    expect(r.body.upload.parts[0].url).toMatch(/^http:\/\/localhost:9000\/matchup-e2e-media-raw\/highlights\/.+X-Amz-SignedHeaders=content-length%3Bhost/);
  });

  it("uzilgan yuklash: yuklangan qismlar va yangi URL'lar; imzolangan hajmdan boshqasi rad etiladi", async () => {
    const init = await initUpload(host);
    const mediaId = init.body.media_id;
    const [p1, p2] = init.body.upload.parts;
    const r1 = await put(p1.url, file.subarray(0, PART));
    expect(r1.status).toBe(200);
    // "Internet uzildi" — 2-qism yuborilmadi. Boshqa hajm (imzo Content-Length bilan) -> 403
    expect((await put(p2.url, file.subarray(0, 1000))).status).toBe(403);

    await ctx.http().get(`/v1/media/${mediaId}/upload`).set(otherHost.auth).expect(404);
    const resume = await ctx.http().get(`/v1/media/${mediaId}/upload`).set(host.auth).expect(200);
    expect(resume.body.upload.uploaded_parts).toEqual([{ part_number: 1, etag: r1.headers.get('etag'), size_bytes: PART }]);
    expect(resume.body.upload.parts.map((p: { part_number: number }) => p.part_number)).toEqual([2]);

    const incomplete = await ctx.http().post(`/v1/media/${mediaId}/complete`).set(host.auth).send({ parts: [{ part_number: 1, etag: r1.headers.get('etag') }] }).expect(409);
    expect(incomplete.body.code).toBe('UPLOAD_INCOMPLETE');
    const r2 = await put(resume.body.upload.parts[0].url, file.subarray(PART));
    expect(r2.status).toBe(200);
    const wrongEtag = await ctx.http().post(`/v1/media/${mediaId}/complete`).set(host.auth)
      .send({ parts: [{ part_number: 1, etag: r1.headers.get('etag') }, { part_number: 2, etag: '"deadbeef"' }] }).expect(409);
    expect(wrongEtag.body.code).toBe('UPLOAD_INCOMPLETE');

    // Bekor qilish -> keyingi so'rovlar 404
    await ctx.http().delete(`/v1/media/${mediaId}/upload`).set(host.auth).expect(204);
    await ctx.http().get(`/v1/media/${mediaId}/upload`).set(host.auth).expect(404);
  });

  let highlightId: string;
  let mediaId: string;
  let jobId: string;

  it("complete: processing, highlight (teglar consent bo'yicha), Redis Stream'ga job; idempotent", async () => {
    ({ mediaId, highlightId, jobId } = await uploadAll({
      title: 'Ajoyib gol',
      match_offset_ms: 1_834_000,
      tagged_user_ids: [noConsent.userId, outsider.userId],
      tagged_participant_ids: [participantId],
    }));
    const m = await ctx.http().get(`/v1/media/${mediaId}`).set(host.auth).expect(200);
    expect(m.body).toMatchObject({ status: 'processing', highlight_id: highlightId, processing: { status: 'queued', stage: null } });
    await ctx.http().get(`/v1/media/${mediaId}`).set(tagged.auth).expect(404);

    // Takroriy complete (javob yo'qolgan) — o'sha highlight, ikkinchi job yo'q
    const again = await ctx.http().post(`/v1/media/${mediaId}/complete`).set(host.auth).send({ parts: [{ part_number: 1, etag: 'x' }, { part_number: 2, etag: 'y' }] }).expect(202);
    expect(again.body).toMatchObject({ status: 'processing', highlight_id: highlightId });
    expect(await q(ctx, 'SELECT count(*)::int AS n FROM media_processing_jobs WHERE media_asset_id = $1', [mediaId])).toEqual([{ n: 1 }]);

    const [h] = await q(ctx, 'SELECT source, visibility, title, match_offset_ms, published_at FROM highlights WHERE id = $1', [highlightId]);
    expect(h).toMatchObject({ source: 'host_manual', visibility: 'participants', title: 'Ajoyib gol', match_offset_ms: 1_834_000, published_at: null });
    // Consent'siz va ishtirokchi bo'lmagan — jim tashlab yuborildi
    expect((await q(ctx, 'SELECT user_id FROM highlight_tags WHERE highlight_id = $1', [highlightId])).map((r) => r.user_id)).toEqual([tagged.userId]);

    const [job] = await q(ctx, 'SELECT status, transport, message_id FROM media_processing_jobs WHERE id = $1', [jobId]);
    expect(job).toMatchObject({ status: 'queued', transport: 'redis_stream' });
    const entries = await redis.xrange('matchup:media-jobs', job!.message_id, job!.message_id);
    const fields = Object.fromEntries(entries[0]![1].reduce<string[][]>((a, v, i) => (i % 2 ? (a.at(-1)!.push(v), a) : [...a, [v]]), []));
    expect(fields).toMatchObject({ v: '1', job_id: jobId, type: 'transcode', media_id: mediaId });

    // Tayyor bo'lguncha feed'da yo'q
    expect((await ctx.http().get(`/v1/matches/${matchId}/highlights`).set(tagged.auth).expect(200)).body.items).toEqual([]);
  });

  it('ichki endpointlar: servis token; worker natijasi -> ready + HighlightReady', async () => {
    await ctx.http().post(`/internal/media/jobs/${jobId}/start`).send({ worker_version: 'x' }).expect(401);
    await ctx.http().post(`/internal/media/jobs/${jobId}/start`).set({ Authorization: 'Bearer wrong-token-wrong-token-wrong-token-00' }).send({ worker_version: 'x' }).expect(401);
    await ctx.http().post(`/internal/media/jobs/${jobId}/start`).set(host.auth).send({ worker_version: 'x' }).expect(401);

    const { start, output, prefix } = await fakeWorkerReady(jobId);
    expect(start).toMatchObject({
      job_id: jobId, type: 'transcode', attempt: 1, profile: 'highlight_v1',
      media: { id: mediaId, size_bytes: file.length, declared_duration_ms: 15_000 },
      source: { bucket: 'matchup-e2e-media-raw', key: `${prefix}source.mp4` },
      output: { bucket: OUT },
      limits: { max_duration_ms: 60_000, max_bytes: 150 * 1024 * 1024 },
    });
    expect(prefix).toBe(`highlights/${matchId}/${mediaId}/`);
    // Boshqa worker hozir ishlayotgan job'ni ololmaydi
    await ctx.http().post(`/internal/media/jobs/${jobId}/start`).set(WORKER).send({ worker_version: 'e2e/2' }).expect(409);
    // Prefiksdan tashqaridagi kalit
    await ctx.http().post(`/internal/media/jobs/${jobId}/result`).set(WORKER)
      .send({ status: 'ready', worker_version: 'e2e/1', output: { ...output, thumbnail_key: 'highlights/other/thumb.jpg' } }).expect(422);

    const ok = await ctx.http().post(`/internal/media/jobs/${jobId}/result`).set(WORKER).send({ status: 'ready', worker_version: 'e2e/1', output }).expect(200);
    expect(ok.body).toEqual({ job_id: jobId, status: 'succeeded', highlight_id: highlightId });
    // Idempotent
    await ctx.http().post(`/internal/media/jobs/${jobId}/result`).set(WORKER).send({ status: 'ready', worker_version: 'e2e/1', output }).expect(200);
    await ctx.http().post(`/internal/media/jobs/${jobId}/start`).set(WORKER).send({ worker_version: 'e2e/1' }).expect(409);

    const [j] = await q(ctx, 'SELECT status, stage, attempts, worker_version FROM media_processing_jobs WHERE id = $1', [jobId]);
    expect(j).toEqual({ status: 'succeeded', stage: 'done', attempts: 1, worker_version: 'e2e/1' });
    const [m] = await q(ctx, 'SELECT status, duration_ms, width, height, playback_path FROM media_assets WHERE id = $1', [mediaId]);
    expect(m).toEqual({ status: 'ready', duration_ms: 14_870, width: 1080, height: 1920, playback_path: output.hls_master_key });
    const ev = await q(ctx, "SELECT payload FROM outbox_events WHERE event_type = 'HighlightReady' AND aggregate_id = $1", [highlightId]);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ highlight_id: highlightId, match_id: matchId, media_id: mediaId, created_by: host.userId, tagged_user_ids: [tagged.userId] });
  });

  it("feed: faqat ishtirokchilar; teglar; imzolangan HLS ijro (segmentlar to'g'ridan-to'g'ri storage'dan)", async () => {
    await ctx.http().get(`/v1/matches/${matchId}/highlights`).set(outsider.auth).expect(403);
    await ctx.http().get(`/v1/matches/${matchId}/highlights`).set(otherHost.auth).expect(403);
    await ctx.http().get(`/v1/highlights/${highlightId}`).set(outsider.auth).expect(404);
    await ctx.http().get(`/v1/matches/${uuid()}/highlights`).set(tagged.auth).expect(404);

    const feed = await ctx.http().get(`/v1/matches/${matchId}/highlights`).set(tagged.auth).expect(200);
    expect(feed.body.next_cursor).toBeNull();
    expect(feed.body.items).toHaveLength(1);
    const h = feed.body.items[0];
    expect(h).toMatchObject({
      id: highlightId, status: 'ready', source: 'host_manual', title: 'Ajoyib gol', duration_ms: 14_870, visibility: 'participants',
      likes_count: 0, liked_by_me: false, creator: { id: host.userId },
      tags: [{ user_id: tagged.userId, display_name: 'Player 15' }],
      match: { id: matchId },
      media: { width: 1080, height: 1920 },
    });
    expect(h.media.thumbnail_url).toMatch(/^http:\/\/localhost:9000\/matchup-e2e-media\/.+thumb\.jpg\?X-Amz-/);
    expect(h.media.playback.mp4_url).toMatch(/vertical\.mp4\?X-Amz-/);
    expect(h.media.playback.hls_url).toMatch(/^https:\/\/api\.e2e\.matchup\.example\/v1\/playback\/[\w-]{48}\/master\.m3u8$/);
    // Host va consent'siz ishtirokchi ham ko'radi
    expect((await ctx.http().get(`/v1/matches/${matchId}/highlights`).set(noConsent.auth).expect(200)).body.items).toHaveLength(1);
    expect((await ctx.http().get(`/v1/matches/${matchId}/highlights`).set(host.auth).expect(200)).body.items).toHaveLength(1);

    const path = new URL(h.media.playback.hls_url).pathname;
    const master = await ctx.http().get(path).expect(200);
    expect(master.headers['content-type']).toMatch(/application\/vnd\.apple\.mpegurl/);
    expect(master.text).toContain('#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=720x1280,CODECS="avc1.4d4028,mp4a.40.2"\n720p.m3u8');
    const variant = await ctx.http().get(path.replace('master.m3u8', '720p.m3u8')).expect(200);
    const segs = variant.text.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(segs).toHaveLength(2);
    expect(variant.text).toContain('#EXTINF:3.5,');
    const seg = await fetch(segs[1]!);
    expect(seg.status).toBe(200);
    expect(await seg.text()).toBe('segment-1');
    await ctx.http().get(path.replace('master.m3u8', '1080p.m3u8')).expect(404);
    await ctx.http().get(path.replace(/playback\/[\w-]{48}/, `playback/${'A'.repeat(48)}`)).expect(404);
  });

  it('profil feed: men o\'ynagan / teglangan; consent qaytarib olinsa teg yashiriladi', async () => {
    const mine = await ctx.http().get('/v1/me/highlights').set(tagged.auth).expect(200);
    expect(mine.body.items.map((h: { id: string }) => h.id)).toEqual([highlightId]);
    expect((await ctx.http().get('/v1/me/highlights?scope=tagged').set(tagged.auth).expect(200)).body.items).toHaveLength(1);
    expect((await ctx.http().get('/v1/me/highlights?scope=tagged').set(noConsent.auth).expect(200)).body.items).toEqual([]);
    expect((await ctx.http().get('/v1/me/highlights').set(noConsent.auth).expect(200)).body.items).toHaveLength(1);
    expect((await ctx.http().get('/v1/me/highlights').set(outsider.auth).expect(200)).body.items).toEqual([]);

    await ctx.http().put('/v1/me/consents').set(tagged.auth).send({ consents: [{ purpose: 'media_appearance', granted: false }] }).expect(200);
    expect((await ctx.http().get(`/v1/highlights/${highlightId}`).set(tagged.auth).expect(200)).body.tags).toEqual([]);
    expect((await ctx.http().get('/v1/me/highlights?scope=tagged').set(tagged.auth).expect(200)).body.items).toEqual([]);
    await ctx.http().put('/v1/me/consents').set(tagged.auth).send({ consents: [{ purpose: 'media_appearance', granted: true }] }).expect(200);
    expect((await ctx.http().get(`/v1/highlights/${highlightId}`).set(tagged.auth).expect(200)).body.tags).toHaveLength(1);
  });

  it('like / unlike: idempotent, likes_count', async () => {
    const like = (s: Session) => ctx.http().put(`/v1/highlights/${highlightId}/like`).set(s.auth);
    expect((await like(tagged).expect(200)).body).toEqual({ highlight_id: highlightId, liked: true, likes_count: 1 });
    expect((await like(tagged).expect(200)).body.likes_count).toBe(1);
    expect((await like(noConsent).expect(200)).body.likes_count).toBe(2);
    await like(outsider).expect(404);
    const un = await ctx.http().delete(`/v1/highlights/${highlightId}/like`).set(tagged.auth).expect(200);
    expect(un.body).toEqual({ highlight_id: highlightId, liked: false, likes_count: 1 });
    await ctx.http().delete(`/v1/highlights/${highlightId}/like`).set(tagged.auth).expect(200);
    const h = await ctx.http().get(`/v1/highlights/${highlightId}`).set(noConsent.auth).expect(200);
    expect(h.body).toMatchObject({ likes_count: 1, liked_by_me: true });
    expect(await q(ctx, 'SELECT count(*)::int AS n FROM highlight_reactions WHERE highlight_id = $1', [highlightId])).toEqual([{ n: 1 }]);
  });

  it('share: highlight_shares + imzolangan ochiq havola (HTML sahifa va JSON)', async () => {
    await ctx.http().post(`/v1/highlights/${highlightId}/share`).set(outsider.auth).send({}).expect(404);
    const r = await ctx.http().post(`/v1/highlights/${highlightId}/share`).set(tagged.auth).set('Accept-Language', 'ru').send({ channel: 'telegram' }).expect(201);
    expect(r.body).toMatchObject({ channel: 'telegram', text: expect.stringContaining('хайлайт') });
    expect(r.body.url).toMatch(/^https:\/\/api\.e2e\.matchup\.example\/h\/[\w-]{48}$/);
    const days = (new Date(r.body.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    const token = r.body.url.split('/h/')[1];

    const shared = await ctx.http().get(`/v1/shared/highlights/${token}`).expect(200); // auth'siz
    expect(shared.body).toMatchObject({ id: highlightId, title: 'Ajoyib gol', match: { public_code: expect.stringMatching(/^MU-/) } });
    expect(shared.body).not.toHaveProperty('tags');
    expect(shared.body.playback.hls_url).toMatch(/\/v1\/playback\/[\w-]{48}\/master\.m3u8$/);
    const page = await ctx.http().get(`/h/${token}`).expect(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(page.text).toContain('application/vnd.apple.mpegurl');
    expect(page.text).toContain('og:image');
    expect(page.text).not.toContain('Player 15');

    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    await ctx.http().get(`/v1/shared/highlights/${tampered}`).expect(404);
    await ctx.http().get(`/h/${tampered}`).expect(404);
    // Playback token share sifatida ishlamaydi (maqsad HMAC'ga kiradi)
    const playbackToken = shared.body.playback.hls_url.split('/playback/')[1].split('/')[0];
    await ctx.http().get(`/v1/shared/highlights/${playbackToken}`).expect(404);

    expect(await q(ctx, 'SELECT channel, user_id FROM highlight_shares WHERE highlight_id = $1', [highlightId])).toEqual([{ channel: 'telegram', user_id: tagged.userId }]);
    expect((await q(ctx, 'SELECT shares_count FROM highlights WHERE id = $1', [highlightId]))[0]!.shares_count).toBe(1);
    expect(await q(ctx, "SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'HighlightShared' AND aggregate_id = $1", [highlightId])).toEqual([{ n: 1 }]);

    // Muddati o'tgan havola
    await q(ctx, "UPDATE highlight_shares SET expires_at = now() - interval '1 minute' WHERE highlight_id = $1", [highlightId]);
    await ctx.http().get(`/v1/shared/highlights/${token}`).expect(404);
  });

  it("worker xatosi: media failed, host ro'yxatida ko'rinadi, player feed'ida yo'q", async () => {
    const second = await uploadAll();
    await ctx.http().post(`/internal/media/jobs/${second.jobId}/start`).set(WORKER).send({ worker_version: 'e2e/1' }).expect(200);
    await ctx.http().post(`/internal/media/jobs/${second.jobId}/result`).set(WORKER)
      .send({ status: 'failed', worker_version: 'e2e/1', error_code: 'DURATION_TOO_LONG', error_message: '61000 ms' }).expect(200);
    const m = await ctx.http().get(`/v1/media/${second.mediaId}`).set(host.auth).expect(200);
    expect(m.body).toMatchObject({ status: 'failed', failure_code: 'DURATION_TOO_LONG', processing: { status: 'failed' } });

    const list = await ctx.http().get(`/v1/host/matches/${matchId}/highlights`).set(host.auth).expect(200);
    expect(list.body.items.map((h: { id: string; status: string }) => [h.id, h.status])).toEqual([
      [second.highlightId, 'failed'],
      [highlightId, 'ready'],
    ]);
    expect(list.body.items[0]).toMatchObject({ failure_code: 'DURATION_TOO_LONG', media: { playback: null, thumbnail_url: null } });
    await ctx.http().get(`/v1/host/matches/${matchId}/highlights`).set(otherHost.auth).expect(403);
    expect((await ctx.http().get(`/v1/matches/${matchId}/highlights`).set(tagged.auth).expect(200)).body.items).toHaveLength(1);
    await ctx.http().get(`/v1/highlights/${second.highlightId}`).set(tagged.auth).expect(404);
  });

  it("housekeeping: navbatga yozilmagan job qayta yuboriladi; muddati o'tgan yuklash abort qilinadi", async () => {
    const media = ctx.app.get(MediaService);
    const third = await uploadAll();
    await q(ctx, "UPDATE media_processing_jobs SET dispatched_at = NULL, message_id = NULL, queued_at = now() - interval '1 minute' WHERE id = $1", [third.jobId]);
    const before = await redis.xlen('matchup:media-jobs');
    const stale = await initUpload(host);
    await q(ctx, "UPDATE media_assets SET upload_expires_at = now() - interval '1 minute' WHERE id = $1", [stale.body.media_id]);
    await ctx.http().get(`/v1/media/${stale.body.media_id}/upload`).set(host.auth).expect(410);

    const r = await media.housekeeping();
    expect(r).toMatchObject({ dispatched: 1, expired_uploads: 1 });
    expect(await redis.xlen('matchup:media-jobs')).toBe(before + 1);
    expect((await q(ctx, 'SELECT dispatched_at IS NOT NULL AS d FROM media_processing_jobs WHERE id = $1', [third.jobId]))[0]!.d).toBe(true);
    expect((await q(ctx, 'SELECT status, failure_code FROM media_assets WHERE id = $1', [stale.body.media_id]))[0]).toEqual({ status: 'deleted', failure_code: 'UPLOAD_EXPIRED' });

    // To'xtab qolgan worker (heartbeat > 10 daq) -> qayta navbat
    await ctx.http().post(`/internal/media/jobs/${third.jobId}/start`).set(WORKER).send({ worker_version: 'e2e/1' }).expect(200);
    await q(ctx, "UPDATE media_processing_jobs SET heartbeat_at = now() - interval '11 minutes' WHERE id = $1", [third.jobId]);
    expect(await media.housekeeping()).toMatchObject({ requeued: 1, dispatched: 1 });
    const again = await ctx.http().post(`/internal/media/jobs/${third.jobId}/start`).set(WORKER).send({ worker_version: 'e2e/1' }).expect(200);
    expect(again.body.attempt).toBe(2);
  });

  it('feed cursor pagination: (published_at, id) keyset, takrorsiz', async () => {
    const extra = await uploadAll({ title: 'Ikkinchi klip' });
    const { output } = await fakeWorkerReady(extra.jobId);
    await ctx.http().post(`/internal/media/jobs/${extra.jobId}/result`).set(WORKER).send({ status: 'ready', worker_version: 'e2e/1', output }).expect(200);
    // Bir xil millisekundda nashr qilingan (mikrosekund farq) — cursor ularni yo'qotmasligi kerak
    await q(ctx, "UPDATE highlights SET published_at = date_trunc('milliseconds', now()) + interval '400 microseconds' WHERE id = $1", [highlightId]);
    await q(ctx, "UPDATE highlights SET published_at = date_trunc('milliseconds', now()) + interval '600 microseconds' WHERE id = $1", [extra.highlightId]);

    const p1 = await ctx.http().get(`/v1/matches/${matchId}/highlights?limit=1`).set(tagged.auth).expect(200);
    expect(p1.body.items.map((h: { id: string }) => h.id)).toEqual([extra.highlightId]);
    expect(p1.body.next_cursor).toEqual(expect.any(String));
    const p2 = await ctx.http().get(`/v1/matches/${matchId}/highlights?limit=1&cursor=${p1.body.next_cursor}`).set(tagged.auth).expect(200);
    expect(p2.body.items.map((h: { id: string }) => h.id)).toEqual([highlightId]);
    expect(p2.body.next_cursor).toBeNull();
  });
});
