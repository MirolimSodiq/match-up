import {
  ArgumentsHost,
  Catch,
  createParamDecorator,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestMiddleware,
  PipeTransform,
  SetMetadata,
  Body,
  Query,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError, type ErrorCode, errorMessage, MESSAGES } from './errors';
import { DEFAULT_LOCALE, type Locale, parseAcceptLanguage } from './i18n';

export type UserRole = 'player' | 'host' | 'admin' | 'super_admin' | 'venue_partner';

export interface AuthUser {
  id: string;
  roles: UserRole[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      locale?: Locale;
      sessionFamily?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Dekoratorlar
// ---------------------------------------------------------------------------
export const IS_PUBLIC = 'matchup:isPublic';
export const OPTIONAL_AUTH = 'matchup:optionalAuth';
export const ROLES = 'matchup:roles';

/** Auth talab qilinmaydi. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Token bo'lsa tekshiriladi va req.user to'ldiriladi, bo'lmasa ham o'tkaziladi. */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);
/** Kamida bitta rol talab qilinadi (admin/super_admin har doim o'tadi). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest<Request>().user;
});

export const ReqLocale = createParamDecorator((_: unknown, ctx: ExecutionContext): Locale => {
  return ctx.switchToHttp().getRequest<Request>().locale ?? DEFAULT_LOCALE;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest<Request>().ip ?? 'unknown';
});

// ---------------------------------------------------------------------------
// Zod validatsiya
// ---------------------------------------------------------------------------
@Injectable()
export class ZodPipe<S extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const res = this.schema.safeParse(value);
    if (!res.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        {},
        res.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', code: i.code, message: i.message })),
      );
    }
    return res.data;
  }
}

export const ZBody = (schema: z.ZodType) => Body(new ZodPipe(schema));
export const ZQuery = (schema: z.ZodType) => Query(new ZodPipe(schema));

/** `Idempotency-Key` — majburiy UUID header. */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const v = ctx.switchToHttp().getRequest<Request>().headers['idempotency-key'];
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new AppError('VALIDATION_FAILED', {}, [
      { field: 'Idempotency-Key', code: 'required', message: 'Idempotency-Key header (UUID) majburiy' },
    ]);
  }
  return v.toLowerCase();
});

// ---------------------------------------------------------------------------
// Locale middleware
// ---------------------------------------------------------------------------
@Injectable()
export class LocaleMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    req.locale = parseAcceptLanguage(req.headers['accept-language']) ?? DEFAULT_LOCALE;
    next();
  }
}

// ---------------------------------------------------------------------------
// RFC 9457 Problem Details
// ---------------------------------------------------------------------------
const HTTP_TO_CODE: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'BAD_REQUEST',
  415: 'BAD_REQUEST',
  429: 'RATE_LIMITED',
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const locale = req.locale ?? DEFAULT_LOCALE;

    let err: AppError;
    let status: number;
    if (exception instanceof AppError) {
      err = exception;
      status = err.status;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      err = new AppError(HTTP_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'));
    } else {
      this.log.error({ err: exception, path: req.originalUrl }, 'Unhandled error');
      if (process.env.E2E_DEBUG) console.error(exception);
      err = new AppError('INTERNAL');
      status = 500;
    }

    const body = {
      type: `https://docs.matchup.example/errors/${err.code.toLowerCase().replace(/_/g, '-')}`,
      title: MESSAGES[err.code].en.replace(/\s*\(.*\)$/, ''),
      status,
      code: err.code,
      detail: errorMessage(err.code, locale, err.params),
      instance: req.originalUrl,
      request_id: String((req as unknown as { id?: unknown }).id ?? ''),
      ...(err.errors ? { errors: err.errors } : {}),
    };
    if (err.headers) res.set(err.headers);
    res.status(status).type('application/problem+json').send(JSON.stringify(body));
  }
}

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------
export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T>(cursor: string | undefined): T | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw new AppError('VALIDATION_FAILED', {}, [{ field: 'cursor', code: 'invalid', message: 'cursor yaroqsiz' }]);
  }
}
