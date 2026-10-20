import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import type { Executor } from '../db/db';

/** Admin mutatsiyasini kim, qayerdan va qaysi so'rov bilan qilgani (audit_logs uchun). */
export interface Actor {
  id: string;
  ip: string | null;
  requestId: string | null;
}

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request & { id?: unknown }>();
  return {
    id: req.user!.id,
    ip: req.ip ?? null,
    requestId: req.id === undefined ? null : String(req.id),
  };
});

/**
 * Har bir admin mutatsiyasi o'zgarish bilan BIR tranzaksiyada audit_logs'ga yoziladi.
 * Foydalanuvchining o'z xavfsizlik amallari (identity bog'lash) — `role = 'player'`; tizim job'lari — `actor = null`.
 */
export async function audit(
  ex: Executor,
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string | null,
  changes: Record<string, unknown> = {},
  role: 'admin' | 'player' | null = 'admin',
): Promise<void> {
  await ex.execute(
    sql`INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, changes, ip, request_id)
        VALUES (${actor?.id ?? null}, ${actor ? role : null}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify(changes)}::jsonb,
                ${actor?.ip ?? null}::inet, ${actor?.requestId ?? null})`,
  );
}
