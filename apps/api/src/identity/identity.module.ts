import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, type Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { MeController } from './me.controller';
import { OTP_SENDER, createOtpSender } from './otp-senders';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';
import { UsersService } from './users.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    TokensService,
    OtpService,
    UsersService,
    { provide: OTP_SENDER, inject: [ENV], useFactory: (env: Env) => createOtpSender(env) },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokensService, OtpService, UsersService],
})
export class IdentityModule {}
