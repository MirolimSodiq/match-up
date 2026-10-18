import { customType } from 'drizzle-orm/pg-core';

/**
 * drizzle-kit pull tanimaydigan Postgres tiplari.
 * geography — EWKB hex sifatida qaytadi; o'qish/yozish SQL'da ST_* funksiyalari bilan qilinadi.
 */
export const geography = customType<{ data: string; driverData: string }>({ dataType: () => 'geography' });
export const citext = customType<{ data: string; driverData: string }>({ dataType: () => 'citext' });
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
export const tstzrange = customType<{ data: string; driverData: string }>({ dataType: () => 'tstzrange' });
