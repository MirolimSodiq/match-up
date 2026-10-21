import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import { EVENTS_STREAM } from '../src/common/outbox';
import { DispatchService } from '../src/host/host.service';
import { OutboxRelay } from '../src/jobs/jobs.module';
import { NotificationEvents } from '../src/notifications/events/notification-events';
import { EventConsumers, NotificationJobs } from '../src/notifications/notification-jobs';
import { NotificationsService } from '../src/notifications/notifications.service';
import { formatWhen } from '../src/notifications/templates';
import { DataExportService } from '../src/privacy/data-export.service';
import { REDIS } from '../src/redis/redis.module';
import { bookAndPayWithPayme, createTestApp, login, payme, q, signatureId, uuid, type Session, type TestCtx } from './helpers';

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
const expoToken = () => `ExponentPushToken[${uuid()}]`;

describe('Notifications: push, eslatmalar, kutish ro\'yxati, WebSocket', () => {
  let ctx: TestCtx;
  let admin: Session;
  let pitchA: string;
  let phoneSeq = 0;
  const sockets: Socket[] = [];

  let raceId: string;

  /** Yangi telefon raqami bilan o'yinchi (seed booking'lari bilan to'qnashmaslik uchun) — waiver imzolangan. */
  async function newPlayer(): Promise<Session> {
    const s = await login(ctx, `+99893700${String(++phoneSeq).padStart(4, '0')}`);
    const req = await ctx.http().get(`/v1/waivers/required?match_id=${raceId}`).set(s.auth).expect(200);
    const tpl = req.body.template;
    await ctx
      .http()
      .post(`/v1/waivers/${tpl.id}/signatures`)
      .set(s.auth)
      .send({ accepted: true, method: 'clickwrap', document_sha256: tpl.document_sha256, match_id: raceId })
      .expect(201);
    return s;
  }

  async function registerDevice(s: Session, token = expoToken(), platform = 'ios') {
    await ctx.http().put('/v1/me/devices').set(s.auth).send({ push_token: token, platform, app_version: '1.0.0' }).expect(200);
    return token;
  }

  /** Outbox -> Redis Stream -> consumer group'lar (realtime + notifications). */
  async function pump() {
    const relay = ctx.app.get(OutboxRelay);
    while ((await relay.run()) > 0);
    await ctx.app.get(EventConsumers).drain();
  }

  async function createMatch(hours: number, extra: Record<string, unknown> = {}) {
    const body = {
      pitch_id: pitchA,
      sport: 'football',
      starts_at: inHours(hours),
      duration_min: 90,
      format: '7v7',
      players_per_side: 7,
      min_players: 10,
      max_players: 14,
      price: { amount: 5000000, currency: 'UZS' },
      lease_cost: { amount: 40000000, currency: 'UZS' },
      host_fee: { amount: 15000000, currency: 'UZS' },
      title: { 'uz-Latn': 'Kechki futbol', ru: 'Вечерний футбол', en: 'Evening football' },
      ...extra,
    };
    const c = await ctx.http().post('/v1/admin/matches').set(admin.auth).set('Idempotency-Key', uuid()).send(body);
    if (c.status !== 201) throw new Error(JSON.stringify(c.body));
    await ctx.http().post(`/v1/admin/matches/${c.body.id}/publish`).set(admin.auth).expect(200);
    return c.body.id as string;
  }

  async function notificationsOf(userId: string, type?: string) {
    return q(
      ctx,
      `SELECT id, type, status, error, locale, category, payload, dedupe_key, attempts FROM notifications
       WHERE user_id = $1 ${type ? 'AND type = $2' : ''} ORDER BY created_at`,
      type ? [userId, type] : [userId],
    );
  }

  function connect(token?: string): Promise<Socket> {
    const s = io(ctx.url, { path: '/ws', transports: ['websocket'], auth: token ? { token } : {}, reconnection: false, forceNew: true });
    sockets.push(s);
    return new Promise((resolve, reject) => {
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
  }

  function nextEvent<T = any>(s: Socket, event: string, match: (p: T) => boolean = () => true, ms = 5000): Promise<T> {
    const p = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        s.off(event, handler);
        reject(new Error(`${event} kelmadi`));
      }, ms);
      const handler = (p: T) => {
        if (!match(p)) return;
        clearTimeout(timer);
        s.off(event, handler);
        resolve(p);
      };
      s.on(event, handler);
    });
    p.catch(() => undefined); // test oldinroq yiqilsa — unhandled rejection bo'lmasin
    return p;
  }

  const subscribe = (s: Socket, room: string) => s.timeout(5000).emitWithAck('subscribe', { room });

  beforeAll(async () => {
    ctx = await createTestApp();
    // Oldingi spec'lardan qolgan event'lar consumer group yaratilishidan oldin stream'ga chiqadi va o'tkazib yuboriladi
    while ((await ctx.app.get(OutboxRelay).run()) > 0);
    await ctx.app.get(EventConsumers).ensureGroups();
    admin = await login(ctx, '+998901110001');
    pitchA = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'chilonzor-arena'"))[0]!.id;
    raceId = (await q(ctx, "SELECT id FROM matches WHERE public_code = 'MU-RACE'"))[0]!.id;
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await ctx.close();
  });

  it('PUT/DELETE /v1/me/devices: ro\'yxatdan o\'tkazish, egasini almashtirish, o\'chirish', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await ctx.http().put('/v1/me/devices').send({ push_token: expoToken(), platform: 'ios' }).expect(401);
    const bad = await ctx.http().put('/v1/me/devices').set(a.auth).send({ push_token: 'not-a-token-123', platform: 'ios' }).expect(422);
    expect(bad.body.errors[0].field).toBe('push_token');

    const token = expoToken();
    const r = await ctx.http().put('/v1/me/devices').set(a.auth).set('Accept-Language', 'ru').send({ push_token: token, platform: 'android' }).expect(200);
    expect(r.body).toMatchObject({ platform: 'android', provider: 'expo', locale: 'ru' });
    // Qayta yuborish — yangi qator emas, yangilanish
    await ctx.http().put('/v1/me/devices').set(a.auth).send({ push_token: token, platform: 'android', app_version: '1.1.0' }).expect(200);
    expect(await q(ctx, 'SELECT user_id, app_version FROM device_tokens WHERE push_token = $1', [token])).toEqual([
      { user_id: a.userId, app_version: '1.1.0' },
    ]);
    // Umumiy qurilma: boshqa akkaunt kirdi — token unga o'tadi
    await ctx.http().put('/v1/me/devices').set(b.auth).send({ push_token: token, platform: 'android' }).expect(200);
    expect((await q(ctx, 'SELECT user_id FROM device_tokens WHERE push_token = $1', [token]))[0]!.user_id).toBe(b.userId);

    // Boshqa odam o'chira olmaydi; egasi o'chiradi; takroriy DELETE ham 204
    await ctx.http().delete(`/v1/me/devices/${encodeURIComponent(token)}`).set(a.auth).expect(204);
    expect(await q(ctx, 'SELECT 1 FROM device_tokens WHERE push_token = $1', [token])).toHaveLength(1);
    await ctx.http().delete(`/v1/me/devices/${encodeURIComponent(token)}`).set(b.auth).expect(204);
    await ctx.http().delete(`/v1/me/devices/${encodeURIComponent(token)}`).set(b.auth).expect(204);
    expect(await q(ctx, 'SELECT 1 FROM device_tokens WHERE push_token = $1', [token])).toHaveLength(0);
  });

  it("BookingConfirmed -> o'yinchiga push (users.locale bo'yicha), in-app ro'yxat, idempotentlik", async () => {
    const matchId = await createMatch(200);
    const p = await newPlayer();
    await ctx.http().patch('/v1/me').set(p.auth).send({ locale: 'ru' }).expect(200);
    const token = await registerDevice(p);
    const { bookingId } = await bookAndPayWithPayme(ctx, p, matchId);
    await pump();

    const msgs = ctx.push.to(token);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      title: 'Место забронировано',
      data: { url: `/booking/${bookingId}`, booking_id: bookingId, match_id: matchId, type: 'booking.confirmed' },
      badge: 1,
      priority: 'high',
    });
    expect(msgs[0]!.body).toContain('Вечерний футбол');
    expect(msgs[0]!.body).toMatch(/\d{1,2} \S+ в \d{2}:\d{2}/); // "29 октября в 19:00" (venue vaqt zonasida)

    const [n] = await notificationsOf(p.userId, 'booking.confirmed');
    expect(n).toMatchObject({ status: 'sent', locale: 'ru', category: 'transactional', attempts: 1 });
    expect(await q(ctx, 'SELECT status, ticket_id FROM push_deliveries WHERE notification_id = $1', [n!.id])).toEqual([
      { status: 'sent', ticket_id: expect.stringMatching(/^ticket-/) },
    ]);

    // Idempotentlik: xuddi shu outbox event (bir xil id) stream'ga qayta tushdi — yangi xabar yo'q
    const ev = (await q(ctx, "SELECT * FROM outbox_events WHERE event_type = 'BookingConfirmed' AND aggregate_id = $1", [bookingId]))[0]!;
    await ctx.app.get<Redis>(REDIS).xadd(
      EVENTS_STREAM, '*', 'id', ev.id, 'type', ev.event_type, 'aggregate', `booking:${bookingId}`, 'payload', JSON.stringify(ev.payload),
    );
    await pump();
    expect(ctx.push.to(token)).toHaveLength(1);
    expect(await notificationsOf(p.userId, 'booking.confirmed')).toHaveLength(1);

    // GET /v1/me/notifications (cursor) + o'qildi deb belgilash
    const list = await ctx.http().get('/v1/me/notifications?limit=1').set(p.auth).expect(200);
    expect(list.body).toMatchObject({ unread_count: 1, next_cursor: null });
    expect(list.body.items[0]).toMatchObject({ id: n!.id, type: 'booking.confirmed', title: 'Место забронировано', read_at: null });
    await ctx.http().post('/v1/me/notifications/read').set(p.auth).send({ ids: [] }).expect(422);
    const read = await ctx.http().post('/v1/me/notifications/read').set(p.auth).send({ ids: [n!.id] }).expect(200);
    expect(read.body).toEqual({ updated: 1, unread_count: 0 });
    const after = await ctx.http().get('/v1/me/notifications').set(p.auth).expect(200);
    expect(after.body.items[0].read_at).not.toBeNull();
  });

  it("bekor qilish: BookingCancelled + RefundIssued; tarmoq xatosi -> retry; DeviceNotRegistered -> token o'chiriladi", async () => {
    const matchId = await createMatch(210);
    const p = await newPlayer();
    await ctx.http().patch('/v1/me').set(p.auth).send({ locale: 'en' }).expect(200);
    const dead = await registerDevice(p, expoToken(), 'android');
    const live = await registerDevice(p);
    ctx.push.failTokens.set(dead, 'DeviceNotRegistered');
    const { bookingId } = await bookAndPayWithPayme(ctx, p, matchId);
    await pump();
    expect(ctx.push.to(live).map((m) => m.data.type)).toEqual(['booking.confirmed']);
    expect((await q(ctx, 'SELECT disabled_at, disabled_reason FROM device_tokens WHERE push_token = $1', [dead]))[0]).toEqual({
      disabled_at: expect.any(Date),
      disabled_reason: 'DeviceNotRegistered',
    });

    // Provider vaqtincha ishlamayapti: ikkala event'ning xabarlari navbatda qoladi
    ctx.push.throwNext = 2;
    await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set(p.auth)
      .set('Idempotency-Key', uuid())
      .send({ refund_destination: 'wallet' })
      .expect(200);
    await pump();
    const queued = await q(ctx, "SELECT type, status, error FROM notifications WHERE user_id = $1 AND status = 'queued' ORDER BY type", [p.userId]);
    expect(queued).toEqual([
      { type: 'booking.cancelled', status: 'queued', error: 'fake: network down' },
      { type: 'refund.issued', status: 'queued', error: 'fake: network down' },
    ]);
    // Retry job: muddati kelgan navbat
    await q(ctx, "UPDATE notifications SET next_attempt_at = now() WHERE user_id = $1 AND status = 'queued'", [p.userId]);
    expect(await ctx.app.get(NotificationJobs).retryQueued()).toBe(2);
    const msgs = ctx.push.to(live);
    expect(msgs[0]!.title).toBe("You're in!");
    expect(msgs.slice(1).map((m) => m.title).sort()).toEqual(['Booking cancelled', 'Refund issued']);
    expect(msgs.find((m) => m.data.type === 'refund.issued')!.body).toBe('50,000 UZS was credited to your wallet — Evening football.');
    expect(ctx.push.to(dead)).toHaveLength(1); // faqat birinchi urinish — o'chirilgan token'ga qayta yuborilmaydi

    // Receipt: oxirgi qurilma ham ro'yxatdan chiqqan -> token o'chiriladi, xabar failed
    const lastTicket = (await q(ctx, `SELECT d.ticket_id, d.notification_id FROM push_deliveries d JOIN notifications n ON n.id = d.notification_id
                                       WHERE n.user_id = $1 AND n.type = 'refund.issued'`, [p.userId]))[0]!;
    ctx.push.receiptErrors.set(lastTicket.ticket_id, 'DeviceNotRegistered');
    const receipts = await ctx.app.get(NotificationsService).checkReceipts(0);
    expect(receipts.failed).toBeGreaterThanOrEqual(1);
    expect((await q(ctx, 'SELECT disabled_reason FROM device_tokens WHERE push_token = $1', [live]))[0]!.disabled_reason).toBe('DeviceNotRegistered');
    expect((await q(ctx, 'SELECT status, error FROM notifications WHERE id = $1', [lastTicket.notification_id]))[0]).toEqual({
      status: 'failed',
      error: 'DeviceNotRegistered',
    });
    const confirmed = (await notificationsOf(p.userId, 'booking.confirmed'))[0]!;
    expect(confirmed.status).toBe('delivered');
  });

  it("MatchCancelled -> match'ga yozilgan barcha o'yinchilarga; qurilmasiz foydalanuvchi ham tarixda", async () => {
    const matchId = await createMatch(220);
    const p1 = await newPlayer();
    const p2 = await newPlayer();
    const p3 = await newPlayer(); // qurilmasiz
    const t1 = await registerDevice(p1);
    const t2 = await registerDevice(p2);
    for (const p of [p1, p2, p3]) await bookAndPayWithPayme(ctx, p, matchId);
    await pump();
    await ctx
      .http()
      .post(`/v1/admin/matches/${matchId}/cancel`)
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({ reason: 'weather', refund_destination: 'wallet', wallet_bonus_pct: 10 })
      .expect(202);
    await pump();
    for (const t of [t1, t2]) {
      const types = ctx.push.to(t).map((m) => m.data.type);
      expect(types.sort()).toEqual(['booking.confirmed', 'match.cancelled', 'refund.issued']); // BookingCancelled alohida yuborilmaydi
      const cancelled = ctx.push.to(t).find((m) => m.data.type === 'match.cancelled')!;
      expect(cancelled).toMatchObject({ title: "O'yin bekor qilindi", data: { match_id: matchId } });
      expect(ctx.push.to(t).find((m) => m.data.type === 'refund.issued')!.body).toMatch(/^55\s000 so'm hamyoningizga qaytarildi/);
    }
    expect(await notificationsOf(p3.userId, 'match.cancelled')).toEqual([
      expect.objectContaining({ status: 'failed', error: 'NO_ACTIVE_DEVICE' }),
    ]);
  });

  it("kutish ro'yxati: SlotsReleased -> birinchiga 10 daqiqalik eksklyuziv taklif, muddat o'tsa — keyingisiga", async () => {
    const matchId = await createMatch(230, { format: '1v1', players_per_side: 1, min_players: 2, max_players: 2 });
    const [p1, p2, w1, w2, outsider] = [await newPlayer(), await newPlayer(), await newPlayer(), await newPlayer(), await newPlayer()];
    const tw1 = await registerDevice(w1);
    const tw2 = await registerDevice(w2);
    const { bookingId } = await bookAndPayWithPayme(ctx, p1, matchId);
    await bookAndPayWithPayme(ctx, p2, matchId);
    expect((await ctx.http().post(`/v1/matches/${matchId}/waitlist`).set(w1.auth).expect(201)).body).toEqual({ position: 1 });
    expect((await ctx.http().post(`/v1/matches/${matchId}/waitlist`).set(w2.auth).expect(201)).body).toEqual({ position: 2 });
    await pump();

    await ctx.http().post(`/v1/bookings/${bookingId}/cancel`).set(p1.auth).set('Idempotency-Key', uuid()).send({ refund_destination: 'wallet' }).expect(200);
    await pump();
    const offer = ctx.push.to(tw1);
    expect(offer).toHaveLength(1);
    expect(offer[0]).toMatchObject({ title: "Joy bo'shadi!", data: { type: 'waitlist.offer', url: `/match/${matchId}`, match_id: matchId }, ttl: 600 });
    expect(ctx.push.to(tw2)).toHaveLength(0);
    const wl = await q(ctx, `SELECT u.id AS user_id, w.status, extract(epoch FROM w.offer_expires_at - now())::int AS left_s
                             FROM match_waitlist w JOIN users u ON u.id = w.user_id WHERE w.match_id = $1 ORDER BY w.created_at`, [matchId]);
    expect(wl[0]).toMatchObject({ user_id: w1.userId, status: 'notified' });
    expect(wl[0]!.left_s).toBeGreaterThan(590);
    expect(wl[1]).toMatchObject({ user_id: w2.userId, status: 'waiting' });

    // Eksklyuziv oyna: navbatda bo'lmagan odam bo'sh joyni ola olmaydi
    const r = await ctx
      .http()
      .post('/v1/bookings')
      .set(outsider.auth)
      .set('Idempotency-Key', uuid())
      .send({ match_id: matchId, payment_method: 'payme', waiver_signature_id: await signatureId(ctx, outsider, matchId) })
      .expect(409);
    expect(r.body.code).toBe('MATCH_FULL');
    // Qayta yetkazilgan SlotsReleased / takroriy job yangi taklif bermaydi (faol taklif joyni egallab turibdi)
    expect(await ctx.app.get(NotificationEvents).offerWaitlist(matchId)).toBe(0);
    expect(await ctx.app.get(NotificationJobs).waitlistOffers()).toEqual({ matches: 0, offered: 0 });

    // 10 daqiqa o'tdi -> w1 expired, w2 ga taklif
    await q(ctx, "UPDATE match_waitlist SET offer_expires_at = now() - interval '1 second' WHERE match_id = $1 AND user_id = $2", [matchId, w1.userId]);
    expect(await ctx.app.get(NotificationJobs).waitlistOffers()).toEqual({ matches: 1, offered: 1 });
    expect(ctx.push.to(tw2).map((m) => m.data.type)).toEqual(['waitlist.offer']);
    // w2 joyni oladi -> navbat yozuvi converted
    await bookAndPayWithPayme(ctx, w2, matchId);
    await pump();
    expect((await q(ctx, 'SELECT user_id, status FROM match_waitlist WHERE match_id = $1 ORDER BY created_at', [matchId])).map((x) => x.status)).toEqual([
      'expired',
      'converted',
    ]);
  });

  it('eslatmalar: T-24h va T-2h, har biri faqat bir marta', async () => {
    const matchId = await createMatch(240);
    const p = await newPlayer();
    const late = await newPlayer(); // eslatma vaqtidan keyin band qilgan
    const token = await registerDevice(p);
    const lateToken = await registerDevice(late);
    const { bookingId } = await bookAndPayWithPayme(ctx, p, matchId);
    await bookAndPayWithPayme(ctx, late, matchId);
    await pump();
    const jobs = ctx.app.get(NotificationJobs);
    const shift = (h: number) =>
      q(
        ctx,
        `UPDATE matches SET starts_at = now() + make_interval(mins => $2), ends_at = now() + make_interval(mins => $2 + 90),
                booking_closes_at = now() + make_interval(mins => $2 - 30), min_players_deadline = now() + make_interval(mins => $2 - 180)
         WHERE id = $1`,
        [matchId, Math.round(h * 60)],
      );
    const sent = async (s: Session, type: string) => (await notificationsOf(s.userId, type)).length;
    await q(ctx, "UPDATE bookings SET confirmed_at = now() - interval '3 days' WHERE id = $1", [bookingId]);
    await jobs.reminders();
    expect(await sent(p, 'match.reminder_24h')).toBe(0); // hali 24 soatdan ko'p

    await shift(23);
    await jobs.reminders();
    await jobs.reminders();
    expect(await sent(p, 'match.reminder_24h')).toBe(1);
    expect(await sent(late, 'match.reminder_24h')).toBe(0); // T-24h dan keyin band qilgan
    const r24 = ctx.push.to(token).find((m) => m.data.type === 'match.reminder_24h')!;
    expect(r24).toMatchObject({ title: "Ertaga o'yin", data: { url: `/booking/${bookingId}`, map_url: expect.stringMatching(/^https:\/\/maps\.google\.com\/\?q=41\./) } });
    expect(r24.body).toContain('Manzil:');

    // late o'yinga 2.5 soat qolganda band qilgan (T-2h dan oldin) -> unga faqat 2h eslatmasi
    await q(ctx, "UPDATE bookings SET confirmed_at = now() - interval '1 hour' WHERE user_id = $1 AND match_id = $2", [late.userId, matchId]);
    await shift(1.5);
    await jobs.reminders();
    await jobs.reminders();
    expect(await sent(p, 'match.reminder_2h')).toBe(1);
    expect(await sent(late, 'match.reminder_2h')).toBe(1);
    expect(ctx.push.to(token).map((m) => m.data.type)).toEqual(['booking.confirmed', 'match.reminder_24h', 'match.reminder_2h']);
    expect(ctx.push.to(lateToken).map((m) => m.data.type)).toEqual(['booking.confirmed', 'match.reminder_2h']);
    expect(ctx.push.to(token).at(-1)!.title).toBe("2 soatdan keyin o'yin");
  });

  it("MatchCompleted -> check-in qilgan o'yinchilarga baho so'rovi", async () => {
    const matchId = await createMatch(250);
    const came = await newPlayer();
    const absent = await newPlayer();
    const tc = await registerDevice(came);
    const ta = await registerDevice(absent);
    await bookAndPayWithPayme(ctx, came, matchId);
    await bookAndPayWithPayme(ctx, absent, matchId);
    await pump();
    await q(ctx, "UPDATE match_participants SET status = 'checked_in' WHERE match_id = $1 AND user_id = $2", [matchId, came.userId]);
    await q(ctx, "INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('match', $1, 'MatchCompleted', '{}')", [matchId]);
    await pump();
    expect(ctx.push.to(tc).at(-1)).toMatchObject({ title: "O'yin qanday o'tdi?", data: { type: 'match.rate', url: `/match/${matchId}?rate=1` } });
    expect(ctx.push.to(ta).map((m) => m.data.type)).toEqual(['booking.confirmed']);
  });

  it("marketing (yangi o'yin) faqat marketing_push consent bilan; tranzaksion — har doim", async () => {
    const yes = await newPlayer();
    const no = await newPlayer();
    for (const p of [yes, no]) {
      await ctx.http().patch('/v1/me').set(p.auth).send({ home_city_id: 1 }).expect(200);
      await ctx.http().put('/v1/me/sports/football').set(p.auth).send({ self_level: 'intermediate' }).expect(200);
    }
    await ctx.http().put('/v1/me/consents').set(yes.auth).send({ consents: [{ purpose: 'marketing_push', granted: true }] }).expect(200);
    await ctx.http().put('/v1/me/consents').set(no.auth).send({ consents: [{ purpose: 'marketing_push', granted: false }] }).expect(200);
    const ty = await registerDevice(yes);
    const tn = await registerDevice(no);
    const matchId = await createMatch(260);
    await pump();
    expect(ctx.push.to(ty).filter((m) => m.data.match_id === matchId)).toEqual([
      expect.objectContaining({ title: "Yangi o'yin", data: expect.objectContaining({ type: 'match.new', url: `/match/${matchId}` }) }),
    ]);
    expect(ctx.push.to(tn)).toHaveLength(0);
    expect(await notificationsOf(no.userId, 'match.new')).toHaveLength(0);
    expect((await notificationsOf(yes.userId, 'match.new'))[0]).toMatchObject({ category: 'marketing' });

    // Consent'siz foydalanuvchi ham tranzaksion xabarni oladi
    await bookAndPayWithPayme(ctx, no, matchId);
    await pump();
    expect(ctx.push.to(tn).map((m) => m.data.type)).toEqual(['booking.confirmed']);
  });

  it("WebSocket: match:{id} (token'siz) -> slots.updated; booking:{id} faqat egasiga -> booking.updated", async () => {
    const matchId = await createMatch(270);
    const owner = await newPlayer();
    const other = await newPlayer();

    await expect(connect('not-a-jwt')).rejects.toThrow('UNAUTHORIZED');

    const anon = await connect();
    const ack = await subscribe(anon, `match:${matchId}`);
    expect(ack).toEqual({ ok: true, room: `match:${matchId}`, state: { match_id: matchId, available: 14, taken: 0, max: 14, status: 'open' } });
    expect(await subscribe(anon, `match:${uuid()}`)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await subscribe(anon, 'lobby')).toMatchObject({ ok: false, code: 'BAD_REQUEST' });

    // Hold: joy band qilindi (to'lov kutilmoqda) -> jonli bo'sh joylar
    const held = nextEvent(anon, 'slots.updated', (p: { taken: number }) => p.taken === 1);
    const b = await ctx
      .http()
      .post('/v1/bookings')
      .set(owner.auth)
      .set('Idempotency-Key', uuid())
      .send({ match_id: matchId, payment_method: 'payme', waiver_signature_id: await signatureId(ctx, owner, matchId) })
      .expect(201);
    const bookingId = b.body.booking.id as string;
    await pump();
    expect(await held).toEqual({ match_id: matchId, available: 13, taken: 1, max: 14, status: 'open' });

    // booking xonasi: token'siz — yo'q, begona — yo'q (mavjudligi oshkor qilinmaydi), egasi — ha
    expect(await subscribe(anon, `booking:${bookingId}`)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    const otherSock = await connect(other.token);
    expect(await subscribe(otherSock, `booking:${bookingId}`)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const ownerSock = await connect(owner.token);
    expect(await subscribe(ownerSock, `booking:${bookingId}`)).toEqual({
      ok: true,
      room: `booking:${bookingId}`,
      state: { booking_id: bookingId, match_id: matchId, status: 'pending_payment' },
    });
    expect(await subscribe(ownerSock, `host:${owner.userId}`)).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    // Payme to'lovi -> booking.updated (polling'siz)
    const updated = nextEvent(ownerSock, 'booking.updated', (p: { status: string }) => p.status === 'confirmed');
    const leak = nextEvent(otherSock, 'booking.updated', () => true, 1500).then(
      () => 'leaked',
      () => 'ok',
    );
    const txId = createHash('md5').update(bookingId).digest('hex').slice(0, 24);
    const params = { amount: b.body.booking.total.amount, account: { booking_id: bookingId } };
    await payme(ctx, 'CheckPerformTransaction', params);
    await payme(ctx, 'CreateTransaction', { id: txId, time: Date.now(), ...params });
    await payme(ctx, 'PerformTransaction', { id: txId });
    await pump();
    expect(await updated).toEqual({ booking_id: bookingId, match_id: matchId, status: 'confirmed' });
    expect(await leak).toBe('ok');
  });

  it("WebSocket host:{userId} -> offer.created; push host'ga", async () => {
    const host = await login(ctx, '+998901110002');
    const hostToken = await registerDevice(host);
    const matchId = await createMatch(280);
    // To'lgan match -> dispatch darhol taklif yuboradi
    await q(ctx, "UPDATE matches SET confirmed_slots = max_players, status = 'full' WHERE id = $1", [matchId]);

    const sock = await connect(host.token);
    expect(await subscribe(sock, `host:${host.userId}`)).toEqual({ ok: true, room: `host:${host.userId}` });
    const offer = nextEvent(sock, 'offer.created', (p: { match_id: string }) => p.match_id === matchId);
    await ctx.app.get(DispatchService).run();
    await pump();
    const assignment = (await q(ctx, 'SELECT id FROM host_assignments WHERE match_id = $1 AND host_user_id = $2', [matchId, host.userId]))[0]!;
    expect(await offer).toEqual({ assignment_id: assignment.id, match_id: matchId, offer_expires_at: expect.any(String) });

    const push = ctx.push.to(hostToken).find((m) => m.data.match_id === matchId)!;
    expect(push).toMatchObject({ title: 'Yangi taklif', data: { type: 'host.offer', assignment_id: assignment.id, url: `/?offer=${assignment.id}` } });
    expect(push.body).toMatch(/150\s000 so'm/);
    expect(push.ttl).toBeGreaterThan(500);
    await q(ctx, "UPDATE matches SET confirmed_slots = 0, status = 'open' WHERE id = $1", [matchId]);
  });

  it("DataExportReady -> eksport egasiga push (users.locale, shahar vaqt zonasi, /account/privacy); o'chirilgan fayl uchun push yo'q", async () => {
    const en = await login(ctx, '+998937009001');
    const uz = await login(ctx, '+998937009002');
    await ctx.http().patch('/v1/me').set(en.auth).send({ locale: 'en', home_city_id: 1 }).expect(200);
    const tEn = await registerDevice(en);
    const tUz = await registerDevice(uz);
    const reqEn = (await ctx.http().post('/v1/me/data-export').set(en.auth).expect(202)).body.id as string;
    const reqUz = (await ctx.http().post('/v1/me/data-export').set(uz.auth).expect(202)).body.id as string;
    await pump();
    expect(ctx.push.to(tEn)).toHaveLength(0); // so'rov qabul qilindi — hali xabar yo'q

    expect((await ctx.app.get(DataExportService).run()).exported).toBeGreaterThanOrEqual(2);
    // uz: push yetib borguncha fayl o'chirildi (muddat o'tdi) — kechikkan xabar yuborilmaydi
    await q(ctx, "UPDATE data_subject_requests SET export_expires_at = now() - interval '1 second', export_path = NULL WHERE id = $1", [reqUz]);
    await pump();

    const [dsr] = await q(ctx, 'SELECT export_expires_at FROM data_subject_requests WHERE id = $1', [reqEn]);
    const msgs = ctx.push.to(tEn);
    expect(msgs).toEqual([
      expect.objectContaining({
        title: 'Your data is ready',
        body: `Download a copy of your personal data by ${formatWhen(dsr!.export_expires_at, 'Asia/Tashkent', 'en')}.`,
        data: expect.objectContaining({ type: 'privacy.export_ready', url: '/account/privacy', request_id: reqEn }),
        priority: 'default',
      }),
    ]);
    expect(msgs[0]!.body).toMatch(/by \w+ \d{1,2} at \d{2}:\d{2}\.$/); // "October 27 at 19:00"
    expect(msgs[0]!.ttl).toBeGreaterThan(6 * 24 * 3600); // fayl muddati (7 kun) tugaguncha
    expect((await notificationsOf(en.userId, 'privacy.export_ready'))[0]).toMatchObject({ status: 'sent', locale: 'en', category: 'transactional' });

    expect(ctx.push.to(tUz)).toHaveLength(0);
    expect(await notificationsOf(uz.userId, 'privacy.export_ready')).toHaveLength(0);

    // uz-Latn matni (shablon) — yangi eksport, shahar tanlanmagan -> mamlakat vaqt zonasi
    const reqUz2 = (await ctx.http().post('/v1/me/data-export').set(uz.auth).expect(202)).body.id as string;
    await ctx.app.get(DataExportService).run();
    await pump();
    const [uzMsg] = ctx.push.to(tUz);
    expect(uzMsg).toMatchObject({ title: "Ma'lumotlaringiz tayyor", data: { url: '/account/privacy', request_id: reqUz2 } });
    expect(uzMsg!.body).toMatch(/^Shaxsiy ma'lumotlaringiz nusxasini \d{1,2}-\S+, \d{2}:\d{2} gacha yuklab olishingiz mumkin\.$/);
  });
});
