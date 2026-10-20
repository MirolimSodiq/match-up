import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, types } from 'pg';
import { ENV, type Env } from '../config/env';
import { DB, PG_POOL, fullSchema } from './db';

// int8 (bigint) -> number: summalar tiyin'da, Number.MAX_SAFE_INTEGER (9e15) dan ancha kichik.
types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`int8 qiymat xavfsiz chegaradan tashqarida: ${v}`);
  return n;
});
// date -> 'YYYY-MM-DD' qatori (timezone siljishisiz)
types.setTypeParser(1082, (v) => v);

const log = new Logger('Postgres');

function createPool(env: Env): Pool {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX, application_name: 'matchup-api' });
  // Idle ulanish tashqaridan uzilsa (DB restart, pg_terminate_backend, tarmoq) pg-pool uni o'zi chiqarib tashlaydi
  // va 'error' chiqaradi — listener bo'lmasa Node jarayoni yiqiladi. Keyingi so'rov yangi ulanish ochadi.
  // err'ni butunligicha log qilmaymiz: pg-pool unga client'ni (ulanish parametrlari bilan) biriktiradi.
  pool.on('error', (err: Error & { code?: string }) =>
    log.warn(`Idle ulanish uzildi: ${[err.code, err.message].filter(Boolean).join(' ')}`),
  );
  // Band client (masalan tranzaksiya ichida) ham 'error' chiqaradi: xato so'rov orqali chaqiruvchiga yetadi,
  // release'da pool uni yo'q qiladi — bu listener faqat jarayon yiqilishining oldini oladi.
  pool.on('connect', (client) => client.on('error', () => undefined));
  return pool;
}

@Global()
@Module({
  providers: [
    { provide: PG_POOL, inject: [ENV], useFactory: createPool },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool) => drizzle(pool, { schema: fullSchema }) },
  ],
  exports: [PG_POOL, DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
