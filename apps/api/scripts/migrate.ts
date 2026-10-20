/**
 * SQL migratsiya runner: db/migrations/*.sql ni tartib bilan qo'llaydi va
 * schema_migrations jadvalida qayd etadi. `--seed` — dev seed'ni ham yuklaydi.
 *
 *   pnpm db:migrate
 *   pnpm db:seed
 *
 * Docker image'da (`pnpm build` -> dist/scripts/migrate.js) bir martalik buyruq sifatida:
 *   node dist/scripts/migrate.js        (MIGRATIONS_DIR=/app/db/migrations image'da o'rnatilgan)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

const ROOT = resolve(__dirname, '../../..');
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || join(ROOT, 'db/migrations');
const SEED_FILE = process.env.SEED_FILE || join(ROOT, 'db/seed/dev_seed.sql');

export async function runMigrations(databaseUrl: string, opts: { seed?: boolean; log?: boolean } = {}) {
  const log = opts.log === false ? () => undefined : (m: string) => console.log(m);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version),
    );
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      log(`-> ${file}`);
      // Fayllar o'z tranzaksiyalarini boshqaradi. Simple query protokoli bitta so'rovdagi barcha
      // statement'larni bitta tranzaksiyada bajaradi, shuning uchun `-- migrate:split` belgisi
      // faylni alohida commit qilinadigan bo'laklarga ajratadi (masalan, ALTER TYPE ... ADD VALUE).
      for (const chunk of readFileSync(join(MIGRATIONS_DIR, file), 'utf8').split(/^-- migrate:split.*$/m)) {
        if (chunk.trim()) await client.query(chunk);
      }
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    }
    if (opts.seed) {
      const { rows } = await client.query<{ n: string }>('SELECT count(*) AS n FROM currencies');
      if (rows[0]?.n === '0') {
        log('-> dev_seed.sql');
        await client.query(readFileSync(SEED_FILE, 'utf8'));
      } else {
        log('seed: allaqachon yuklangan, o\'tkazib yuborildi');
      }
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL ?? 'postgres://matchup:matchup_dev_only@localhost:5432/matchup';
  runMigrations(url, { seed: process.argv.includes('--seed') })
    .then(() => console.log('migratsiyalar tayyor'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
