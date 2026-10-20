import { randomBytes } from 'node:crypto';
import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { AppError } from '../common/errors';
import { ClientIp, CurrentUser, Public, ReqLocale, ZBody, ZQuery, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { DB, type Db } from '../db/db';
import { OtpService } from './otp.service';
import { SocialAuthService, SocialCredential } from './social/social.service';
import { telegramBotId } from './social/telegram';
import { type DeviceMeta, TokensService } from './tokens.service';
import { UsersService } from './users.service';

const Phone = z
  .string()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, 'E.164 formatida bo\'lishi kerak, masalan +998901234567'));

const Device = z.object({
  device_id: z.string().min(1).max(200),
  platform: z.enum(['ios', 'android', 'web']),
  app_version: z.string().max(40).optional(),
  push_token: z.string().max(4096).optional(),
  locale: z.string().max(10).optional(),
});

const OtpRequest = z.object({ phone: Phone, channel: z.enum(['sms', 'telegram']).default('sms') });
const OtpVerify = z.object({
  challenge_id: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  device: Device,
});
const Refresh = z.object({ refresh_token: z.string().min(20).max(200) });
const SocialLogin = z.intersection(SocialCredential, z.object({ device: Device }));
const TelegramRedirect = z.object({ redirect_uri: z.string().min(4).max(500) });

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    private readonly users: UsersService,
    private readonly social: SocialAuthService,
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private meta(req: Request, device?: z.infer<typeof Device>): DeviceMeta {
    return {
      device_id: device?.device_id,
      platform: device?.platform,
      app_version: device?.app_version,
      ip: req.ip,
      user_agent: req.headers['user-agent']?.slice(0, 500),
    };
  }

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@ZBody(OtpRequest) body: z.infer<typeof OtpRequest>, @ClientIp() ip: string, @ReqLocale() locale: Locale) {
    return this.otp.request(body.phone, body.channel, ip, locale);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@ZBody(OtpVerify) body: z.infer<typeof OtpVerify>, @Req() req: Request, @ReqLocale() locale: Locale) {
    const phone = await this.otp.consume(body.challenge_id, body.code);
    const { user, isNew } = await this.users.findOrCreateByPhone(phone, locale);
    return this.signIn(user.id, isNew, body.device, req, locale);
  }

  /** Push token'ni ro'yxatga oladi va sessiya ochadi (OTP va social login uchun umumiy). */
  private async signIn(userId: string, isNew: boolean, d: z.infer<typeof Device>, req: Request, locale: Locale) {
    if (d.push_token) {
      await this.db.execute(
        sql`INSERT INTO device_tokens (user_id, platform, push_token, locale, app_version)
            VALUES (${userId}, ${d.platform}, ${d.push_token}, ${d.locale ?? locale}, ${d.app_version ?? null})
            ON CONFLICT (push_token) DO UPDATE
              SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, locale = EXCLUDED.locale,
                  app_version = EXCLUDED.app_version, disabled_at = NULL`,
      );
    }
    const tokens = await this.tokens.issue(userId, this.meta(req, d));
    return { ...tokens, user: await this.users.profile(userId), is_new_user: isNew };
  }

  /**
   * Google / Apple ID token yoki Telegram Login. Identity faqat (provider, provider_uid) bo'yicha topiladi;
   * topilmasa — yangi akkaunt (email bo'yicha mavjud akkauntga bog'lanmaydi). Bog'lash: POST /v1/me/identities.
   */
  @Public()
  @Post('social')
  @HttpCode(200)
  async socialLogin(@ZBody(SocialLogin) body: z.infer<typeof SocialLogin>, @Req() req: Request, @ReqLocale() locale: Locale) {
    const identity = await this.social.verify(body);
    const { user, isNew } = await this.users.findOrCreateByIdentity(identity, locale);
    return this.signIn(user.id, isNew, body.device, req, locale);
  }

  /**
   * Telegram OAuth (brauzer orqali): oauth.telegram.org -> /telegram/return -> ilova deep link'i.
   * Bot domeni @BotFather'da `/setdomain` bilan PUBLIC_BASE_URL host'iga bog'langan bo'lishi kerak.
   */
  @Public()
  @Get('telegram/start')
  telegramStart(@ZQuery(TelegramRedirect) q: z.infer<typeof TelegramRedirect>, @Req() req: Request, @Res() res: Response) {
    const redirect = this.allowedAppRedirect(q.redirect_uri);
    const base = this.env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const returnTo = `${base}/v1/auth/telegram/return?redirect_uri=${encodeURIComponent(redirect)}`;
    const url = new URL(this.env.TELEGRAM_OAUTH_URL);
    url.searchParams.set('bot_id', telegramBotId(this.env.TELEGRAM_BOT_TOKEN!));
    url.searchParams.set('origin', new URL(base).origin);
    url.searchParams.set('request_access', 'write');
    url.searchParams.set('return_to', returnTo);
    res.setHeader('Cache-Control', 'no-store');
    // Web client popup ochishi uchun URL'ni JSON'da ham berish mumkin
    if (req.accepts(['text/html', 'application/json']) === 'application/json') {
      res.json({ url: url.toString() });
      return;
    }
    res.redirect(302, url.toString());
  }

  /**
   * Telegram natijani fragment'da (`#tgAuthResult=<base64 JSON>`) yoki query'da qaytaradi — sahifa uni
   * o'zgartirmasdan ilovaga uzatadi, hash tekshiruvi POST /v1/auth/social da. Yo'naltirish faqat allowlist'dagi
   * sxemalarga (aks holda tutib olingan natija begona saytga ketishi mumkin).
   */
  @Public()
  @Get('telegram/return')
  telegramReturn(@ZQuery(TelegramRedirect) q: z.infer<typeof TelegramRedirect>, @Res() res: Response) {
    const redirect = this.allowedAppRedirect(q.redirect_uri);
    const nonce = randomBytes(16).toString('base64');
    // JSON.stringify + '<' escape: redirect_uri skript kontekstidan chiqib keta olmaydi
    const target = JSON.stringify(redirect).replace(/</g, '\\u003c');
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'`,
      })
      .send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Match Up</title></head><body style="font-family:system-ui;text-align:center;padding:48px 16px">Match Up…
