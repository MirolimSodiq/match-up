import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
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
      useFactory: (env: Env) =>
        new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX, application_name: 'matchup-api' }),
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
