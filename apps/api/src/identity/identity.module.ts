import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CommerceModule } from '../commerce/commerce.module';
import { ENV, type Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { IdentitiesController } from './identities.controller';
import { MeController } from './me.controller';
import { OTP_SENDER, createOtpSender } from './otp-senders';
import { OtpService } from './otp.service';
import { SocialAuthService } from './social/social.service';
import { TokensService } from './tokens.service';
import { UsersService } from './users.service';

@Module({
  imports: [CommerceModule],
  controllers: [AuthController, MeController, IdentitiesController],
  providers: [
    TokensService,
    OtpService,
    UsersService,
    SocialAuthService,
    { provide: OTP_SENDER, inject: [ENV], useFactory: (env: Env) => createOtpSender(env) },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokensService, OtpService, UsersService, SocialAuthService],
})
export class IdentityModule {}
