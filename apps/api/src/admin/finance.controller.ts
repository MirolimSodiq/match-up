import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { IdempotencyKey, ReqLocale, Roles, ZBody, ZQuery } from '../common/http';
import type { Locale } from '../common/i18n';
import { type Actor, CurrentActor } from './audit';
import { AdminFinanceService } from './finance.service';
import { csv, DateTime, Page } from './schemas';

const Provider = z.enum(['payme', 'click', 'uzum', 'stripe', 'paypal', 'wallet', 'manual']);

const PaymentList = z.object({
  status: csv(z.enum(['created', 'pending', 'authorized', 'succeeded', 'failed', 'cancelled', 'expired', 'refunded', 'partially_refunded'])).optional(),
  provider: csv(Provider).optional(),
  date_from: DateTime.optional(),
  date_to: DateTime.optional(),
  match_id: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  ...Page,
});

const RefundList = z.object({
  status: csv(z.enum(['pending', 'succeeded', 'failed'])).default(['pending']),
  destination: csv(z.enum(['original_method', 'wallet'])).default(['original_method']),
  provider: csv(Provider).optional(),
  auto_status: csv(z.enum(['queued', 'submitted', 'manual'])).optional(),
  q: z.string().trim().max(100).optional(),
  ...Page,
});

const RefundToWallet = z.object({
  note: z.string().trim().max(1000).optional(),
});

const CompleteRefund = z.object({
  provider_refund_id: z.string().trim().min(1).max(200),
  note: z.string().trim().max(1000).optional(),
});

const Dashboard = z
  .object({
    date_from: DateTime.optional(),
    date_to: DateTime.optional(),
    city_id: z.coerce.number().int().positive().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).default('UZS'),
  })
  .transform((q) => {
    const to = q.date_to ?? new Date(Date.now() + 30 * 86400_000).toISOString();
    const from = q.date_from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    return { ...q, date_from: from, date_to: to };
  });

@Roles('admin')
@Controller('v1/admin')
export class AdminFinanceController {
  constructor(private readonly finance: AdminFinanceService) {}

  @Get('payments')
  payments(@ZQuery(PaymentList) q: z.infer<typeof PaymentList>, @ReqLocale() locale: Locale) {
    return this.finance.payments(q, locale);
  }

  @Get('refunds')
  refunds(@ZQuery(RefundList) q: z.infer<typeof RefundList>, @ReqLocale() locale: Locale) {
    return this.finance.refunds(q, locale);
  }

  @Post('refunds/:refundId/complete')
  @HttpCode(200)
  complete(
    @Param('refundId', ParseUUIDPipe) id: string,
    @ZBody(CompleteRefund) body: z.infer<typeof CompleteRefund>,
    @IdempotencyKey() _key: string,
    @CurrentActor() actor: Actor,
    @ReqLocale() locale: Locale,
  ) {
    return this.finance.completeRefund(actor, id, body, locale);
  }

  @Post('refunds/:refundId/to-wallet')
  @HttpCode(200)
  toWallet(
    @Param('refundId', ParseUUIDPipe) id: string,
    @ZBody(RefundToWallet) body: z.infer<typeof RefundToWallet>,
    @IdempotencyKey() _key: string,
    @CurrentActor() actor: Actor,
    @ReqLocale() locale: Locale,
  ) {
    return this.finance.refundToWallet(actor, id, body, locale);
  }

  @Post('refunds/:refundId/retry')
  @HttpCode(200)
  retry(@Param('refundId', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @ReqLocale() locale: Locale) {
    return this.finance.retryAutoRefund(actor, id, locale);
  }

  @Get('dashboard')
  dashboard(@ZQuery(Dashboard) q: z.infer<typeof Dashboard>, @ReqLocale() locale: Locale) {
    if (new Date(q.date_from) >= new Date(q.date_to)) {
      throw new AppError('VALIDATION_FAILED', {}, [{ field: 'date_to', code: 'too_small', message: 'date_to > date_from' }]);
    }
    return this.finance.dashboard(q, locale);
  }
}
