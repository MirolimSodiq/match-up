import { Controller, Get, Inject, Module, Param, ParseUUIDPipe } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { Public, ReqLocale } from '../common/http';
import { type Locale, tr } from '../common/i18n';
import { DB, type Db, one, rows } from '../db/db';

@Controller('v1')
export class CatalogController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Public()
  @Get('sports')
  async sports(@ReqLocale() locale: Locale) {
    const r = await rows<{ code: string; name: unknown; default_players_per_side: number }>(
      this.db,
      sql`SELECT code, name, default_players_per_side FROM sports WHERE is_active ORDER BY id`,
    );
    return r.map((s) => ({ code: s.code, name: tr(s.name, locale), default_players_per_side: s.default_players_per_side }));
  }

  @Public()
  @Get('cities')
  async cities(@ReqLocale() locale: Locale) {
    const r = await rows<{ id: number; slug: string; name: unknown; timezone: string; currency: string; lat: number; lng: number }>(
      this.db,
      sql`SELECT id, slug, name, timezone, default_currency AS currency,
                 ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng
          FROM cities WHERE is_active ORDER BY id`,
    );
    return r.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: tr(c.name, locale),
      timezone: c.timezone,
      currency: c.currency,
      center: { lat: c.lat, lng: c.lng },
    }));
  }

  @Public()
  @Get('venues/:venueId')
  async venue(@Param('venueId', ParseUUIDPipe) id: string, @ReqLocale() locale: Locale) {
    const v = await one<{
      id: string;
      name: string;
      address: unknown;
      description: unknown;
      timezone: string;
      lat: number;
      lng: number;
    }>(
      this.db,
      sql`SELECT id, name, address, description, timezone, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
          FROM venues WHERE id = ${id} AND is_active`,
    );
    if (!v) throw new AppError('NOT_FOUND');
    const amenities = await rows<{ code: string; name: unknown }>(
      this.db,
      sql`SELECT a.code, a.name FROM venue_amenities va JOIN amenities a ON a.id = va.amenity_id
          WHERE va.venue_id = ${id} ORDER BY a.id`,
    );
    const pitches = await rows<{ id: string; name: string; surface: string; is_indoor: boolean }>(
      this.db,
      sql`SELECT id, name, surface, is_indoor FROM pitches WHERE venue_id = ${id} AND is_active ORDER BY name`,
    );
    return {
      id: v.id,
      name: v.name,
      address: tr(v.address, locale),
      location: { lat: v.lat, lng: v.lng },
      description: tr(v.description, locale),
      timezone: v.timezone,
      cover_url: null,
      amenities: amenities.map((a) => ({ code: a.code, name: tr(a.name, locale) })),
      pitches,
    };
  }
}

@Module({ controllers: [CatalogController] })
export class CatalogModule {}
