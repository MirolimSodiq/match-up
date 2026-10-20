import { randomUUID } from 'node:crypto';
import { Controller, Get, Inject, type INestApplication, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { Logger, LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { LocaleMiddleware, ProblemFilter, Public } from './common/http';
import { DB, type Db } from './db/db';
import { DbModule } from './db/db.module';
import { AdminModule } from './admin/admin.module';
import { BookingsModule } from './bookings/bookings.module';
import { CatalogModule } from './catalog/catalog.controller';
import { HostModule } from './host/host.module';
import { IdentityModule } from './identity/identity.module';
import { JobsModule } from './jobs/jobs.module';
import { MatchesModule } from './matches/matches.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { REDIS, RedisModule } from './redis/redis.module';
import { WaiversModule } from './waivers/waivers.module';

@Controller()
class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get('health')
  async health() {
    await this.db.execute(sql`SELECT 1`);
    await this.redis.ping();
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
          genReqId: (req: Request, res: Response) => {
            const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // PII va secret'lar loglarga tushmaydi
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.phone',
              'req.body.code',
              'req.body.refresh_token',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },
          transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        },
      }),
    }),
    DbModule,
    RedisModule,
    IdentityModule,
    CatalogModule,
    MatchesModule,
    WaiversModule,
    BookingsModule,
    PaymentsModule,
    HostModule,
    AdminModule,
    NotificationsModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
})
export class AppModule {}

/** main.ts va e2e testlar uchun umumiy sozlash. */
export function configureApp(app: INestApplication): INestApplication {
  const express = app as NestExpressApplication;
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  const locale = new LocaleMiddleware();
  express.use(locale.use.bind(locale));
  express.useLogger(express.get(Logger));
  express.enableShutdownHooks();
  return app;
}
