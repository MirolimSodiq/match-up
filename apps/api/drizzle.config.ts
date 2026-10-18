import { defineConfig } from 'drizzle-kit';

// SQL migratsiyalar (db/migrations) — yagona haqiqat manbai.
// Bu config faqat mavjud bazadan TS sxemani generatsiya qilish uchun: `pnpm db:pull`.
export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://matchup:matchup_dev_only@localhost:5432/matchup' },
  schemaFilter: ['public'],
  tablesFilter: ['!schema_migrations'],
  extensionsFilters: ['postgis'],
});
