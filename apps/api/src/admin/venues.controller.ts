import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ReqLocale, Roles, ZBody, ZQuery } from '../common/http';
import type { Locale } from '../common/i18n';
import { type Actor, CurrentActor } from './audit';
import { bool, Code, GeoPoint, Page, Surface, Translations } from './schemas';
import { AdminVenuesService } from './venues.service';

const Timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'IANA timezone kerak, masalan Asia/Tashkent');

const VenueFields = z.object({
  city_id: z.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80).optional(),
  address: Translations.optional(),
  description: Translations.optional(),
  location: GeoPoint,
  timezone: Timezone.optional(),
  partner_name: z.string().trim().max(200).nullable().optional(),
  partner_phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'E.164 formatida').nullable().optional(),
  contract_ref: z.string().trim().max(100).nullable().optional(),
  amenities: z.array(Code).max(30).optional(),
  is_active: z.boolean().optional(),
});
const VenueUpdate = VenueFields.partial().refine((v) => Object.keys(v).length > 0, 'Kamida bitta maydon kerak');

const PitchFields = z.object({
  name: z.string().trim().min(1).max(60),
  surface: Surface,
  is_indoor: z.boolean().optional(),
  length_m: z.number().positive().max(999).nullable().optional(),
  width_m: z.number().positive().max(999).nullable().optional(),
  max_players_per_side: z.number().int().min(1).max(15).nullable().optional(),
  sports: z.array(Code).min(1).max(10),
  is_active: z.boolean().optional(),
});
const PitchUpdate = PitchFields.partial().refine((v) => Object.keys(v).length > 0, 'Kamida bitta maydon kerak');

const VenueList = z.object({
  city_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
  is_active: bool.optional(),
  ...Page,
});

@Roles('admin')
@Controller('v1/admin')
export class AdminVenuesController {
  constructor(private readonly venues: AdminVenuesService) {}

  @Get('reference')
  reference(@ReqLocale() locale: Locale) {
    return this.venues.reference(locale);
  }

  @Get('venues')
  list(@ZQuery(VenueList) q: z.infer<typeof VenueList>, @ReqLocale() locale: Locale) {
    return this.venues.list(q, locale);
  }

  @Post('venues')
  @HttpCode(201)
  create(@ZBody(VenueFields) body: z.infer<typeof VenueFields>, @CurrentActor() actor: Actor, @ReqLocale() locale: Locale) {
    return this.venues.create(actor, body, locale);
  }

  @Get('venues/:venueId')
  get(@Param('venueId', ParseUUIDPipe) id: string, @ReqLocale() locale: Locale) {
    return this.venues.get(id, locale);
  }

  @Patch('venues/:venueId')
  update(
    @Param('venueId', ParseUUIDPipe) id: string,
    @ZBody(VenueUpdate) body: z.infer<typeof VenueUpdate>,
    @CurrentActor() actor: Actor,
    @ReqLocale() locale: Locale,
  ) {
    return this.venues.update(actor, id, body, locale);
  }

  @Post('venues/:venueId/pitches')
  @HttpCode(201)
  createPitch(@Param('venueId', ParseUUIDPipe) venueId: string, @ZBody(PitchFields) body: z.infer<typeof PitchFields>, @CurrentActor() actor: Actor) {
    return this.venues.createPitch(actor, venueId, body);
  }

  @Patch('pitches/:pitchId')
  updatePitch(@Param('pitchId', ParseUUIDPipe) id: string, @ZBody(PitchUpdate) body: z.infer<typeof PitchUpdate>, @CurrentActor() actor: Actor) {
    return this.venues.updatePitch(actor, id, body);
  }
}