<script nonce="${nonce}">
(function () {
  var target = ${target};
  // Fragment qiymati xom holda uzatiladi (URLSearchParams base64'dagi '+' ni buzadi)
  var m = /[#&]tgAuthResult=([^&]*)/.exec(location.hash);
  var h = m ? m[1] : null;
  if (!h) {
    var q = new URLSearchParams(location.search), o = {};
    q.forEach(function (v, k) { if (k !== 'redirect_uri') o[k] = v; });
    if (o.hash) h = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o)))));
  }
  location.replace(target + (target.indexOf('#') < 0 ? '#' : '&') + (h ? 'tgAuthResult=' + h : 'error=cancelled'));
})();
</script></body></html>`);
  }

  private allowedAppRedirect(uri: string): string {
    if (!this.env.TELEGRAM_BOT_TOKEN) throw new AppError('SOCIAL_PROVIDER_DISABLED');
    const ok = this.env.TELEGRAM_APP_REDIRECTS.some((prefix) => uri.startsWith(prefix));
    if (!ok || /[\s"'<>\\]/.test(uri)) {
      throw new AppError('VALIDATION_FAILED', {}, [{ field: 'redirect_uri', code: 'not_allowed', message: "redirect_uri ruxsat etilmagan" }]);
    }
    return uri;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@ZBody(Refresh) body: z.infer<typeof Refresh>, @Req() req: Request) {
    return this.tokens.rotate(body.refresh_token, this.meta(req));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() _user: AuthUser, @Req() req: Request) {
    if (req.sessionFamily) await this.tokens.revokeFamily(req.sessionFamily);
  }
}
