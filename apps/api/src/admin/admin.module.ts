import { Controller, HttpCode, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, IdempotencyKey, ReqLocale, Roles, ZBody, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { CommerceModule } from '../commerce/commerce.module';
import { MatchesModule } from '../matches/matches.controller';
import { AdminService } from './admin.service';

const Money = z.object({ amount: z.number().int().min(0), currency: z.string().regex(/^[A-Z]{3}$/) });
const Level = z.enum(['beginner', 'intermediate', 'advanced', 'pro']);

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

@Roles('admin')
@Controller('v1/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

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
  imports: [CommerceModule, MatchesModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
