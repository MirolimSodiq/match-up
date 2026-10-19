import { createTestApp, login, q, signatureId, uuid, bookAndPayWithPayme, type Session, type TestCtx } from './helpers';

/**
 * Admin operatsiyalari: venue/pitch katalogi, match jadvali va tafsiloti, host'lar,
 * to'lovlar, refund navbati, dashboard va audit_logs.
 */
describe('Admin ops: venue, pitch, match, host, to\'lov, refund, dashboard', () => {
  let ctx: TestCtx;
  let admin: Session;
  let player: Session;
  let tashkent: number;
  let venueId: string;
  let pitchId: string;
  let matchId: string;

  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const auditCount = async (action: string, entityId: string) =>
    (await q<{ n: number }>(ctx, 'SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND entity_id = $2', [action, entityId]))[0]!.n;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await login(ctx, '+998901110001');
    player = await login(ctx, '+998902000025');
    tashkent = (await q(ctx, "SELECT id FROM cities WHERE slug = 'tashkent'"))[0]!.id;
  });
  afterAll(() => ctx.close());

  it('player admin endpointlariga kira olmaydi (403), token\'siz — 401', async () => {
    for (const path of ['/v1/admin/venues', '/v1/admin/matches', '/v1/admin/hosts', '/v1/admin/payments', '/v1/admin/refunds', '/v1/admin/dashboard', '/v1/admin/reference']) {
      const r = await ctx.http().get(path).set(player.auth).expect(403);
      expect(r.body.code).toBe('FORBIDDEN');
      await ctx.http().get(path).expect(401);
    }
  });

  it('reference: shaharlar, sportlar, qulayliklar, sirt turlari, bekor qilish siyosatlari', async () => {
    const r = await ctx.http().get('/v1/admin/reference').set(admin.auth).set('Accept-Language', 'ru').expect(200);
    expect(r.body.cities.find((c: { slug: string }) => c.slug === 'tashkent')).toMatchObject({ name: 'Ташкент', timezone: 'Asia/Tashkent', currency: 'UZS' });
    expect(r.body.sports.map((s: { code: string }) => s.code)).toEqual(expect.arrayContaining(['football', 'basketball']));
    expect(r.body.amenities.find((a: { code: string }) => a.code === 'parking').name).toBe('Парковка');
    expect(r.body.surfaces).toContain('artificial_turf');
    expect(r.body.cancellation_policies[0]).toMatchObject({ code: 'standard', is_default: true });
  });

  it('venue: yaratish (lat/lng -> geography, amenity\'lar, avto slug), ro\'yxat, tahrirlash, audit', async () => {
    const body = {
      city_id: tashkent,
      name: 'Mirzo Ulugʻbek Arena',
      address: { 'uz-Latn': 'Mirzo Ulugʻbek tumani', ru: 'Мирзо-Улугбекский район' },
      location: { lat: 41.338, lng: 69.334 },
      partner_name: 'Arena LLC',
      partner_phone: '+998712000000',
      amenities: ['parking', 'shower'],
    };
    const c = await ctx.http().post('/v1/admin/venues').set(admin.auth).send(body).expect(201);
    venueId = c.body.id;
    expect(c.body).toMatchObject({
      slug: 'mirzo-ulugbek-arena',
      timezone: 'Asia/Tashkent',
      city: { id: tashkent, name: 'Toshkent' },
      location: { lat: 41.338, lng: 69.334 },
      address_text: 'Mirzo Ulugʻbek tumani',
      is_active: true,
      pitches: [],
    });
    expect(c.body.amenities.map((a: { code: string }) => a.code).sort()).toEqual(['parking', 'shower']);
    const geo = (await q(ctx, 'SELECT ST_AsText(location::geometry) AS wkt FROM venues WHERE id = $1', [venueId]))[0]!;
    expect(geo.wkt).toBe('POINT(69.334 41.338)');

    // Bir xil nom — slug avtomatik raqamlanadi; band slug qo'lda berilsa — 409
    const dup = await ctx.http().post('/v1/admin/venues').set(admin.auth).send({ ...body, amenities: [] }).expect(201);
    expect(dup.body.slug).toBe('mirzo-ulugbek-arena-2');
    const taken = await ctx.http().post('/v1/admin/venues').set(admin.auth).send({ ...body, slug: 'chilonzor-arena' }).expect(409);
    expect(taken.body.code).toBe('ALREADY_EXISTS');
    const bad = await ctx.http().post('/v1/admin/venues').set(admin.auth).send({ ...body, amenities: ['jacuzzi'] }).expect(422);
    expect(bad.body.errors[0].field).toBe('amenities');
    await ctx.http().post('/v1/admin/venues').set(admin.auth).send({ ...body, location: { lat: 100, lng: 0 } }).expect(422);

    const list = await ctx.http().get(`/v1/admin/venues?city_id=${tashkent}&q=ulugbek`).set(admin.auth).expect(200);
    expect(list.body.total).toBe(2);
    const all = await ctx.http().get('/v1/admin/venues?limit=2').set(admin.auth).expect(200);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.total).toBeGreaterThanOrEqual(5);

    const u = await ctx
      .http()
      .patch(`/v1/admin/venues/${venueId}`)
      .set(admin.auth)
      .send({ name: 'MU Arena', location: { lat: 41.34, lng: 69.335 }, amenities: ['lighting'] })
      .expect(200);
    expect(u.body).toMatchObject({ name: 'MU Arena', slug: 'mirzo-ulugbek-arena', location: { lat: 41.34, lng: 69.335 } });
    expect(u.body.amenities).toEqual([{ code: 'lighting', name: 'Yoritish' }]);
    await ctx.http().patch(`/v1/admin/venues/${venueId}`).set(admin.auth).send({}).expect(422);
    await ctx.http().patch(`/v1/admin/venues/${uuid()}`).set(admin.auth).send({ name: 'X Y' }).expect(404);

    expect(await auditCount('venue.create', venueId)).toBe(1);
    expect(await auditCount('venue.update', venueId)).toBe(1);
    const a = (await q(ctx, "SELECT actor_user_id, actor_role, ip, request_id FROM audit_logs WHERE action = 'venue.update' AND entity_id = $1", [venueId]))[0]!;
    expect(a).toMatchObject({ actor_user_id: admin.userId, actor_role: 'admin' });
    expect(a.ip).toBeTruthy();
    expect(a.request_id).toBeTruthy();
  });

  it('pitch: yaratish va tahrirlash (pitch_sports bilan), nom takrori — 409', async () => {
    const c = await ctx
      .http()
      .post(`/v1/admin/venues/${venueId}/pitches`)
      .set(admin.auth)
      .send({ name: 'Pitch 1', surface: 'artificial_turf', length_m: 40, width_m: 20, max_players_per_side: 6, sports: ['football'] })
      .expect(201);
    pitchId = c.body.id;
    expect(c.body).toMatchObject({ venue_id: venueId, name: 'Pitch 1', length_m: 40, sports: ['football'], is_active: true, upcoming_matches: 0 });

    const dup = await ctx.http().post(`/v1/admin/venues/${venueId}/pitches`).set(admin.auth).send({ name: 'Pitch 1', surface: 'sand', sports: ['volleyball'] }).expect(409);
    expect(dup.body.code).toBe('ALREADY_EXISTS');
    const badSport = await ctx.http().post(`/v1/admin/venues/${venueId}/pitches`).set(admin.auth).send({ name: 'P2', surface: 'sand', sports: ['curling'] }).expect(422);
    expect(badSport.body.errors[0].field).toBe('sports');
    await ctx.http().post(`/v1/admin/venues/${venueId}/pitches`).set(admin.auth).send({ name: 'P2', surface: 'sand', sports: [] }).expect(422);
    await ctx.http().post(`/v1/admin/venues/${uuid()}/pitches`).set(admin.auth).send({ name: 'P2', surface: 'sand', sports: ['football'] }).expect(404);

    const u = await ctx.http().patch(`/v1/admin/pitches/${pitchId}`).set(admin.auth).send({ sports: ['football', 'basketball'], is_indoor: true }).expect(200);
    expect(u.body).toMatchObject({ is_indoor: true, sports: ['football', 'basketball'] });
    const v = await ctx.http().get(`/v1/admin/venues/${venueId}`).set(admin.auth).expect(200);
    expect(v.body.pitches.map((p: { id: string }) => p.id)).toEqual([pitchId]);
    expect(await auditCount('pitch.create', pitchId)).toBe(1);
    expect(await auditCount('pitch.update', pitchId)).toBe(1);
  });

  it('match ro\'yxati: filtrlar, joylar va tushum; tafsilot: roster, booking, to\'lov, host', async () => {
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitchId,
        sport: 'football',
        starts_at: inHours(48),
        duration_min: 60,
        format: '5v5',
        players_per_side: 5,
        min_players: 6,
        max_players: 10,
        price: { amount: 4000000, currency: 'UZS' },
        lease_cost: { amount: 20000000, currency: 'UZS' },
        host_fee: { amount: 10000000, currency: 'UZS' },
        title: { 'uz-Latn': 'Admin test' },
      })
      .expect(201);
    matchId = c.body.id;

    // Draft ham ko'rinadi; status filtri
    const drafts = await ctx.http().get(`/v1/admin/matches?status=draft&venue_id=${venueId}`).set(admin.auth).expect(200);
    expect(drafts.body.items.map((m: { id: string }) => m.id)).toEqual([matchId]);
    await ctx.http().post(`/v1/admin/matches/${matchId}/publish`).set(admin.auth).expect(200);

    await bookAndPayWithPayme(ctx, player, matchId);
    const p2 = await login(ctx, '+998902000026');
    await ctx
      .http()
      .post('/v1/bookings')
      .set(p2.auth)
      .set('Idempotency-Key', uuid())
      .send({ match_id: matchId, payment_method: 'click', waiver_signature_id: await signatureId(ctx, p2, matchId) })
      .expect(201);

    const from = new Date(Date.now() + 47 * 3600_000).toISOString();
    const to = new Date(Date.now() + 49 * 3600_000).toISOString();
    const l = await ctx
      .http()
      .get(`/v1/admin/matches?status=open,full&city_id=${tashkent}&sport=football&date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}&venue_id=${venueId}`)
      .set(admin.auth)
      .expect(200);
    expect(l.body.total).toBe(1);
    expect(l.body.items[0]).toMatchObject({
      id: matchId,
      status: 'open',
      venue: { id: venueId, name: 'MU Arena' },
      pitch: { id: pitchId, name: 'Pitch 1' },
      slots: { max: 10, held: 1, confirmed: 1, taken: 2, available: 8 },
      fill_rate: 0.1,
      revenue: { gross: { amount: 4000000 }, refunded: { amount: 0 }, net: { amount: 4000000, formatted: expect.stringMatching(/^40\s000 so'm$/) } },
      lease_cost: { amount: 20000000 },
      host_fee: { amount: 10000000 },
      host: null,
    });
    const none = await ctx.http().get(`/v1/admin/matches?sport=basketball&venue_id=${venueId}`).set(admin.auth).expect(200);
    expect(none.body).toEqual({ items: [], total: 0 });
    const byCode = await ctx.http().get(`/v1/admin/matches?q=${c.body.public_code}`).set(admin.auth).expect(200);
    expect(byCode.body.items[0].id).toBe(matchId);
    await ctx.http().get('/v1/admin/matches?status=bogus').set(admin.auth).expect(422);

    const d = await ctx.http().get(`/v1/admin/matches/${c.body.public_code}`).set(admin.auth).expect(200);
    expect(d.body).toMatchObject({ id: matchId, lease: { status: 'confirmed', cost: { amount: 20000000 } }, cancellation_policy: { code: 'standard' } });
    expect(d.body.sides).toHaveLength(2);
    expect(d.body.roster.map((r: { status: string }) => r.status).sort()).toEqual(['confirmed', 'held']);
    expect(d.body.roster[0].user.phone).toMatch(/^\+99890200002[56]$/);
    expect(d.body.bookings.map((b: { status: string }) => b.status).sort()).toEqual(['confirmed', 'pending_payment']);
    expect(d.body.payments.map((p: { provider: string; status: string }) => `${p.provider}:${p.status}`).sort()).toEqual(['click:created', 'payme:succeeded']);
    expect(d.body.audit.map((a: { action: string }) => a.action)).toEqual(['match.publish', 'match.create']);
    await ctx.http().get(`/v1/admin/matches/${uuid()}`).set(admin.auth).expect(404);
  });

  it('host: telefon bo\'yicha host qilish, tasdiqlash, tahrirlash, suspend (statistika bilan)', async () => {
    // Mavjud player -> applicant host
    const c = await ctx
      .http()
      .post('/v1/admin/hosts')
      .set(admin.auth)
      .send({ phone: '+998 90 200 00 27', city_id: tashkent, base_location: { lat: 41.3, lng: 69.25 }, has_kit: true, sports: ['football'] })
      .expect(201);
    const hostId = c.body.user_id;
    expect(c.body).toMatchObject({ phone: '+998902000027', status: 'applicant', has_kit: true, sports: ['football'], base_location: { lat: 41.3, lng: 69.25 } });
    expect((await q(ctx, "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'host'", [hostId])).length).toBe(1);
    const again = await ctx.http().post('/v1/admin/hosts').set(admin.auth).send({ phone: '+998902000027', city_id: tashkent, sports: ['football'] }).expect(409);
    expect(again.body.code).toBe('ALREADY_EXISTS');

    // Applicant hali offer ola olmaydi (requireHost: status = active); host roli yangi token'da keladi
    let hostSession = await login(ctx, '+998902000027');
    await ctx.http().get('/v1/host/offers').set(hostSession.auth).expect(403);

    const a = await ctx.http().post(`/v1/admin/hosts/${hostId}/approve`).set(admin.auth).expect(200);
    expect(a.body.status).toBe('active');
    expect(a.body.verified_at).toBeTruthy();
    await ctx.http().post(`/v1/admin/hosts/${hostId}/approve`).set(admin.auth).expect(409);
    hostSession = await login(ctx, '+998902000027');
    await ctx.http().get('/v1/host/offers').set(hostSession.auth).expect(200);

    const u = await ctx.http().patch(`/v1/admin/hosts/${hostId}`).set(admin.auth).send({ sports: ['football', 'volleyball'], max_travel_km: 20 }).expect(200);
    expect(u.body).toMatchObject({ sports: ['football', 'volleyball'], max_travel_km: 20 });

    // Yangi raqam — foydalanuvchi yaratiladi va darhol tasdiqlanadi
    const n = await ctx
      .http()
      .post('/v1/admin/hosts')
      .set(admin.auth)
      .send({ phone: '+998935550001', display_name: 'Akmal Host', city_id: tashkent, sports: ['basketball'], approve: true })
      .expect(201);
    expect(n.body).toMatchObject({ display_name: 'Akmal Host', status: 'active', base_location: null });

    // Ro'yxat: statistika (seed host — 1 ta qabul qilingan tayinlov)
    const list = await ctx.http().get('/v1/admin/hosts?status=active').set(admin.auth).expect(200);
    const seedHost = list.body.items.find((h: { phone: string }) => h.phone === '+998901110002');
    expect(seedHost.stats.accepted_total).toBeGreaterThanOrEqual(1);
    expect(seedHost.stats.earned.currency).toBe('UZS');
    const searched = await ctx.http().get('/v1/admin/hosts?q=2000027').set(admin.auth).expect(200);
    expect(searched.body.items.map((h: { user_id: string }) => h.user_id)).toEqual([hostId]);

    // Suspend: offer'lar bekor qilinadi, host panelga kira olmaydi
    await q(
      ctx,
      `INSERT INTO host_assignments (match_id, host_user_id, status, fee_amount, currency, offer_expires_at)
       VALUES ($1, $2, 'offered', 10000000, 'UZS', now() + interval '10 minutes')`,
      [matchId, hostId],
    );
    const s = await ctx.http().post(`/v1/admin/hosts/${hostId}/suspend`).set(admin.auth).send({ reason: 'No-show ikki marta' }).expect(200);
    expect(s.body).toMatchObject({ status: 'suspended', suspended_reason: 'No-show ikki marta', cancelled_assignments: 1 });
    await ctx.http().get('/v1/host/offers').set(hostSession.auth).expect(403);
    await ctx.http().post(`/v1/admin/hosts/${hostId}/suspend`).set(admin.auth).send({ reason: 'yana' }).expect(409);
    await ctx.http().post(`/v1/admin/hosts/${hostId}/suspend`).set(admin.auth).send({}).expect(422);

    for (const action of ['host.create', 'host.approve', 'host.update', 'host.suspend']) {
      expect(await auditCount(action, hostId)).toBe(1);
    }
  });

  it("bekor qilish -> refund navbati -> 'bajarildi' (payments.refunded_amount va status) -> to'lovlar ro'yxati", async () => {
    const cancel = await ctx
      .http()
      .post(`/v1/admin/matches/${matchId}/cancel`)
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ reason: 'venue_issue', refund_destination: 'original_method' })
      .expect(202);
    expect(cancel.body.refunds_queued).toBe(1);

    const queue = await ctx.http().get('/v1/admin/refunds').set(admin.auth).expect(200);
    const item = queue.body.items.find((r: { match: { id: string } }) => r.match.id === matchId);
    expect(item).toMatchObject({
      status: 'pending',
      destination: 'original_method',
      reason: 'match_cancelled',
      amount: { amount: 4000000 },
      user: { phone: '+998902000025' },
      payment: { provider: 'payme', status: 'succeeded', refunded: { amount: 0 } },
    });
    expect(queue.body.totals[0].count).toBe(queue.body.total);

    // Idempotency-Key va provider_refund_id majburiy
    await ctx.http().post(`/v1/admin/refunds/${item.id}/complete`).set(admin.auth).send({ provider_refund_id: 'PM-1' }).expect(422);
    await ctx.http().post(`/v1/admin/refunds/${item.id}/complete`).set(admin.auth).set('Idempotency-Key', uuid()).send({}).expect(422);

    const done = await ctx
      .http()
      .post(`/v1/admin/refunds/${item.id}/complete`)
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ provider_refund_id: 'PAYME-RF-0001', note: 'Payme kabinetidan qaytarildi' })
      .expect(200);
    expect(done.body).toMatchObject({
      status: 'succeeded',
      provider_refund_id: 'PAYME-RF-0001',
      note: 'Payme kabinetidan qaytarildi',
      processed_by: { id: admin.userId },
      payment: { status: 'refunded', refunded: { amount: 4000000 } },
    });
    expect(done.body.completed_at).toBeTruthy();
    const pay = (await q(ctx, 'SELECT status, refunded_amount FROM payments WHERE id = $1', [item.payment.id]))[0]!;
    expect(pay).toEqual({ status: 'refunded', refunded_amount: 4000000 });
    await ctx.http().post(`/v1/admin/refunds/${item.id}/complete`).set(admin.auth).set('Idempotency-Key', uuid()).send({ provider_refund_id: 'X' }).expect(409);
    expect(await auditCount('refund.complete', item.id)).toBe(1);
    expect((await q(ctx, "SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'RefundIssued'", [item.id]))[0]!.n).toBe(1);

    const pending = await ctx.http().get('/v1/admin/refunds').set(admin.auth).expect(200);
    expect(pending.body.items.some((r: { id: string }) => r.id === item.id)).toBe(false);
    const succeeded = await ctx.http().get('/v1/admin/refunds?status=succeeded&destination=original_method,wallet').set(admin.auth).expect(200);
    expect(succeeded.body.items.some((r: { id: string }) => r.id === item.id)).toBe(true);

    // Hamyonga qaytarilgan refund navbatda emas — "bajarildi" deb belgilab bo'lmaydi
    const walletRefund = (await q(ctx, "SELECT id FROM refunds WHERE destination = 'wallet' LIMIT 1"))[0];
    if (walletRefund) {
      await ctx.http().post(`/v1/admin/refunds/${walletRefund.id}/complete`).set(admin.auth).set('Idempotency-Key', uuid()).send({ provider_refund_id: 'X' }).expect(409);
    }

    // To'lovlar ro'yxati: filtrlar va qidiruv
    const p = await ctx.http().get(`/v1/admin/payments?match_id=${matchId}`).set(admin.auth).expect(200);
    expect(p.body.total).toBe(2);
    expect(p.body.items.map((x: { status: string }) => x.status).sort()).toEqual(['cancelled', 'refunded']);
    expect(p.body.totals[0]).toMatchObject({ currency: 'UZS', count: 2, succeeded: { amount: 4000000 }, refunded: { amount: 4000000 } });
    const refundedOnly = await ctx.http().get(`/v1/admin/payments?match_id=${matchId}&status=refunded&provider=payme`).set(admin.auth).expect(200);
    expect(refundedOnly.body.items).toHaveLength(1);
    expect(refundedOnly.body.items[0]).toMatchObject({ user: { phone: '+998902000025' }, match: { id: matchId } });
    const byPhone = await ctx.http().get('/v1/admin/payments?q=902000025').set(admin.auth).expect(200);
    expect(byPhone.body.items.every((x: { user: { phone: string } }) => x.user.phone === '+998902000025')).toBe(true);
    const byTx = await ctx.http().get(`/v1/admin/payments?q=${refundedOnly.body.items[0].provider_transaction_id}`).set(admin.auth).expect(200);
    expect(byTx.body.items[0].id).toBe(refundedOnly.body.items[0].id);

    const m = await ctx.http().get(`/v1/admin/matches/${matchId}`).set(admin.auth).expect(200);
    expect(m.body).toMatchObject({ status: 'cancelled', cancel_reason: 'venue_issue', revenue: { gross: { amount: 4000000 }, refunded: { amount: 4000000 }, net: { amount: 0 } } });
    expect(m.body.refunds[0]).toMatchObject({ status: 'succeeded', provider_refund_id: 'PAYME-RF-0001' });
  });

  it('dashboard: match\'lar, to\'lish darajasi, GMV, ijara, host to\'lovlari, marja, no-show, bekor qilishlar', async () => {
    const from = new Date(Date.now() - 24 * 3600_000).toISOString();
    const to = new Date(Date.now() + 14 * 24 * 3600_000).toISOString();
    const r = await ctx
      .http()
      .get(`/v1/admin/dashboard?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}&city_id=${tashkent}`)
      .set(admin.auth)
      .expect(200);
    const b = r.body;
    expect(b.matches.total).toBe(Object.values(b.matches.by_status as Record<string, number>).reduce((a, n) => a + n, 0));
    expect(b.matches.by_status.cancelled).toBeGreaterThanOrEqual(1);
    expect(b.cancellations.by_reason.find((x: { reason: string }) => x.reason === 'venue_issue').count).toBeGreaterThanOrEqual(1);
    expect(b.fill_rate).toBeCloseTo(b.seats.confirmed / b.seats.capacity, 3);
    expect(b.net_revenue.amount).toBe(b.gmv.amount - b.refunds.amount);
    expect(b.gross_margin.amount).toBe(b.net_revenue.amount - b.lease_cost.amount - b.host_payouts.amount);
    expect(b.gmv.amount).toBeGreaterThanOrEqual(4000000);
    expect(b.lease_cost.amount).toBeGreaterThanOrEqual(20000000); // bekor qilingan match ijarasi ham hisoblanadi
    expect(b.host_payouts.amount).toBeGreaterThanOrEqual(15000000); // seed: MU-BSK1 ga host tayinlangan
    expect(b.gmv.formatted).toMatch(/so'm$/);
    expect(b.series.length).toBeGreaterThan(0);
    expect(b.series.reduce((a: number, s: { matches: number }) => a + s.matches, 0)).toBe(b.matches.total);

    // No-show darajasi: tugagan o'yin roster'i bo'yicha
    const sam = await ctx.http().get('/v1/admin/dashboard').set(admin.auth).expect(200);
    expect(sam.body.range.currency).toBe('UZS');
    expect(sam.body.no_show_rate === null || typeof sam.body.no_show_rate === 'number').toBe(true);
    await ctx.http().get(`/v1/admin/dashboard?date_from=${encodeURIComponent(to)}&date_to=${encodeURIComponent(from)}`).set(admin.auth).expect(422);
    await ctx.http().get('/v1/admin/dashboard?date_from=yesterday').set(admin.auth).expect(422);
  });
});
