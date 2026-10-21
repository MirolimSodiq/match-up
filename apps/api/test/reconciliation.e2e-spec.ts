import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ClickReconciliationAdapter,
  PaymeReconciliationAdapter,
  type ProviderTransaction,
  RECONCILIATION_ADAPTERS,
  type ReconciliationAdapter,
} from '../src/payments/reconciliation.adapters';
import { ReconciliationService } from '../src/payments/reconciliation.service';
import { bookAndPayWithPayme, bookAndPayWithUzum, createTestApp, login, q, uuid, type Session, type TestCtx } from './helpers';

/** Uzum'ning hisobot API'si yo'q — testda uning o'rniga davr bo'yicha ro'yxat beradigan fake provider. */
class FakeUzumAdapter implements ReconciliationAdapter {
  readonly provider = 'uzum' as const;
  readonly unsupported = null;
  transactions: ProviderTransaction[] = [];
  calls: { from: Date; to: Date }[] = [];
  async fetchTransactions(from: Date, to: Date) {
    this.calls.push({ from, to });
    return this.transactions;
  }
}

/** Payme Subscribe API (receipts.get_all) o'rnidagi lokal server: X-Auth va sahifalash tekshiriladi. */
function paymeServer(receipts: () => Record<string, unknown>[], seen: Record<string, any>[]) {
  return createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const rpc = JSON.parse(body);
      seen.push({ auth: req.headers['x-auth'], ...rpc });
      const { count, offset } = rpc.params;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: receipts().slice(offset, offset + count) }));
    });
  });
}

