import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as relations from './relations';
import * as schema from './schema';

export const fullSchema = { ...schema, ...relations };
export type Db = NodePgDatabase<typeof fullSchema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Query bajaruvchi: oddiy ulanish yoki tranzaksiya. */
export type Executor = Db | Tx;

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

/**
 * Raw SQL (CTE, PostGIS, FOR UPDATE) — natija qatorlari.
 * Eslatma: drizzle node-postgres drayveri timestamptz/date'ni xom qator (string) sifatida qaytaradi —
 * javobga chiqarishda `iso()` dan foydalaning, vaqt solishtirishni SQL'da (now()) qiling.
 */
export async function rows<T>(ex: Executor, query: SQL): Promise<T[]> {
  const res = await ex.execute(query);
  return res.rows as T[];
}

export async function one<T>(ex: Executor, query: SQL): Promise<T | undefined> {
  return (await rows<T>(ex, query))[0];
}

export interface PgErrorInfo {
  code: string;
  constraint?: string;
}

/** drizzle xatoni DrizzleQueryError ichiga o'raydi — asl pg xatosini topadi. */
export function pgError(err: unknown): PgErrorInfo | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur; i++) {
    const e = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return { code: e.code, constraint: typeof e.constraint === 'string' ? e.constraint : undefined };
    }
    cur = e.cause;
  }
  return undefined;
}

export const PG = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  FOREIGN_KEY_VIOLATION: '23503',
} as const;

/** Postgres timestamptz qatori -> ISO 8601 (UTC). */
export function iso(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  // '2026-10-18 09:00:00.123+00' -> '2026-10-18T09:00:00.123+00:00'
  return new Date(v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString();
}
