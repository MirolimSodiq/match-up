import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentActor } from '../admin/audit';
import { AppError } from '../common/errors';
import { CurrentUser, ZBody, type AuthUser } from '../common/http';
import { SocialAuthService, SocialCredential } from './social/social.service';

const UnlinkProvider = z.enum(['google', 'apple', 'telegram']);

/** Kirgan foydalanuvchining kirish usullari: ro'yxat, social identity bog'lash va uzish. */
@Controller('v1/me/identities')
export class IdentitiesController {
  constructor(private readonly social: SocialAuthService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.social.list(user.id);
  }

  @Post()
  @HttpCode(200)
  link(@CurrentActor() actor: Actor, @ZBody(SocialCredential) body: SocialCredential) {
    return this.social.link(actor, body);
  }

  /** Telefon bu yerda uzilmaydi (raqam almashtirish — alohida oqim). */
  @Delete(':provider')
  @HttpCode(204)
  async unlink(@CurrentActor() actor: Actor, @Param('provider') provider: string) {
    const parsed = UnlinkProvider.safeParse(provider);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', {}, [{ field: 'provider', code: 'invalid', message: 'google, apple yoki telegram' }]);
    }
    await this.social.unlink(actor, parsed.data);
  }
}
