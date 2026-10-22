import { Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, IdempotencyKey, ReqLocale, Roles, ZBody, ZQuery, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { CommerceModule } from '../commerce/commerce.module';
import { MatchesModule } from '../matches/matches.controller';
import { MediaModule } from '../media/media.module';
import { AdminService } from './admin.service';
import { AdminFinanceController } from './finance.controller';
import { AdminFinanceService } from './finance.service';
import { AdminHighlightsController } from './highlights.controller';
import { AdminHighlightsService } from './highlights.service';
import { AdminHostsController } from './hosts.controller';
import { AdminHostsService } from './hosts.service';
import { AdminMatchesQuery } from './matches.query';
import { Code, csv, DateTime, Level, Money, Page } from './schemas';
import { AdminVenuesController } from './venues.controller';
import { AdminVenuesService } from './venues.service';

const CreateMatch = z.object({
  pitch_id: z.uuid(),
  sport: z.string().regex(/^[a-z_]+$/),
  starts_at: z.iso.datetime({ offset: true }),
  duration_min: z.number().int().min(30).max(240),
  format: z.string().regex(/^\d{1,2}v\d{1,2}$/),
  players_per_side: z.number().int().min(1).max(15),
  min_players: z.number().int().min(2).max(40),
  max_players: z.number().int().min(2).max(40),
  price: Money,
  lease_cost: Money,
  host_fee: Money.optional(),
  level: z.object({ min: Level.nullable().optional(), max: Level.nullable().optional() }).optional(),
  gender_policy: z.enum(['any', 'male', 'female', 'mixed']).default('any'),
  visibility: z.enum(['public', 'unlisted', 'private']).default('public'),
  title: z.partialRecord(z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en']), z.string().max(120)).optional(),
  cancellation_policy_code: z.string().default('standard'),
});

const CancelMatch = z.object({
  reason: z.enum(['min_players_not_reached', 'weather', 'venue_issue', 'no_host', 'other']),
  refund_destination: z.enum(['original_method', 'wallet']).default('original_method'),
  wallet_bonus_pct: z.number().int().min(0).max(100).default(0),
});

const MatchList = z.object({
  status: csv(z.enum(['draft', 'open', 'full', 'in_progress', 'completed', 'cancelled'])).optional(),
  date_from: DateTime.optional(),
  date_to: DateTime.optional(),
  city_id: z.coerce.number().int().positive().optional(),
  venue_id: z.uuid().optional(),
  pitch_id: z.uuid().optional(),
  sport: csv(Code).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['starts_at', '-starts_at']).default('starts_at'),
  ...Page,
});

@Roles('admin')
@Controller('v1/admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly query: AdminMatchesQuery,
  ) {}

  @Get('matches')
  list(@ZQuery(MatchList) q: z.infer<typeof MatchList>, @ReqLocale() locale: Locale) {
    return this.query.list(q, locale);
  }

  /** UUID yoki public_code (MU-XXXXX) — draft'lar ham. */
  @Get('matches/:matchId')
  detail(@Param('matchId') id: string, @ReqLocale() locale: Locale) {
    return this.query.detail(id, locale);
  }

  @Post('matches')
  @HttpCode(201)
  create(@ZBody(CreateMatch) body: z.infer<typeof CreateMatch>, @IdempotencyKey() _key: string, @CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    return this.admin.createMatch(user.id, body, locale);
  }

  @Post('matches/:matchId/publish')
  @HttpCode(200)
  publish(@Param('matchId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    return this.admin.publish(user.id, id, locale);
  }

  @Post('matches/:matchId/cancel')
  @HttpCode(202)
  cancel(@Param('matchId', ParseUUIDPipe) id: string, @ZBody(CancelMatch) body: z.infer<typeof CancelMatch>, @IdempotencyKey() _key: string, @CurrentUser() user: AuthUser) {
    return this.admin.cancelMatch(user.id, id, body);
  }
}

@Module({
  imports: [CommerceModule, MatchesModule, MediaModule],
  controllers: [AdminController, AdminVenuesController, AdminHostsController, AdminFinanceController, AdminHighlightsController],
  providers: [AdminService, AdminMatchesQuery, AdminVenuesService, AdminHostsService, AdminFinanceService, AdminHighlightsService],
  exports: [AdminService],
})
export class AdminModule {}
