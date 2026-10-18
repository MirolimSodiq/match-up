import { Controller, Get, HttpCode, Inject, Injectable, Module, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { CurrentUser, ReqLocale, ZBody, ZQuery, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { DB, type Db, type Executor, iso, one } from '../db/db';
import { IdentityModule } from '../identity/identity.module';
import { OtpService } from '../identity/otp.service';
import { UsersService } from '../identity/users.service';

interface TemplateRow {
  id: string;
  code: string;
  version: number;
  locale: string;
  title: string;
  body_md: string;
  body_sha256: Buffer;
  min_age: number;
}

const toTemplate = (t: TemplateRow) => ({
  id: t.id,
  code: t.code,
  version: t.version,
  locale: t.locale,
  title: t.title,
  body_md: t.body_md,
  document_sha256: Buffer.from(t.body_sha256).toString('hex'),
  min_age: t.min_age,
});

@Injectable()
export class WaiversService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly users: UsersService,
    private readonly otp: OtpService,
  ) {}

  /** Joriy (eng yangi, retire qilinmagan) versiya — foydalanuvchi tilida, bo'lmasa uz-Latn. */
  async current(code: string, locale: Locale): Promise<TemplateRow> {
    const t = await one<TemplateRow>(
      this.db,
      sql`SELECT id, code, version, locale, title, body_md, body_sha256, min_age
          FROM waiver_templates
          WHERE code = ${code} AND retired_at IS NULL AND effective_from <= now()
            AND version = (SELECT max(version) FROM waiver_templates WHERE code = ${code} AND retired_at IS NULL)
          ORDER BY (locale = ${locale}) DESC, (locale = 'uz-Latn') DESC
          LIMIT 1`,
    );
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  /** Foydalanuvchining joriy versiyaga qo'ygan imzosi (har qanday tilda) — booking uchun yaroqli. */
  async validSignature(userId: string, code: string, signatureId?: string, ex: Executor = this.db) {
    return one<{ id: string; signed_at: string }>(
      ex,
      sql`SELECT ws.id, ws.signed_at
          FROM waiver_signatures ws JOIN waiver_templates t ON t.id = ws.template_id
          WHERE ws.user_id = ${userId} AND t.code = ${code} AND t.retired_at IS NULL
            AND t.version = (SELECT max(version) FROM waiver_templates WHERE code = ${code} AND retired_at IS NULL)
            AND (${signatureId ?? null}::uuid IS NULL OR ws.id = ${signatureId ?? null}::uuid)
          ORDER BY ws.signed_at DESC LIMIT 1`,
    );
  }

  async required(matchId: string, userId: string, locale: Locale) {
    const m = await one<{ code: string }>(
      this.db,
      sql`SELECT waiver_template_code AS code FROM matches WHERE id = ${matchId} AND status <> 'draft'`,
    );
    if (!m) throw new AppError('NOT_FOUND');
    const t = await this.current(m.code, locale);
    const sig = await this.validSignature(userId, m.code);
    return { template: toTemplate(t), signed: !!sig, signature_id: sig?.id ?? null };
  }

  async sign(userId: string, templateId: string, body: z.infer<typeof SignBody>, req: Request) {
    const t = await one<TemplateRow & { is_current: boolean }>(
      this.db,
      sql`SELECT t.id, t.code, t.version, t.locale, t.title, t.body_md, t.body_sha256, t.min_age,
                 (t.retired_at IS NULL AND t.version = (SELECT max(version) FROM waiver_templates
                                                        WHERE code = t.code AND retired_at IS NULL)) AS is_current
          FROM waiver_templates t WHERE t.id = ${templateId}`,
    );
    if (!t) throw new AppError('NOT_FOUND');
    // Client ko'rsatgan matn serverdagi joriy versiyaga aynan mos bo'lishi shart
    if (!t.is_current || Buffer.from(t.body_sha256).toString('hex') !== body.document_sha256.toLowerCase()) {
      throw new AppError('WAIVER_OUTDATED');
    }
    const user = await this.users.get(userId);
    const age = UsersService.ageAt(user.birth_date, new Date());
    if (age !== undefined && age < t.min_age) throw new AppError('AGE_RESTRICTED');
    if (age !== undefined && age < 18 && !body.guardian) throw new AppError('GUARDIAN_REQUIRED');

    let otpRef: string | null = null;
    if (body.method === 'otp_confirmed') {
      if (!body.otp) {
        throw new AppError('VALIDATION_FAILED', {}, [{ field: 'otp', code: 'required', message: 'otp majburiy' }]);
      }
      const phone = await this.otp.consume(body.otp.challenge_id, body.otp.code);
      if (phone !== user.phone_e164) throw new AppError('OTP_INVALID');
      otpRef = body.otp.challenge_id;
    }

    const s = await one<{ id: string; signed_at: string }>(
      this.db,
      sql`INSERT INTO waiver_signatures (user_id, template_id, document_sha256, method, typed_full_name, otp_challenge_ref,
                                         ip, user_agent, app_version, device_id, guardian_name, guardian_phone,
                                         guardian_relation, match_id)
          VALUES (${userId}, ${t.id}, ${t.body_sha256}, ${body.method}, ${body.typed_full_name ?? null}, ${otpRef},
                  ${req.ip ?? null}::inet, ${req.headers['user-agent']?.slice(0, 500) ?? null},
                  ${(req.headers['x-app-version'] as string | undefined) ?? null}, ${(req.headers['x-device-id'] as string | undefined) ?? null},
                  ${body.guardian?.name ?? null}, ${body.guardian?.phone ?? null}, ${body.guardian?.relation ?? null},
                  ${body.match_id ?? null})
          RETURNING id, signed_at`,
    );
    return { signature_id: s!.id, signed_at: iso(s!.signed_at) };
  }
}

const RequiredQuery = z.object({ match_id: z.uuid() });
const SignBody = z.object({
  accepted: z.literal(true),
  method: z.enum(['clickwrap', 'otp_confirmed']),
  document_sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  typed_full_name: z.string().trim().max(120).optional(),
  otp: z.object({ challenge_id: z.uuid(), code: z.string().regex(/^\d{6}$/) }).optional(),
  match_id: z.uuid().optional(),
  guardian: z
    .object({ name: z.string().trim().min(2).max(120), phone: z.string().max(20), relation: z.string().max(40) })
    .optional(),
});

@Controller('v1/waivers')
export class WaiversController {
  constructor(private readonly waivers: WaiversService) {}

  @Get('required')
  required(@ZQuery(RequiredQuery) q: z.infer<typeof RequiredQuery>, @CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    return this.waivers.required(q.match_id, user.id, locale);
  }

  @Post(':templateId/signatures')
  @HttpCode(201)
  sign(
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @ZBody(SignBody) body: z.infer<typeof SignBody>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.waivers.sign(user.id, templateId, body, req);
  }
}

@Module({
  imports: [IdentityModule],
  controllers: [WaiversController],
  providers: [WaiversService],
  exports: [WaiversService],
})
export class WaiversModule {}
