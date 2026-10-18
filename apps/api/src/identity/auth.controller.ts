import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { ClientIp, CurrentUser, Public, ReqLocale, ZBody, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { DB, type Db } from '../db/db';
import { OtpService } from './otp.service';
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

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    private readonly users: UsersService,
    @Inject(DB) private readonly db: Db,
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
    const d = body.device;
    if (d.push_token) {
      await this.db.execute(
        sql`INSERT INTO device_tokens (user_id, platform, push_token, locale, app_version)
            VALUES (${user.id}, ${d.platform}, ${d.push_token}, ${d.locale ?? locale}, ${d.app_version ?? null})
            ON CONFLICT (push_token) DO UPDATE
              SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, locale = EXCLUDED.locale,
                  app_version = EXCLUDED.app_version, disabled_at = NULL`,
      );
    }
    const tokens = await this.tokens.issue(user.id, this.meta(req, d));
    return { ...tokens, user: await this.users.profile(user.id), is_new_user: isNew };
  }

  @Public()
  @Post('social')
  socialLogin(): never {
    // Google / Apple ID token (JWKS) va Telegram Login hash tekshiruvi — keyingi iteratsiya.
    throw new AppError('NOT_IMPLEMENTED');
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
