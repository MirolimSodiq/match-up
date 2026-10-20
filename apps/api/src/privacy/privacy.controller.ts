import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { ENV, type Env } from '../config/env';
import { AppError } from '../common/errors';
import { CurrentUser, ReqLocale, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { formatMoney, money } from '../common/money';
import { DB, type Db, iso, one, pgError, PG, rows } from '../db/db';
import { DataExportService } from './data-export.service';
import type { BlockedReason } from './erasure.service';

interface DsrRow {
  id: string;
  type: 'export' | 'erasure';
  status: string;
  requested_at: string;
  due_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  export_expires_at: string | null;
  downloadable: boolean;
  blocked_reasons: BlockedReason[] | null;
}

const DSR_COLUMNS = sql`id, type, status, requested_at, due_at, completed_at, cancelled_at, export_expires_at,
  (export_path IS NOT NULL AND export_expires_at > now()) AS downloadable, blocked_reasons`;

function reasonMessage(r: BlockedReason, locale: Locale): string {
  if (r.code === 'wallet_balance') {
    const sum = formatMoney(r.amount, r.currency, locale);
    if (locale === 'ru') return `В кошельке ${sum}. Свяжитесь с поддержкой, чтобы вернуть средства`;
    if (locale === 'en') return `Your wallet holds ${sum}. Contact support to get it paid out first`;
    return `Hamyoningizda ${sum} bor. Pulni qaytarib olish uchun support'ga murojaat qiling`;
  }
  if (locale === 'ru') return `Вы ведущий игры ${r.match_code}. Аккаунт будет удалён после игры`;
  if (locale === 'en') return `You are hosting match ${r.match_code}. The account will be deleted after it`;
  return `Siz ${r.match_code} o'yinining host'isiz. Akkaunt o'yindan keyin o'chiriladi`;
}

/** GDPR so'rovlari (DSR): eksport, o'chirish, grace davrida bekor qilish, holat va yuklab olish. */
@Controller('v1/me')
export class PrivacyController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly exports: DataExportService,
  ) {}

  private present(d: DsrRow, locale: Locale) {
    return {
      id: d.id,
      type: d.type,
      status: d.status,
      requested_at: iso(d.requested_at),
      due_at: iso(d.due_at),
      completed_at: iso(d.completed_at),
      ...(d.type === 'export'
        ? {
            download_url: d.downloadable ? `/v1/me/data-exports/${d.id}` : null,
            expires_at: iso(d.export_expires_at),
          }
        : {
            cancelled_at: iso(d.cancelled_at),
            blocked_reasons: d.blocked_reasons?.map((r) => ({
              ...r,
              ...(r.code === 'wallet_balance' ? { balance: money(r.amount, r.currency, locale) } : {}),
              message: reasonMessage(r, locale),
            })) ?? null,
          }),
    };
  }

  @Get('data-requests')
  async list(@CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    const list = await rows<DsrRow>(
      this.db,
      sql`SELECT ${DSR_COLUMNS} FROM data_subject_requests
          WHERE user_id = ${user.id} AND type IN ('export', 'erasure')
          ORDER BY requested_at DESC LIMIT 50`,
    );
    return { items: list.map((d) => this.present(d, locale)) };
  }

  /** Ochiq eksport so'rovi bo'lsa — o'sha qaytariladi (takroriy bosishlar yangi job yaratmaydi). */
  @Post('data-export')
  @HttpCode(202)
  async dataExport(@CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    const open = await one<DsrRow>(
      this.db,
      sql`SELECT ${DSR_COLUMNS} FROM data_subject_requests
          WHERE user_id = ${user.id} AND type = 'export' AND status IN ('received', 'in_progress')
          ORDER BY requested_at DESC LIMIT 1`,
    );
    if (open) return this.present(open, locale);
    const created = await one<DsrRow>(
      this.db,
      sql`INSERT INTO data_subject_requests (user_id, type) VALUES (${user.id}, 'export') RETURNING ${DSR_COLUMNS}`,
    );
    return this.present(created!, locale);
  }

  @Get('data-exports/:id')
  async download(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    const file = await this.exports.download(user.id, id);
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.size),
      'Cache-Control': 'no-store',
    });
    file.stream.on('error', () => res.destroy());
    file.stream.pipe(res);
  }

  /** 30 kunlik grace: shu muddatgacha DELETE /v1/me/erasure-request bilan bekor qilish mumkin. */
  @Delete()
  @HttpCode(202)
  async erase(@CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    try {
      const created = await one<DsrRow>(
        this.db,
        sql`INSERT INTO data_subject_requests (user_id, type, due_at)
            VALUES (${user.id}, 'erasure', now() + make_interval(days => ${this.env.ERASURE_GRACE_DAYS}))
            RETURNING ${DSR_COLUMNS}`,
      );
      return this.present(created!, locale);
    } catch (err) {
      // dsr_one_open_erasure: ochiq so'rov allaqachon bor
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) throw new AppError('ERASURE_PENDING');
      throw err;
    }
  }

  @Delete('erasure-request')
  async cancelErasure(@CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    const cancelled = await one<DsrRow>(
      this.db,
      sql`UPDATE data_subject_requests SET status = 'cancelled', cancelled_at = now()
          WHERE user_id = ${user.id} AND type = 'erasure' AND status IN ('received', 'in_progress')
          RETURNING ${DSR_COLUMNS}`,
    );
    if (!cancelled) throw new AppError('NOT_FOUND');
    return this.present(cancelled, locale);
  }
}