describe('Reconciliation (kechki solishtirish)', () => {
  let ctx: TestCtx;
  let admin: Session;
  let matchId: string;
  let server: Server;
  const fake = new FakeUzumAdapter();
  let receipts: Record<string, unknown>[] = [];
  const paymeCalls: Record<string, any>[] = [];

  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const tx = (p: Partial<ProviderTransaction> & { providerTransactionId: string }): ProviderTransaction => ({
    amount: 3500000,
    currency: 'UZS',
    status: 'succeeded',
    occurredAt: new Date(),
    bookingId: null,
    raw: {},
    ...p,
  });
  const period = () => ({ date_from: new Date(Date.now() - 3600_000).toISOString(), date_to: new Date(Date.now() + 3600_000).toISOString() });
  /** Boshqa spec'lar shu bazada yaratgan to'lovlar davrga tushmasin: davr — test boshidagi DB vaqtidan. */
  const dbNow = async () => (await q<{ t: Date }>(ctx, 'SELECT clock_timestamp() AS t'))[0]!.t;
  const since = (start: Date) => ({ date_from: start.toISOString(), date_to: new Date(Date.now() + 60_000).toISOString() });
  let paymePort = 0;

  beforeAll(async () => {
    server = paymeServer(() => receipts, paymeCalls);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    paymePort = (server.address() as AddressInfo).port;
    process.env.PAYME_RECONCILE_ENABLED = 'true';
    process.env.PAYME_API_URL = `http://127.0.0.1:${paymePort}/api`;

    ctx = await createTestApp((b) =>
      b.overrideProvider(RECONCILIATION_ADAPTERS).useFactory({
        inject: [PaymeReconciliationAdapter, ClickReconciliationAdapter],
        factory: (payme: ReconciliationAdapter, click: ReconciliationAdapter) => [payme, click, fake],
      }),
    );
    admin = await login(ctx, '+998901110001');
    const pitch = (await q(ctx, "SELECT p.id FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE v.slug = 'yunusobod-sport' AND p.name = 'Pitch 1'"))[0]!.id;
    const c = await ctx
      .http()
      .post('/v1/admin/matches')
      .set(admin.auth)
      .set('Idempotency-Key', uuid())
      .send({
        pitch_id: pitch,
        sport: 'football',
        starts_at: inHours(24 * 16),
        duration_min: 60,
        format: '5v5',
        players_per_side: 5,
        min_players: 6,
        max_players: 10,
        price: { amount: 3500000, currency: 'UZS' },
        lease_cost: { amount: 10000000, currency: 'UZS' },
      })
      .expect(201);
    matchId = c.body.id;
    await ctx.http().post(`/v1/admin/matches/${matchId}/publish`).set(admin.auth).expect(200);
  });
  afterAll(async () => {
    await ctx.close();
    await new Promise((r) => server.close(r));
    delete process.env.PAYME_RECONCILE_ENABLED;
    delete process.env.PAYME_API_URL;
  });

  it('faqat admin; ro\'yxat API\'si yo\'q provider (Click) — 422, davr xatolari — 422', async () => {
    const player = await login(ctx, '+998902000004');
    await ctx.http().get('/v1/admin/finance/reconciliation').set(player.auth).expect(403);
    await ctx.http().get('/v1/admin/finance/reconciliation').expect(401);
    await ctx.http().post('/v1/admin/finance/reconciliation').set(admin.auth).send({ provider: 'uzum', ...period() }).expect(422); // Idempotency-Key yo'q

    const click = await ctx.http().post('/v1/admin/finance/reconciliation').set(admin.auth).set('Idempotency-Key', uuid()).send({ provider: 'click', ...period() }).expect(422);
    expect(click.body.errors[0]).toMatchObject({ field: 'provider', code: 'unsupported' });
    expect(click.body.errors[0].message).toContain('Click');

    const reversed = { date_from: period().date_to, date_to: period().date_from };
    await ctx.http().post('/v1/admin/finance/reconciliation').set(admin.auth).set('Idempotency-Key', uuid()).send({ provider: 'uzum', ...reversed }).expect(422);
    const long = { date_from: '2026-01-01T00:00:00Z', date_to: '2026-03-01T00:00:00Z' };
    await ctx.http().post('/v1/admin/finance/reconciliation').set(admin.auth).set('Idempotency-Key', uuid()).send({ provider: 'uzum', ...long }).expect(422);
    expect(await q(ctx, 'SELECT id FROM reconciliation_runs')).toEqual([]);
  });

  it("fake provider: summa farqi, holat farqi, bizda bor/providerda yo'q, providerda bor/bizda yo'q -> items + audit + outbox", async () => {
    const start = await dbNow();
    const paid = [];
    for (const phone of ['+998902000004', '+998902000009', '+998902000023', '+998902000024']) {
      paid.push(await bookAndPayWithUzum(ctx, await login(ctx, phone), matchId));
    }
    const [pOk, pAmount, pState, pMissing] = paid;
    const ghost = uuid();
    fake.transactions = [
      tx({ providerTransactionId: pOk!.transId, bookingId: pOk!.bookingId }),
      tx({ providerTransactionId: pAmount!.transId, amount: 3400000 }),
      tx({ providerTransactionId: pState!.transId, status: 'refunded', raw: { state: 'REVERSED' } }),
      tx({ providerTransactionId: ghost, amount: 5000000, bookingId: pOk!.bookingId }),
      // Davrdan tashqarida (padding ichida) — e'tiborga olinmaydi
      tx({ providerTransactionId: uuid(), occurredAt: new Date(Date.now() - 1.5 * 3600_000) }),
      // Provider tomonda pul harakati yo'q — bizda bo'lmasa ham farq emas
      tx({ providerTransactionId: uuid(), status: 'cancelled' }),
    ];

    const res = await ctx.http().post('/v1/admin/finance/reconciliation').set(admin.auth).set('Idempotency-Key', uuid()).send({ provider: 'uzum', ...since(start) }).expect(201);
    expect(res.body.items).toHaveLength(1);
    const run = res.body.items[0];
    expect(run).toMatchObject({
      provider: 'uzum',
      status: 'completed',
      trigger: 'manual',
      triggered_by: { display_name: 'Demo Admin' },
      counts: { local: 4, provider: 5, matched: 3, diffs: 4 },
      diffs_by_kind: { missing_at_provider: 1, missing_locally: 1, amount_mismatch: 1, status_mismatch: 1 },
      error: null,
    });
    // Provider'dan padding bilan kengroq davr so'raladi
    const call = fake.calls.at(-1)!;
    expect(new Date(run.period.from).getTime() - call.from.getTime()).toBe(3600_000);

    const detail = await ctx.http().get(`/v1/admin/finance/reconciliation/${run.id}`).set(admin.auth).expect(200);
    const byKind = Object.fromEntries(detail.body.items.map((i: { kind: string }) => [i.kind, i]));
    const payId = async (transId: string) => (await q(ctx, "SELECT id FROM payments WHERE provider = 'uzum' AND provider_transaction_id = $1", [transId]))[0]!.id;
    expect(byKind.amount_mismatch).toMatchObject({
      payment_id: await payId(pAmount!.transId),
      provider_transaction_id: pAmount!.transId,
      booking_id: pAmount!.bookingId,
      local: { amount: { amount: 3500000, currency: 'UZS' }, status: 'succeeded' },
      provider: { amount: { amount: 3400000, currency: 'UZS' }, status: 'succeeded' },
    });
    expect(byKind.status_mismatch).toMatchObject({
      payment_id: await payId(pState!.transId),
      local: { status: 'succeeded' },
      provider: { status: 'refunded' },
      details: { state: 'REVERSED' },
    });
    expect(byKind.missing_at_provider).toMatchObject({
      payment_id: await payId(pMissing!.transId),
      provider_transaction_id: pMissing!.transId,
      local: { amount: { amount: 3500000 }, status: 'succeeded' },
      provider: { amount: null, status: null },
    });
    expect(byKind.missing_locally).toMatchObject({
      payment_id: null,
      provider_transaction_id: ghost,
      booking_id: pOk!.bookingId,
      local: { amount: null, status: null },
      provider: { amount: { amount: 5000000 }, status: 'succeeded' },
    });

    // Har farq audit_logs (admin nomidan) va outbox'da; run'ning o'zi ham audit'da
    const ids = detail.body.items.map((i: { id: string }) => i.id);
    const audits = await q(ctx, "SELECT entity_id, actor_role, changes->>'kind' AS kind FROM audit_logs WHERE action = 'reconciliation.mismatch' AND entity_id = ANY($1::uuid[])", [ids]);
    expect(audits).toHaveLength(4);
    expect(audits.every((a) => a.actor_role === 'admin')).toBe(true);
    expect(await q(ctx, "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'reconciliation.run' AND entity_id = $1", [run.id])).toEqual([{ n: 1 }]);
    const events = await q(ctx, "SELECT aggregate_type, payload FROM outbox_events WHERE event_type = 'ReconciliationMismatch' AND aggregate_id = ANY($1::uuid[])", [ids]);
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.payload.kind).sort()).toEqual(['amount_mismatch', 'missing_at_provider', 'missing_locally', 'status_mismatch']);
    expect(events.every((e) => e.aggregate_type === 'reconciliation' && e.payload.run_id === run.id && e.payload.provider === 'uzum')).toBe(true);

    // Ro'yxat va filtrlar
    const list = await ctx.http().get('/v1/admin/finance/reconciliation?provider=uzum&has_diffs=true').set(admin.auth).expect(200);
    expect(list.body).toMatchObject({ total: 1, items: [{ id: run.id, counts: { diffs: 4 } }] });
    const none = await ctx.http().get('/v1/admin/finance/reconciliation?has_diffs=false').set(admin.auth).expect(200);
    expect(none.body.total).toBe(0);
    await ctx.http().get(`/v1/admin/finance/reconciliation/${uuid()}`).set(admin.auth).expect(404);
  });

  it("Payme: receipts.get_all sahifalab olinadi (X-Auth), refund qilingan chek — holat farqi; provider xatosi -> run failed", async () => {
    const start = await dbNow();
    const paid = await bookAndPayWithPayme(ctx, await login(ctx, '+998902000028'), matchId);
    const now = Date.now();
    // 55 ta chek: 2-sahifa kerak; bizning to'lov 2-sahifada, Payme'da to'lovdan keyin bekor qilingan (refund)
    receipts = Array.from({ length: 54 }, (_, i) => ({
      _id: `fill${String(i).padStart(20, '0')}`,
      create_time: now,
      pay_time: 0,
      cancel_time: 0,
      state: 0,
      amount: 100,
      currency: 860,
      account: [],
    }));
    receipts.push({
      _id: paid.txId,
      create_time: now,
      pay_time: now,
      cancel_time: now,
      state: 50,
      amount: paid.amount,
      currency: 860,
      account: [{ name: 'booking_id', value: paid.bookingId }],
    });

    const res = await ctx.http().post('/v1/admin/finance/reconciliation').set(admin.auth).set('Idempotency-Key', uuid()).send({ provider: 'payme', ...since(start) }).expect(201);
    const run = res.body.items[0];
    expect(run).toMatchObject({ provider: 'payme', status: 'completed', counts: { provider: 55, matched: 1, diffs: 1 }, diffs_by_kind: { status_mismatch: 1 } });
    expect(paymeCalls.map((c) => [c.method, c.params.offset, c.params.count])).toEqual([
      ['receipts.get_all', 0, 50],
      ['receipts.get_all', 50, 50],
    ]);
    expect(paymeCalls[0]!.auth).toBe('demo-payme:payme_test_key');
    const d = await ctx.http().get(`/v1/admin/finance/reconciliation/${run.id}`).set(admin.auth).expect(200);
    expect(d.body.items[0]).toMatchObject({ kind: 'status_mismatch', local: { status: 'succeeded' }, provider: { status: 'refunded' }, details: { state: 50 } });

    // Provider API ishlamasa — run `failed`, xato matni bilan; farqlar yozilmaydi
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    const failed = await ctx.http().post('/v1/admin/finance/reconciliation').set(admin.auth).set('Idempotency-Key', uuid()).send({ provider: 'payme', ...since(start) }).expect(201);
    expect(failed.body.items[0]).toMatchObject({ provider: 'payme', status: 'failed', counts: { diffs: 0 } });
    expect(failed.body.items[0].error).toBeTruthy();
    server = paymeServer(() => receipts, paymeCalls);
    await new Promise<void>((r) => server.listen(paymePort, '127.0.0.1', r));
  });

  it("bir vaqtda bitta run (provider + davr): ishlayotgani bo'lsa — 409", async () => {
    const p = period();
    await q(ctx, "INSERT INTO reconciliation_runs (provider, period_from, period_to, trigger) VALUES ('uzum', $1, $2, 'schedule')", [p.date_from, p.date_to]);
    const r = await ctx.http().post('/v1/admin/finance/reconciliation').set(admin.auth).set('Idempotency-Key', uuid()).send({ provider: 'uzum', ...p }).expect(409);
    expect(r.body.code).toBe('INVALID_STATE');
    await q(ctx, "UPDATE reconciliation_runs SET status = 'failed', error = 'test' WHERE status = 'running'");
  });

  it('kechki job: oldingi Toshkent kuni, faqat ro\'yxat bera oladigan provider\'lar, actor yo\'q', async () => {
    fake.transactions = [];
    const recon = ctx.app.get(ReconciliationService);
    // 2026-10-21 02:00 Toshkent = 2026-10-20 21:00 UTC -> davr: 2026-10-20 00:00 .. 2026-10-21 00:00 (Toshkent)
    const result = await recon.nightly(new Date('2026-10-20T21:00:00Z'));
    // Click (ro'yxat API'si yo'q) o'tkazib yuboriladi
    expect(result.map((r) => r.provider)).toEqual(['payme', 'uzum']);
    const runs = await q(
      ctx,
      "SELECT provider, triggered_by, period_from, period_to, status FROM reconciliation_runs WHERE trigger = 'schedule' AND error IS DISTINCT FROM 'test' ORDER BY provider",
    );
    expect(runs.map((r) => [r.provider, r.triggered_by, r.status])).toEqual([
      ['payme', null, 'completed'],
      ['uzum', null, 'completed'],
    ]);
    for (const r of runs) {
      expect(new Date(r.period_from).toISOString()).toBe('2026-10-19T19:00:00.000Z');
      expect(new Date(r.period_to).toISOString()).toBe('2026-10-20T19:00:00.000Z');
    }
  });
});
