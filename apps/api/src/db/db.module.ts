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

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) => {
        const pool = new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX, application_name: 'matchup-api' });
        // Ulanish uzilsa (DB restart, pg_terminate_backend) listener'siz pg 'error' event'i butun process'ni
        // yiqitadi. Bo'sh client'ni pool o'zi tashlaydi; band client'da (tranzaksiya so'rovlari orasida)
        // keyingi so'rov xato bilan tugaydi va oddiy xato sifatida qayta ishlanadi.
        const log = new Logger('Db');
        pool.on('error', (err) => log.warn(`idle client uzildi: ${err.message}`));
        pool.on('connect', (client) => client.on('error', (err) => log.warn(`client uzildi: ${err.message}`)));
        return pool;
      },
    },
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
