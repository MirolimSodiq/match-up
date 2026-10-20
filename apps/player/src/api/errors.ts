import type { Problem } from '@matchup/contracts';

/** Client tomonida paydo bo'ladigan kodlar (server Problem `code`'lariga qo'shimcha). */
export type ClientErrorCode = 'NETWORK' | 'UNKNOWN' | 'SOCIAL_NOT_CONFIGURED' | 'SOCIAL_EXPO_GO';

/**
 * RFC 9457 Problem Details asosidagi xato. UI matnni `code` bo'yicha lokal tarjimadan oladi,
 * `detail` (server tilida) faqat zaxira.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem?: Problem;
  readonly retryAfter?: number;

  constructor(opts: { status: number; code: string; problem?: Problem; retryAfter?: number }) {
    super(opts.problem?.detail ?? opts.code);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.problem = opts.problem;
    this.retryAfter = opts.retryAfter;
  }

  /** Client tomonidagi xato (server javobisiz), matni `errors.<code>` tarjimasidan. */
  static client(code: ClientErrorCode): ApiError {
    return new ApiError({ status: 0, code });
  }

  static network(cause?: unknown): ApiError {
    const e = new ApiError({ status: 0, code: 'NETWORK' });
    (e as { cause?: unknown }).cause = cause;
    return e;
  }

  static fromResponse(response: Response, body: unknown): ApiError {
    const problem = isProblem(body) ? body : undefined;
    const retry = Number(response.headers.get('Retry-After'));
    return new ApiError({
      status: response.status,
      code: problem?.code ?? (response.status >= 500 ? 'INTERNAL' : 'UNKNOWN'),
      problem,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
    });
  }
}

export function isProblem(v: unknown): v is Problem {
  return !!v && typeof v === 'object' && typeof (v as { code?: unknown }).code === 'string';
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}
