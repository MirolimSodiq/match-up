import { z } from 'zod';

/** Admin endpointlari uchun umumiy zod bo'laklari. */
export const Money = z.object({ amount: z.number().int().min(0), currency: z.string().regex(/^[A-Z]{3}$/) });
export const Level = z.enum(['beginner', 'intermediate', 'advanced', 'pro']);
export const GeoPoint = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export const Translations = z.partialRecord(z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en']), z.string().max(500));
export const Surface = z.enum(['artificial_turf', 'natural_grass', 'indoor_hard', 'indoor_parquet', 'sand', 'asphalt']);
export const Code = z.string().regex(/^[a-z_]+$/);
export const DateTime = z.iso.datetime({ offset: true });

/** `a,b,c` query qatori -> massiv (har element `item` bilan tekshiriladi). */
export const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(item).max(20));

/** Admin jadvallari: offset pagination + umumiy son (TanStack Table uchun). */
export const Page = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

export const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Drizzle JS massivni ($1, $2) ro'yxatga yoyadi — massivlar bitta qator sifatida uzatiladi. */
export const joinList = (values: readonly (string | number)[]) => values.join(',');
