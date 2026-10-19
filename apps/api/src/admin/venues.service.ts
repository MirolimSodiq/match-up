import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { type Locale, tr } from '../common/i18n';
import { DB, type Db, type Executor, iso, one, pgError, PG, rows } from '../db/db';
import { type Actor, audit } from './audit';
import { joinList } from './schemas';

type Translations = Partial<Record<'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en', string>>;

export interface VenueInput {
  city_id: number;
  name: string;
  slug?: string;
  address?: Translations;
  description?: Translations;
  location: { lat: number; lng: number };
  timezone?: string;
  partner_name?: string | null;
  partner_phone?: string | null;
  contract_ref?: string | null;
  amenities?: string[];
  is_active?: boolean;
}

export interface PitchInput {
  name: string;
  surface: string;
  is_indoor?: boolean;
  length_m?: number | null;
  width_m?: number | null;
  max_players_per_side?: number | null;
  sports: string[];
  is_active?: boolean;
}

interface VenueRow {
  id: string;
  city_id: number;
  city_name: unknown;
  name: string;
  slug: string;
  address: Translations;
  description: Translations;
  lat: number;
  lng: number;
  timezone: string;
  partner_name: string | null;
  partner_phone: string | null;
  contract_ref: string | null;
  is_active: boolean;
  upcoming_matches: number;
  created_at: string;
  updated_at: string;
  total?: number;
}

interface PitchRow {
  id: string;
  venue_id: string;
  name: string;
  surface: string;
  is_indoor: boolean;
  length_m: string | null;
  width_m: string | null;
  max_players_per_side: number | null;
  is_active: boolean;
  sports: string[];
  upcoming_matches: number;
}

const point = (p: { lat: number; lng: number }) => sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;
const fieldError = (field: string, message: string, code = 'invalid') => new AppError('VALIDATION_FAILED', {}, [{ field, code, message }]);

/** "Chilonzor Arena #2" -> "chilonzor-arena-2" */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ'ʻʼ‘’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'venue';
}

const UPCOMING = sql`m.status IN ('draft', 'open', 'full') AND m.starts_at > now()`;

const VENUE_COLUMNS = sql`
  v.id, v.city_id, c.name AS city_name, v.name, v.slug, v.address, v.description,
  ST_Y(v.location::geometry) AS lat, ST_X(v.location::geometry) AS lng, v.timezone,
  v.partner_name, v.partner_phone, v.contract_ref, v.is_active, v.created_at, v.updated_at,
  (SELECT count(*)::int FROM matches m JOIN pitches p ON p.id = m.pitch_id WHERE p.venue_id = v.id AND ${UPCOMING}) AS upcoming_matches`;

