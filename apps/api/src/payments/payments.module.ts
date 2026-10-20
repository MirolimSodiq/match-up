import { All, Body, Controller, Get, Headers, HttpCode, Module, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { CurrentUser, Public, ReqLocale, ZQuery, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { money } from '../common/money';
import { CheckoutService } from '../commerce/checkout.service';
import { CommerceModule } from '../commerce/commerce.module';
import { WalletService } from '../commerce/wallet.service';
import { MatchesModule } from '../matches/matches.controller';
import { MatchesService } from '../matches/matches.service';
import { type ClickRequest, ClickService } from './click.service';
import { type PaymeRpc, PaymeService } from './payme.service';
import { ReconciliationModule } from './reconciliation.module';
import { UzumService } from './uzum.service';

const MethodsQuery = z.object({ match_id: z.uuid() });

@Controller('v1')
export class PaymentsController {
  constructor(
    private readonly payme: PaymeService,
    private readonly click: ClickService,
    private readonly uzum: UzumService,
    private readonly checkout: CheckoutService,
    private readonly wallet: WalletService,
    private readonly matches: MatchesService,
  ) {}

  @Get('payment-methods')
  async methods(@ZQuery(MethodsQuery) q: z.infer<typeof MethodsQuery>, @CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    const m = await this.matches.summaryRow(q.match_id);
    const providers = await this.checkout.availableProviders(m.id);
    const balance = await this.wallet.balance(user.id, m.currency);
    return {
      wallet_balance: money(balance, m.currency, locale),
      methods: providers.map((p) => ({ provider: p, display_name: this.checkout.displayName(p, locale), icon_url: null })),
    };
  }

  /** Payme Merchant API — har doim HTTP 200 (xatolar JSON-RPC `error` ichida). */
  @Public()
  @Post('webhooks/payme')
  @HttpCode(200)
  paymeWebhook(@Body() body: PaymeRpc, @Headers('authorization') auth?: string) {
    return this.payme.handle(body, auth);
  }

  @Public()
  @Post('webhooks/click/prepare')
  @HttpCode(200)
  clickPrepare(@Body() body: ClickRequest) {
    return this.click.prepare(body);
  }

  @Public()
  @Post('webhooks/click/complete')
  @HttpCode(200)
  clickComplete(@Body() body: ClickRequest) {
    return this.click.complete(body);
  }

  /**
   * Uzum Bank Merchant API: muvaffaqiyat — 200, xato — 400 + `errorCode`. Barcha HTTP metodlar shu yerga
   * keladi: POST bo'lmasa yoki operatsiya noma'lum bo'lsa — 10003.
   */
  @Public()
  @All('webhooks/uzum/:operation')
  async uzumWebhook(
    @Param('operation') operation: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('authorization') auth?: string,
  ) {
    const reply = await this.uzum.handle(operation, req.method, req.body, auth);
    res.status(reply.status);
    return reply.body;
  }

  @Public()
  @Post('webhooks/stripe')
  stripe(): never {
    throw new AppError('NOT_IMPLEMENTED');
  }
}

@Module({
  imports: [CommerceModule, MatchesModule, ReconciliationModule],
  controllers: [PaymentsController],
  providers: [PaymeService, ClickService, UzumService],
})
export class PaymentsModule {}
