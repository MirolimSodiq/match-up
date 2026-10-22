import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { IdempotencyKey, ReqLocale, Roles, ZBody, ZQuery } from '../common/http';
import type { Locale } from '../common/i18n';
import { type Actor, CurrentActor } from './audit';
import { AdminHostPayoutsService } from './host-payouts.service';
import { csv, Page } from './schemas';

const Filter = z.object({
  status: csv(z.enum(['pending', 'processing', 'paid', 'failed'])).optional(),
  host_id: z.uuid().optional(),
  period_from: z.iso.date().optional(),
  period_to: z.iso.date().optional(),
  q: z.string().trim().max(100).optional(),
});
const PayoutList = Filter.extend(Page);

const Paid = z.object({
  provider_ref: z.string().trim().min(1).max(200),
  note: z.string().trim().max(1000).optional(),
});
const BulkPaid = Paid.extend({ ids: z.array(z.uuid()).min(1).max(200) });

@Roles('admin')
@Controller('v1/admin/host-payouts')
export class AdminHostPayoutsController {
  constructor(private readonly payouts: AdminHostPayoutsService) {}

  @Get()
  list(@ZQuery(PayoutList) q: z.infer<typeof PayoutList>, @ReqLocale() locale: Locale) {
    return this.payouts.list(q, locale);
  }

  /** Bank o'tkazmasi uchun CSV (ro'yxat filtrlari bilan, pagination'siz). */
  @Get('export')
  async export(@ZQuery(Filter) q: z.infer<typeof Filter>, @Res({ passthrough: true }) res: Response) {
    const body = await this.payouts.exportCsv(q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="host-payouts-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return body;
  }

  /** Ommaviy: tanlangan payout'lar bitta o'tkazma raqami bilan. */
  @Post('paid')
  @HttpCode(200)
  async bulkPaid(
    @ZBody(BulkPaid) body: z.infer<typeof BulkPaid>,
    @IdempotencyKey() _key: string,
    @CurrentActor() actor: Actor,
    @ReqLocale() locale: Locale,
  ) {
    const items = await this.payouts.markPaid(actor, body.ids, body, locale);
    return { items };
  }

  @Get(':payoutId')
  get(@Param('payoutId', ParseUUIDPipe) id: string, @ReqLocale() locale: Locale) {
    return this.payouts.get(id, locale);
  }

  @Post(':payoutId/paid')
  @HttpCode(200)
  async paid(
    @Param('payoutId', ParseUUIDPipe) id: string,
    @ZBody(Paid) body: z.infer<typeof Paid>,
    @IdempotencyKey() _key: string,
    @CurrentActor() actor: Actor,
    @ReqLocale() locale: Locale,
  ) {
    const [item] = await this.payouts.markPaid(actor, [id], body, locale);
    return item;
  }
}