@Injectable()
export class AdminVenuesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Reference: forma va filtrlar uchun
  // -------------------------------------------------------------------------
  async reference(locale: Locale) {
    const [cities, sports, amenities, policies] = await Promise.all([
      rows<{ id: number; slug: string; name: unknown; timezone: string; currency: string; lat: number; lng: number; is_active: boolean }>(
        this.db,
        sql`SELECT id, slug, name, timezone, default_currency AS currency, is_active,
                   ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng
            FROM cities ORDER BY is_active DESC, id`,
      ),
      rows<{ code: string; name: unknown; default_players_per_side: number }>(
        this.db,
        sql`SELECT code, name, default_players_per_side FROM sports WHERE is_active ORDER BY id`,
      ),
      rows<{ code: string; name: unknown; icon: string | null }>(this.db, sql`SELECT code, name, icon FROM amenities ORDER BY id`),
      rows<{ code: string; name: unknown; is_default: boolean }>(
        this.db,
        sql`SELECT code, name, is_default FROM cancellation_policies ORDER BY is_default DESC, id`,
      ),
    ]);
    return {
      cities: cities.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: tr(c.name, locale),
        timezone: c.timezone,
        currency: c.currency,
        center: { lat: c.lat, lng: c.lng },
        is_active: c.is_active,
      })),
      sports: sports.map((s) => ({ code: s.code, name: tr(s.name, locale), default_players_per_side: s.default_players_per_side })),
      amenities: amenities.map((a) => ({ code: a.code, name: tr(a.name, locale), icon: a.icon })),
      surfaces: ['artificial_turf', 'natural_grass', 'indoor_hard', 'indoor_parquet', 'sand', 'asphalt'],
      cancellation_policies: policies.map((p) => ({ code: p.code, name: tr(p.name, locale), is_default: p.is_default })),
    };
  }

  // -------------------------------------------------------------------------
  // Venue'lar
  // -------------------------------------------------------------------------
  async list(f: { city_id?: number; q?: string; is_active?: boolean; limit: number; offset: number }, locale: Locale) {
    const conds: SQL[] = [sql`true`];
    if (f.city_id !== undefined) conds.push(sql`v.city_id = ${f.city_id}`);
    if (f.is_active !== undefined) conds.push(sql`v.is_active = ${f.is_active}`);
    if (f.q) conds.push(sql`(v.name ILIKE ${'%' + f.q + '%'} OR v.slug ILIKE ${'%' + f.q + '%'})`);
    const list = await rows<VenueRow>(
      this.db,
      sql`SELECT ${VENUE_COLUMNS}, count(*) OVER ()::int AS total
          FROM venues v JOIN cities c ON c.id = v.city_id
          WHERE ${sql.join(conds, sql` AND `)}
          ORDER BY v.is_active DESC, v.name, v.id
          LIMIT ${f.limit} OFFSET ${f.offset}`,
    );
    const items = await this.present(list, locale);
    return { items, total: list[0]?.total ?? (f.offset ? await this.count(conds) : 0) };
  }

  private async count(conds: SQL[]) {
    const r = await one<{ n: number }>(
      this.db,
      sql`SELECT count(*)::int AS n FROM venues v WHERE ${sql.join(conds, sql` AND `)}`,
    );
    return r?.n ?? 0;
  }

  async get(id: string, locale: Locale) {
    const v = await one<VenueRow>(this.db, sql`SELECT ${VENUE_COLUMNS} FROM venues v JOIN cities c ON c.id = v.city_id WHERE v.id = ${id}`);
    if (!v) throw new AppError('NOT_FOUND');
    return (await this.present([v], locale))[0]!;
  }

  private async present(list: VenueRow[], locale: Locale) {
    if (!list.length) return [];
    const ids = joinList(list.map((v) => v.id));
    const [pitches, amenities] = await Promise.all([
      this.pitchRows(sql`p.venue_id = ANY(string_to_array(${ids}, ',')::uuid[])`),
      rows<{ venue_id: string; code: string; name: unknown }>(
        this.db,
        sql`SELECT va.venue_id, a.code, a.name FROM venue_amenities va JOIN amenities a ON a.id = va.amenity_id
            WHERE va.venue_id = ANY(string_to_array(${ids}, ',')::uuid[]) ORDER BY a.id`,
      ),
    ]);
    return list.map((v) => ({
      id: v.id,
      name: v.name,
      slug: v.slug,
      city: { id: v.city_id, name: tr(v.city_name, locale) },
      address: v.address,
      address_text: tr(v.address, locale),
      description: v.description,
      location: { lat: v.lat, lng: v.lng },
      timezone: v.timezone,
      partner_name: v.partner_name,
      partner_phone: v.partner_phone,
      contract_ref: v.contract_ref,
      is_active: v.is_active,
      amenities: amenities.filter((a) => a.venue_id === v.id).map((a) => ({ code: a.code, name: tr(a.name, locale) })),
      pitches: pitches.filter((p) => p.venue_id === v.id).map(presentPitch),
      upcoming_matches: v.upcoming_matches,
      created_at: iso(v.created_at),
      updated_at: iso(v.updated_at),
    }));
  }

  private pitchRows(where: SQL, ex: Executor = this.db) {
    return rows<PitchRow>(
      ex,
      sql`SELECT p.id, p.venue_id, p.name, p.surface, p.is_indoor, p.length_m, p.width_m, p.max_players_per_side, p.is_active,
                 coalesce((SELECT array_agg(s.code ORDER BY s.id) FROM pitch_sports ps JOIN sports s ON s.id = ps.sport_id
                           WHERE ps.pitch_id = p.id), '{}') AS sports,
                 (SELECT count(*)::int FROM matches m WHERE m.pitch_id = p.id AND ${UPCOMING}) AS upcoming_matches
          FROM pitches p WHERE ${where}
          ORDER BY p.is_active DESC, p.name`,
    );
  }

  private async cityTimezone(cityId: number, ex: Executor): Promise<string> {
    const c = await one<{ timezone: string }>(ex, sql`SELECT timezone FROM cities WHERE id = ${cityId}`);
    if (!c) throw fieldError('city_id', 'Shahar topilmadi');
    return c.timezone;
  }

  private async amenityIds(codes: string[], ex: Executor): Promise<number[]> {
    if (!codes.length) return [];
    const found = await rows<{ id: number; code: string }>(
      ex,
      sql`SELECT id, code FROM amenities WHERE code = ANY(string_to_array(${joinList(codes)}, ','))`,
    );
    const missing = codes.filter((c) => !found.some((a) => a.code === c));
    if (missing.length) throw fieldError('amenities', `Noma'lum qulayliklar: ${missing.join(', ')}`);
    return found.map((a) => a.id);
  }

  private async uniqueSlug(base: string, ex: Executor): Promise<string> {
    const taken = new Set(
      (await rows<{ slug: string }>(ex, sql`SELECT slug FROM venues WHERE slug = ${base} OR slug LIKE ${base + '-%'}`)).map((r) => r.slug),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  private async setAmenities(ex: Executor, venueId: string, ids: number[]) {
    await ex.execute(sql`DELETE FROM venue_amenities WHERE venue_id = ${venueId}`);
    if (ids.length) {
      await ex.execute(
        sql`INSERT INTO venue_amenities (venue_id, amenity_id)
            SELECT ${venueId}, unnest(string_to_array(${joinList(ids)}, ',')::smallint[])`,
      );
    }
  }

  async create(actor: Actor, input: VenueInput, locale: Locale) {
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const cityTz = await this.cityTimezone(input.city_id, tx);
        const tz = input.timezone ?? cityTz;
        const amenities = await this.amenityIds(input.amenities ?? [], tx);
        const slug = input.slug ?? (await this.uniqueSlug(slugify(input.name), tx));
        const v = await one<{ id: string }>(
          tx,
          sql`INSERT INTO venues (city_id, name, slug, address, description, location, timezone,
                                  partner_name, partner_phone, contract_ref, is_active)
              VALUES (${input.city_id}, ${input.name}, ${slug}, ${JSON.stringify(input.address ?? {})}::jsonb,
                      ${JSON.stringify(input.description ?? {})}::jsonb, ${point(input.location)}, ${tz},
                      ${input.partner_name ?? null}, ${input.partner_phone ?? null}, ${input.contract_ref ?? null},
                      ${input.is_active ?? true})
              RETURNING id`,
        );
        await this.setAmenities(tx, v!.id, amenities);
        await audit(tx, actor, 'venue.create', 'venue', v!.id, { ...input, slug });
        return v!.id;
      });
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) throw new AppError('ALREADY_EXISTS', {}, [{ field: 'slug', code: 'taken', message: 'slug band' }]);
      throw err;
    }
    return this.get(id, locale);
  }

  async update(actor: Actor, id: string, input: Partial<VenueInput>, locale: Locale) {
    try {
      await this.db.transaction(async (tx) => {
        const cur = await one<{ id: string; city_id: number }>(tx, sql`SELECT id, city_id FROM venues WHERE id = ${id} FOR UPDATE`);
        if (!cur) throw new AppError('NOT_FOUND');
        const sets: SQL[] = [];
        if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
        if (input.slug !== undefined) sets.push(sql`slug = ${input.slug}`);
        if (input.address !== undefined) sets.push(sql`address = ${JSON.stringify(input.address)}::jsonb`);
        if (input.description !== undefined) sets.push(sql`description = ${JSON.stringify(input.description)}::jsonb`);
        if (input.location !== undefined) sets.push(sql`location = ${point(input.location)}`);
        if (input.partner_name !== undefined) sets.push(sql`partner_name = ${input.partner_name}`);
        if (input.partner_phone !== undefined) sets.push(sql`partner_phone = ${input.partner_phone}`);
        if (input.contract_ref !== undefined) sets.push(sql`contract_ref = ${input.contract_ref}`);
        if (input.is_active !== undefined) sets.push(sql`is_active = ${input.is_active}`);
        if (input.city_id !== undefined && input.city_id !== cur.city_id) {
          const tz = await this.cityTimezone(input.city_id, tx);
          sets.push(sql`city_id = ${input.city_id}`);
          if (input.timezone === undefined) sets.push(sql`timezone = ${tz}`);
        }
        if (input.timezone !== undefined) sets.push(sql`timezone = ${input.timezone}`);
        if (sets.length) await tx.execute(sql`UPDATE venues SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
        if (input.amenities !== undefined) await this.setAmenities(tx, id, await this.amenityIds(input.amenities, tx));

        // matches.location / city_id — venue'dan denormalizatsiya: hali o'tmagan match'lar ham yangilanadi
        if (input.location !== undefined || input.city_id !== undefined) {
          await tx.execute(
            sql`UPDATE matches m SET location = v.location, city_id = v.city_id
                FROM pitches p JOIN venues v ON v.id = p.venue_id
                WHERE p.id = m.pitch_id AND v.id = ${id} AND ${UPCOMING}`,
          );
        }
        await audit(tx, actor, 'venue.update', 'venue', id, input);
      });
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) throw new AppError('ALREADY_EXISTS', {}, [{ field: 'slug', code: 'taken', message: 'slug band' }]);
      throw err;
    }
    return this.get(id, locale);
  }

  // -------------------------------------------------------------------------
  // Pitch'lar
  // -------------------------------------------------------------------------
  private async sportIds(codes: string[], ex: Executor): Promise<number[]> {
    const found = await rows<{ id: number; code: string }>(
      ex,
      sql`SELECT id, code FROM sports WHERE code = ANY(string_to_array(${joinList(codes)}, ','))`,
    );
    const missing = codes.filter((c) => !found.some((s) => s.code === c));
    if (missing.length) throw fieldError('sports', `Noma'lum sport turlari: ${missing.join(', ')}`);
    return found.map((s) => s.id);
  }

  private async setSports(ex: Executor, pitchId: string, ids: number[]) {
    await ex.execute(sql`DELETE FROM pitch_sports WHERE pitch_id = ${pitchId}`);
    await ex.execute(
      sql`INSERT INTO pitch_sports (pitch_id, sport_id)
          SELECT ${pitchId}, unnest(string_to_array(${joinList(ids)}, ',')::smallint[])`,
    );
  }

  async getPitch(id: string) {
    const p = (await this.pitchRows(sql`p.id = ${id}`))[0];
    if (!p) throw new AppError('NOT_FOUND');
    return presentPitch(p);
  }

  async createPitch(actor: Actor, venueId: string, input: PitchInput) {
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const v = await one(tx, sql`SELECT 1 FROM venues WHERE id = ${venueId}`);
        if (!v) throw new AppError('NOT_FOUND');
        const sports = await this.sportIds(input.sports, tx);
        const p = await one<{ id: string }>(
          tx,
          sql`INSERT INTO pitches (venue_id, name, surface, is_indoor, length_m, width_m, max_players_per_side, is_active)
              VALUES (${venueId}, ${input.name}, ${input.surface}::surface_type, ${input.is_indoor ?? false},
                      ${input.length_m ?? null}, ${input.width_m ?? null}, ${input.max_players_per_side ?? null},
                      ${input.is_active ?? true})
              RETURNING id`,
        );
        await this.setSports(tx, p!.id, sports);
        await audit(tx, actor, 'pitch.create', 'pitch', p!.id, { venue_id: venueId, ...input });
        return p!.id;
      });
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) throw new AppError('ALREADY_EXISTS', {}, [{ field: 'name', code: 'taken', message: 'Bu nomli maydon allaqachon bor' }]);
      throw err;
    }
    return this.getPitch(id);
  }

  async updatePitch(actor: Actor, id: string, input: Partial<PitchInput>) {
    try {
      await this.db.transaction(async (tx) => {
        const cur = await one(tx, sql`SELECT 1 FROM pitches WHERE id = ${id} FOR UPDATE`);
        if (!cur) throw new AppError('NOT_FOUND');
        const sets: SQL[] = [];
        if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
        if (input.surface !== undefined) sets.push(sql`surface = ${input.surface}::surface_type`);
        if (input.is_indoor !== undefined) sets.push(sql`is_indoor = ${input.is_indoor}`);
        if (input.length_m !== undefined) sets.push(sql`length_m = ${input.length_m}`);
        if (input.width_m !== undefined) sets.push(sql`width_m = ${input.width_m}`);
        if (input.max_players_per_side !== undefined) sets.push(sql`max_players_per_side = ${input.max_players_per_side}`);
        if (input.is_active !== undefined) sets.push(sql`is_active = ${input.is_active}`);
        if (sets.length) await tx.execute(sql`UPDATE pitches SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
        if (input.sports !== undefined) await this.setSports(tx, id, await this.sportIds(input.sports, tx));
        await audit(tx, actor, 'pitch.update', 'pitch', id, input);
      });
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) throw new AppError('ALREADY_EXISTS', {}, [{ field: 'name', code: 'taken', message: 'Bu nomli maydon allaqachon bor' }]);
      throw err;
    }
    return this.getPitch(id);
  }
}

function presentPitch(p: PitchRow) {
  return {
    id: p.id,
    venue_id: p.venue_id,
    name: p.name,
    surface: p.surface,
    is_indoor: p.is_indoor,
    length_m: p.length_m === null ? null : Number(p.length_m),
    width_m: p.width_m === null ? null : Number(p.width_m),
    max_players_per_side: p.max_players_per_side,
    sports: p.sports,
    is_active: p.is_active,
    upcoming_matches: p.upcoming_matches,
  };
}
