import { Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { CurrentUser, ReqLocale, ZBody, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { money } from '../common/money';
import { WalletService } from '../commerce/wallet.service';
import { DB, type Db, one, pgError, PG, rows } from '../db/db';
import { users } from '../db/schema';
import { UsersService } from './users.service';

const SkillLevel = z.enum(['beginner', 'intermediate', 'advanced', 'pro']);

const UserUpdate = z
  .object({
    display_name: z.string().trim().min(2).max(40),
    first_name: z.string().trim().max(60),
    last_name: z.string().trim().max(60),
    locale: z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en']),
    home_city_id: z.number().int().positive(),
    birth_date: z.iso.date(),
    gender: z.enum(['male', 'female', 'other', 'undisclosed']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Kamida bitta maydon kerak');

const SportProfile = z.object({ self_level: SkillLevel, preferred_position: z.string().max(40).optional() });

const ConsentPurpose = z.enum([
  'terms_of_service',
  'privacy_policy',
  'marketing_sms',
  'marketing_push',
  'marketing_email',
  'analytics',
  'media_appearance',
  'location_tracking',
]);
const Consents = z.object({
  consents: z
    .array(z.object({ purpose: ConsentPurpose, granted: z.boolean(), document_version: z.string().max(40).optional() }))
    .min(1)
    .max(20),
});

@Controller('v1/me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly wallet: WalletService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.users.profile(user.id);
  }

  @Patch()
  async update(@CurrentUser() user: AuthUser, @ZBody(UserUpdate) body: z.infer<typeof UserUpdate>) {
    try {
      await this.db
        .update(users)
        .set({
          displayName: body.display_name,
          firstName: body.first_name,
          lastName: body.last_name,
          locale: body.locale,
          homeCityId: body.home_city_id,
          birthDate: body.birth_date,
          gender: body.gender,
          // Onboarding: shahar tanlangan paytdan "onboarded"
          onboardedAt: sql`coalesce(${users.onboardedAt}, CASE WHEN coalesce(${body.home_city_id ?? null}::int, ${users.homeCityId}) IS NOT NULL THEN now() END)`,
        })
        .where(and(eq(users.id, user.id), isNull(users.deletedAt)));
    } catch (err) {
      if (pgError(err)?.code === PG.FOREIGN_KEY_VIOLATION) {
        throw new AppError('VALIDATION_FAILED', {}, [{ field: 'home_city_id', code: 'not_found', message: 'Shahar topilmadi' }]);
      }
      throw err;
    }
    return this.users.profile(user.id);
  }

  @Get('wallet')
  async getWallet(@CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    const balances = (await this.wallet.balances(user.id)).map((b) => money(b.balance, b.currency, locale));
    return { balance: balances[0]!, balances };
  }

  @Put('sports/:sportCode')
  async upsertSport(
    @CurrentUser() user: AuthUser,
    @Param('sportCode') sportCode: string,
    @ZBody(SportProfile) body: z.infer<typeof SportProfile>,
  ) {
    const sport = await one<{ id: number }>(this.db, sql`SELECT id FROM sports WHERE code = ${sportCode} AND is_active`);
    if (!sport) throw new AppError('NOT_FOUND');
    const row = await one<{ self_level: string; rating: string; games_played: number; preferred_position: string | null }>(
      this.db,
      sql`INSERT INTO player_sport_profiles (user_id, sport_id, self_level, preferred_position)
          VALUES (${user.id}, ${sport.id}, ${body.self_level}, ${body.preferred_position ?? null})
          ON CONFLICT (user_id, sport_id) DO UPDATE
            SET self_level = EXCLUDED.self_level, preferred_position = EXCLUDED.preferred_position, updated_at = now()
          RETURNING self_level, rating, games_played, preferred_position`,
    );
    return { sport: sportCode, ...row!, rating: Number(row!.rating) };
  }

  @Put('consents')
  async consents(@CurrentUser() user: AuthUser, @ZBody(Consents) body: z.infer<typeof Consents>, @Req() req: Request) {
    for (const c of body.consents) {
      await this.db.execute(
        sql`INSERT INTO consents (user_id, purpose, granted, document_version, source, ip, user_agent)
            VALUES (${user.id}, ${c.purpose}, ${c.granted}, ${c.document_version ?? null}, 'settings', ${req.ip ?? null}::inet,
                    ${req.headers['user-agent']?.slice(0, 500) ?? null})`,
      );
    }
    return rows(
      this.db,
      sql`SELECT purpose, granted, document_version, recorded_at FROM user_current_consents WHERE user_id = ${user.id} ORDER BY purpose`,
    );
  }

  @Post('data-export')
  @HttpCode(202)
  async dataExport(@CurrentUser() user: AuthUser) {
    return one(
      this.db,
      sql`INSERT INTO data_subject_requests (user_id, type) VALUES (${user.id}, 'export')
          RETURNING id, type, status, due_at`,
    );
  }

  @Delete()
  @HttpCode(202)
  async erase(@CurrentUser() user: AuthUser) {
    const pending = await one(
      this.db,
      sql`SELECT 1 FROM data_subject_requests
          WHERE user_id = ${user.id} AND type = 'erasure' AND status IN ('received', 'in_progress')`,
    );
    if (pending) throw new AppError('ERASURE_PENDING');
    // 30 kunlik grace: DSR job muddat o'tgach anonimlashtiradi (foydalanuvchi shu vaqtgacha bekor qila oladi)
    return one(
      this.db,
      sql`INSERT INTO data_subject_requests (user_id, type) VALUES (${user.id}, 'erasure')
          RETURNING id, type, status, due_at`,
    );
  }
}
