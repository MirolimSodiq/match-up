import { Controller, Delete, Get, HttpCode, Module, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, OptionalAuth, Public, ReqLocale, ZQuery, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { MatchesService } from './matches.service';

const csv = z
  .string()
  .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^[a-z_]+$/)).max(10));

const SearchQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_km: z.coerce.number().min(1).max(50).default(10),
  sport: csv.optional(),
  date_from: z.iso.datetime({ offset: true }).optional(),
  date_to: z.iso.datetime({ offset: true }).optional(),
  min_slots: z.coerce.number().int().min(1).max(4).default(1),
  price_max: z.coerce.number().int().min(0).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'pro']).optional(),
  sort: z.enum(['starts_at', 'distance']).default('starts_at'),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@Controller('v1/matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Public()
  @Get()
  search(@ZQuery(SearchQuery) q: z.infer<typeof SearchQuery>, @ReqLocale() locale: Locale) {
    return this.matches.search(q, locale);
  }

  @OptionalAuth()
  @Get(':matchId')
  detail(@Param('matchId') id: string, @ReqLocale() locale: Locale, @CurrentUser() user?: AuthUser) {
    return this.matches.detail(id, locale, user?.id);
  }

  @Post(':matchId/waitlist')
  @HttpCode(201)
  join(@Param('matchId') id: string, @CurrentUser() user: AuthUser) {
    return this.matches.joinWaitlist(id, user.id);
  }

  @Delete(':matchId/waitlist')
  @HttpCode(204)
  async leave(@Param('matchId') id: string, @CurrentUser() user: AuthUser) {
    await this.matches.leaveWaitlist(id, user.id);
  }
}

@Module({ controllers: [MatchesController], providers: [MatchesService], exports: [MatchesService] })
export class MatchesModule {}
