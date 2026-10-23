import { bookAndPayWithPayme, createTestApp, login, q, uuid, type Session, type TestCtx } from './helpers';

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');

describe('Admin: highlight moderatsiyasi', () => {
  let ctx: TestCtx;
  let admin: Session;
  let player: Session;
  let matchId: string;
  let publicCode: string;
  const ids: string[] = [];

  /** Worker tayyorlagan, nashr qilingan klip (media `ready`, natija kalitlari bilan). */
  async function readyHighlight(title: string, opts: { vertical?: boolean; publishedAgoMin?: number } = {}): Promise<string> {
    const key = `highlights/${uuid()}`;
    const [media] = await q(
      ctx,
      `INSERT INTO media_assets (owner_user_id, kind, status, storage_region, bucket, object_key, content_type,
                                 output_bucket, thumbnail_key, vertical_key, width, height, duration_ms)
       VALUES ((SELECT id FROM users WHERE phone_e164 = '+998901110002'), 'video', 'ready', 'uz-1', 'matchup-e2e-media-raw', $1,
               'video/mp4', 'matchup-e2e-media', $2, $3, 1280, 720, 15000)
       RETURNING id`,
      [`${key}/raw.mp4`, `${key}/thumb.jpg`, opts.vertical === false ? null : `${key}/vertical.mp4`],
    );
    const [h] = await q(
      ctx,
      `INSERT INTO highlights (match_id, media_asset_id, created_by, source, title, duration_ms, published_at)
       VALUES ($1, $2, (SELECT id FROM users WHERE phone_e164 = '+998901110002'), 'host_manual', $3, 15000,
               now() - make_interval(mins => $4)) RETURNING id`,
      [matchId, media!.id, title, opts.publishedAgoMin ?? 0],
    );
    ids.push(h!.id);
    return h!.id;
  }

  const feed = async () =>
    (await ctx.http().get(`/v1/matches/${matchId}/highlights`).set(player.auth).expect(200)).body.items.map((i: { id: string }) => i.id);

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await login(ctx, '+998901110001');
    player = await login(ctx, '+998938100001');
    const pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'samarkand-mini'"))[0]!.id;
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitch,
        sport: 'football',
        starts_at: inHours(24 * 9),
        duration_min: 60,
        format: '5v5',
        players_per_side: 5,
        min_players: 4,
        max_players: 10,
        price: { amount: 4000000, currency: 'UZS' },
        lease_cost: { amount: 20000000, currency: 'UZS' },
        title: { 'uz-Latn': 'Moderatsiya testi' },
      })
      .expect(201);
    matchId = c.body.id;
    publicCode = c.body.public_code;
    await ctx.http().post(`/v1/admin/matches/${matchId}/publish`).set(admin.auth).expect(200);
    const tpl = (await ctx.http().get(`/v1/waivers/required?match_id=${matchId}`).set(player.auth).expect(200)).body.template;
    await ctx
      .http()
      .post(`/v1/waivers/${tpl.id}/signatures`)
      .set(player.auth)
      .send({ accepted: true, method: 'clickwrap', document_sha256: tpl.document_sha256, match_id: matchId })
      .expect(201);
    await bookAndPayWithPayme(ctx, player, matchId);
  });
  afterAll(() => ctx.close());

  it("navbat: faqat admin; pending — eng eskisi birinchi; o'chirilgan va tayyor bo'lmaganlar yo'q; counts", async () => {
    const older = await readyHighlight('Birinchi gol', { publishedAgoMin: 30 });
    const newer = await readyHighlight('Ikkinchi gol', { publishedAgoMin: 5, vertical: false });
    const deleted = await readyHighlight("O'chirilgan");
    await q(ctx, 'UPDATE highlights SET deleted_at = now() WHERE id = $1', [deleted]);
    const processing = await readyHighlight('Hali tayyor emas');
    await q(ctx, "UPDATE media_assets SET status = 'processing' WHERE id = (SELECT media_asset_id FROM highlights WHERE id = $1)", [processing]);

    await ctx.http().get('/v1/admin/highlights').set(player.auth).expect(403);
    const r = await ctx.http().get('/v1/admin/highlights').query({ q: publicCode }).set(admin.auth).expect(200);
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual([older, newer]);
    expect(r.body.total).toBe(2);
    expect(r.body.counts.pending).toBeGreaterThanOrEqual(2);
    const first = r.body.items[0];
    expect(first).toMatchObject({
      title: 'Birinchi gol',
      source: 'host_manual',
      moderation: { status: 'pending', reason: null, note: null, moderated_at: null, moderated_by: null },
      creator: { display_name: 'Demo Host', phone: '+998901110002' },
      match: { id: matchId, public_code: publicCode, sport: 'football' },
      tags: [],
    });
    expect(first.media.thumbnail_url).toContain('thumb.jpg');
    expect(first.media.mp4_url).toContain('vertical.mp4');
    expect(first.media.hls_url).toMatch(/\/v1\/playback\/[\w-]+\/master\.m3u8$/);
    expect(r.body.items[1].media.mp4_url).toBeNull();

    // Pending klip ishtirokchiga ko'rinadi (post-moderatsiya)
    expect(await feed()).toEqual(expect.arrayContaining([older, newer]));
  });

  it("rad etish: sabab majburiy; feed, klip va ulashish havolasidan yashiriladi; audit; qayta tasdiqlash qaytaradi", async () => {
    const [older] = ids;
    const share = await ctx.http().post(`/v1/highlights/${older}/share`).set(player.auth).send({ channel: 'link' }).expect(201);
    const token = share.body.url.split('/h/')[1];
    await ctx.http().get(`/v1/shared/highlights/${token}`).expect(200);

    const noReason = await ctx.http().post(`/v1/admin/highlights/${older}/moderate`).set(admin.auth).send({ status: 'rejected' }).expect(422);
    expect(noReason.body.errors[0].field).toBe('reason');
    await ctx.http().post(`/v1/admin/highlights/${older}/moderate`).set(admin.auth).send({ status: 'pending' }).expect(422);
    await ctx.http().post(`/v1/admin/highlights/${older}/moderate`).set(player.auth).send({ status: 'approved' }).expect(403);
    await ctx.http().post(`/v1/admin/highlights/${uuid()}/moderate`).set(admin.auth).send({ status: 'approved' }).expect(404);

    const rej = await ctx
      .http()
      .post(`/v1/admin/highlights/${older}/moderate`)
      .set(admin.auth)
      .send({ status: 'rejected', reason: 'privacy', note: "Roziliksiz odam ko'rinadi" })
      .expect(200);
    expect(rej.body.moderation).toMatchObject({
      status: 'rejected',
      reason: 'privacy',
      note: "Roziliksiz odam ko'rinadi",
      moderated_by: { id: admin.userId, display_name: 'Demo Admin' },
    });
    expect(rej.body.moderation.moderated_at).toEqual(expect.any(String));

    expect(await feed()).not.toContain(older);
    await ctx.http().get(`/v1/highlights/${older}`).set(player.auth).expect(404);
    await ctx.http().get(`/v1/shared/highlights/${token}`).expect(404);
    await ctx.http().get(`/h/${token}`).expect(404);

    // Navbatlar
    const pending = await ctx.http().get('/v1/admin/highlights').query({ q: publicCode }).set(admin.auth).expect(200);
    expect(pending.body.items.map((i: { id: string }) => i.id)).not.toContain(older);
    const rejected = await ctx.http().get('/v1/admin/highlights').query({ q: publicCode, status: 'rejected' }).set(admin.auth).expect(200);
    expect(rejected.body.items.map((i: { id: string }) => i.id)).toEqual([older]);

    // Qaror o'zgaradi: tasdiqlash — sabab va izoh tozalanadi, klip qaytadi
    const ok = await ctx.http().post(`/v1/admin/highlights/${older}/moderate`).set(admin.auth).send({ status: 'approved' }).expect(200);
    expect(ok.body.moderation).toMatchObject({ status: 'approved', reason: null, note: null });
    expect(await feed()).toContain(older);
    await ctx.http().get(`/v1/shared/highlights/${token}`).expect(200);

    const audit = await q(ctx, "SELECT changes FROM audit_logs WHERE action = 'highlight.moderate' AND entity_id = $1 ORDER BY created_at", [older]);
    expect(audit.map((a) => a.changes)).toEqual([
      { from: 'pending', to: 'rejected', reason: 'privacy', note: "Roziliksiz odam ko'rinadi" },
      { from: 'rejected', to: 'approved' },
    ]);
  });
});
