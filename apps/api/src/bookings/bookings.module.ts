import { Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, IdempotencyKey, ReqLocale, ZBody, ZQuery, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { CommerceModule } from '../commerce/commerce.module';
import { IdentityModule } from '../identity/identity.module';
import { MatchesModule } from '../matches/matches.controller';
import { WaiversModule } from '../waivers/waivers.module';
import { BookingsService } from './bookings.service';

const CreateBooking = z.object({
  match_id: z.uuid(),
  seats: z.number().int().min(1).max(4).default(1),
  guests: z.array(z.object({ name: z.string().trim().min(2).max(60) })).max(3).default([]),
  payment_method: z.enum(['payme', 'click', 'uzum', 'stripe', 'paypal', 'wallet']),
  use_wallet: z.boolean().default(false),
  promo_code: z.string().max(40).optional(),
  waiver_signature_id: z.uuid(),
  return_url: z.url().optional(),
});

const CancelBooking = z
  .object({
    reason: z.string().max(500).optional(),
    refund_destination: z.enum(['original_method', 'wallet']).optional(),
  })
  .default({});

const ListQuery = z.object({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@Controller('v1')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('bookings')
  @HttpCode(201)
  create(
    @ZBody(CreateBooking) body: z.infer<typeof CreateBooking>,
    @IdempotencyKey() key: string,
    @CurrentUser() user: AuthUser,
    @ReqLocale() locale: Locale,
  ) {
    return this.bookings.create(user.id, body, key, locale);
  }

  @Get('bookings/:bookingId')
  get(@Param('bookingId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    return this.bookings.get(id, user.id, locale);
  }

  @Post('bookings/:bookingId/cancel')
  @HttpCode(200)
  cancel(
    @Param('bookingId', ParseUUIDPipe) id: string,
    @ZBody(CancelBooking) body: z.infer<typeof CancelBooking>,
    @IdempotencyKey() _key: string,
    @CurrentUser() user: AuthUser,
    @ReqLocale() locale: Locale,
  ) {
    return this.bookings.cancel(user.id, id, body, locale);
  }

  @Get('bookings/:bookingId/ticket')
  ticket(@Param('bookingId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookings.tickets(user.id, id);
  }

  @Get('me/bookings')
  mine(@ZQuery(ListQuery) q: z.infer<typeof ListQuery>, @CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    return this.bookings.listMine(user.id, q.scope, q.cursor, q.limit, locale);
  }
}

@Module({
  imports: [CommerceModule, IdentityModule, MatchesModule, WaiversModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
