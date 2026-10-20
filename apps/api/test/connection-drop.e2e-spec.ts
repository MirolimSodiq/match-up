import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { Client } from 'pg';
import { REDIS } from '../src/redis/redis.module';
import { createTestApp, db, type TestCtx } from './helpers';

/** Postgres/Redis ulanishi tashqaridan uzilsa (DB restart, pg_terminate_backend, tarmoq) API yiqilmaydi. */
describe('Ulanish uzilishiga chidamlilik', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  /** API pool'idan alohida ulanish: o'zini uzib qo'ymaydi va pool holatiga ta'sir qilmaydi. */
  async function terminateApiBackends(): Promise<number> {
    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    try {
      const r = await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid() AND application_name = 'matchup-api'`,
      );
      return r.rowCount ?? 0;
    } finally {
      await admin.end();
    }
  }

  async function waitFor(cond: () => boolean, ms = 5000) {
    const until = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > until) throw new Error('Kutilgan holat yuz bermadi');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it("idle ulanishlar uzilsa jarayon yiqilmaydi, /health keyingi so'rovda tiklanadi", async () => {
    const pool = db(ctx);
    // Pool'da bir nechta idle ulanish bo'lsin
    await Promise.all([1, 2, 3].map(() => pool.query('SELECT pg_sleep(0.05)')));
    await ctx.http().get('/health').expect(200);
    const before = pool.totalCount;
    expect(before).toBeGreaterThanOrEqual(3);
    expect(pool.idleCount).toBe(before);

    const warn = jest.spyOn(Logger.prototype, 'warn');
    expect(await terminateApiBackends()).toBe(before);
    // pg-pool uzilgan idle client'larni o'zi chiqarib tashlaydi ('error' event)
    await waitFor(() => pool.totalCount === 0);
    // Faqat xato kodi va matni log qilinadi (client/ulanish parametrlari emas)
    expect(warn).toHaveBeenCalledTimes(before);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^Idle ulanish uzildi: 57P01 \S/));
    warn.mockRestore();

    await ctx.http().get('/health').expect(200, { status: 'ok' });
  });

  it("band (checkout qilingan) client uzilsa ham jarayon yiqilmaydi", async () => {
    const pool = db(ctx);
    const client = await pool.connect();
    const ended = new Promise((r) => client.once('end', r));
    expect(await terminateApiBackends()).toBeGreaterThanOrEqual(1);
    await ended;
    await expect(client.query('SELECT 1')).rejects.toThrow();
    client.release();
    // Uzilgan client pool'ga qaytmaydi
    await waitFor(() => pool.totalCount === 0);

    await ctx.http().get('/health').expect(200, { status: 'ok' });
  });

  it("Redis client'da error listener bor (ioredis 'Unhandled error event' chiqarmaydi)", () => {
    expect(ctx.app.get<Redis>(REDIS).listenerCount('error')).toBeGreaterThan(0);
  });
});
