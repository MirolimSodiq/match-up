import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Db, iso, one, rows } from '../../db/db';
import type { OutboxEvent } from '../events/stream-consumer';
import { type BookingState, RealtimeGateway } from './realtime.gateway';

/**
 * Outbox event -> WebSocket. Payload'lar holat snapshot'i (DB'dan o'qiladi), shuning uchun
 * event qayta yoki boshqa tartibda kelsa ham mijoz oxirgi holatni ko'radi.
 */
@Injectable()
export class RealtimeEvents {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly gateway: RealtimeGateway,
  ) {}

  async handle(e: OutboxEvent): Promise<void> {
    switch (e.type) {
      case 'BookingHeld':
      case 'BookingConfirmed':
      case 'BookingCancelled':
      case 'BookingExpired': {
        const b = await this.bookingUpdated(e.aggregateId);
        const matchId = typeof e.payload.match_id === 'string' ? e.payload.match_id : b?.match_id;
        if (matchId) await this.slotsUpdated(matchId);
        return;
      }
      case 'SlotsReleased':
      case 'MatchFull':
      case 'MatchPublished':
      case 'MatchCancelled':
      case 'MatchCompleted':
        return this.slotsUpdated(e.aggregateId);
      case 'HostOffered':
        return this.offerCreated(e);
      case 'HostAssigned':
        return this.offerClosed(e);
      case 'UserErased':
        // Erasure'dan keyin ilova booking/host xonalarida qolmasin; qayta ulanish handshake'da rad etiladi
        this.gateway.disconnectUser(e.aggregateId);
        return;
      default:
        return;
    }
  }

  private async slotsUpdated(matchId: string) {
    const s = await this.gateway.matchState(matchId);
    if (s) this.gateway.emit(`match:${matchId}`, 'slots.updated', s);
  }

  private async bookingUpdated(bookingId: string): Promise<BookingState | undefined> {
    const b = await one<BookingState>(
      this.db,
      sql`SELECT id AS booking_id, match_id, status FROM bookings WHERE id = ${bookingId}`,
    );
    if (b) this.gateway.emit(`booking:${bookingId}`, 'booking.updated', b);
    return b;
  }

  private async offerCreated(e: OutboxEvent) {
    const hostId = String(e.payload.host_user_id ?? '');
    const a = await one<{ id: string; offer_expires_at: string; status: string }>(
      this.db,
      sql`SELECT id, offer_expires_at, status FROM host_assignments WHERE match_id = ${e.aggregateId} AND host_user_id = ${hostId}`,
    );
    if (!a || a.status !== 'offered') return;
    this.gateway.emit(`host:${hostId}`, 'offer.created', {
      assignment_id: a.id,
      match_id: e.aggregateId,
      offer_expires_at: iso(a.offer_expires_at),
    });
  }

  /** Boshqa host qabul qildi — qolgan host'lar ilovasida taklif yopiladi. */
  private async offerClosed(e: OutboxEvent) {
    const others = await rows<{ id: string; host_user_id: string }>(
      this.db,
      sql`SELECT id, host_user_id FROM host_assignments
          WHERE match_id = ${e.aggregateId} AND id <> ${String(e.payload.assignment_id ?? '')}::uuid AND status = 'expired'`,
    );
    for (const o of others) {
      this.gateway.emit(`host:${o.host_user_id}`, 'offer.closed', { assignment_id: o.id, match_id: e.aggregateId, reason: 'taken' });
    }
  }
}
