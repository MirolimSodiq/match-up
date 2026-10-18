import Redis from 'ioredis';
import { Client } from 'pg';
import { runMigrations } from '../scripts/migrate';

/** Har ishga tushishda toza baza: DROP/CREATE -> migratsiyalar -> dev seed. */
export default async function globalSetup() {
  require('./env');
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  await runMigrations(process.env.DATABASE_URL!, { seed: true, log: false });

  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();
}
