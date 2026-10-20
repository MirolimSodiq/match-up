import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentUser, ReqLocale, ZBody, ZQuery, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { DB, type Db, iso, one } from '../db/db';
import { NotificationsService } from './notifications.service';
import { isExpoPushToken } from './push/expo-push.sender';

const RegisterDevice = z
  .object({
    push_token: z.string().trim().min(10).max(4096),
    platform: z.enum(['ios', 'android', 'web']),
    provider: z.enum(['expo', 'fcm', 'apns']).default('expo'),
    app_version: z.string().max(40).optional(),
    locale: z.string().max(10).optional(),
  })
  .refine((d) => d.provider !== 'expo' || isExpoPushToken(d.push_token), {
    path: ['push_token'],
    message: 'Expo push token formati: ExponentPushToken[...]',
  });

const ListQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const MarkRead = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

interface DeviceRow {
  id: string;
  platform: string;
  provider: string;
  locale: string;
  app_version: string | null;
  created_at: string;
  updated_at: string;
}

@Controller('v1/me')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /**
   * Push token'ni ro'yxatdan o'tkazish / yangilash (ilova har ochilganda chaqiradi).
   * Token boshqa akkauntga tegishli bo'lsa (umumiy qurilma) — joriy foydalanuvchiga o'tadi.
   */
  @Put('devices')
  async register(
    @CurrentUser() user: AuthUser,
    @ZBody(RegisterDevice) body: z.infer<typeof RegisterDevice>,
    @ReqLocale() locale: Locale,
  ) {
    const d = await one<DeviceRow>(
      this.db,
      sql`INSERT INTO device_tokens (user_id, platform, provider, push_token, locale, app_version)
          VALUES (${user.id}, ${body.platform}, ${body.provider}, ${body.push_token}, ${body.locale ?? locale}, ${body.app_version ?? null})
          ON CONFLICT (push_token) DO UPDATE
            SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, provider = EXCLUDED.provider,
                locale = EXCLUDED.locale, app_version = EXCLUDED.app_version,
                disabled_at = NULL, disabled_reason = NULL, updated_at = now()
          RETURNING id, platform, provider, locale, app_version, created_at, updated_at`,
    );
    return { ...d!, created_at: iso(d!.created_at), updated_at: iso(d!.updated_at) };
  }

  /** Logout / push'dan voz kechish. Idempotent: token topilmasa ham 204. */
  @Delete('devices/:token')
  @HttpCode(204)
  async unregister(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.db.execute(sql`DELETE FROM device_tokens WHERE push_token = ${token} AND user_id = ${user.id}`);
  }

  @Get('notifications')
  list(@CurrentUser() user: AuthUser, @ZQuery(ListQuery) q: z.infer<typeof ListQuery>) {
    return this.notifications.list(user.id, q.cursor, q.limit);
  }

  @Post('notifications/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @ZBody(MarkRead) body: z.infer<typeof MarkRead>) {
    return this.notifications.markRead(user.id, body);
  }
}
