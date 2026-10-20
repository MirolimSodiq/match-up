import { sql } from 'drizzle-orm';
import type { Executor } from '../db/db';

export type DomainEvent =
  | 'BookingHeld'
  | 'BookingConfirmed'
  | 'BookingCancelled'
  | 'BookingExpired'
  | 'MatchPublished'
  | 'MatchFull'
  | 'MatchCancelled'
  | 'MatchCompleted'
  | 'SlotsReleased'
  | 'PaymentSucceeded'
  | 'RefundRequested'
  | 'RefundIssued'
  | 'HostOffered'
  | 'HostAssigned'
  | 'HostArrived'
  | 'PlayerCheckedIn'
  | 'DataExportReady'
  | 'UserErased';

/** OutboxRelay event'larni shu Redis Stream'ga chiqaradi; consumer group'lar undan o'qiydi. */
export const EVENTS_STREAM = 'matchup:events';

/** Transactional outbox: event biznes o'zgarish bilan BIR tranzaksiyada yoziladi. */
export async function emit(
  ex: Executor,
  aggregateType: string,
  aggregateId: string,
  event: DomainEvent,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await ex.execute(
    sql`INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
        VALUES (${aggregateType}, ${aggregateId}, ${event}, ${JSON.stringify(payload)}::jsonb)`,
  );
}
