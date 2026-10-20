import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DB, type Db, rows } from '../db/db';
import { WaitlistService } from '../matches/waitlist.service';
import { REDIS } from '../redis/redis.module';
import { loadMatchCtx, mapUrl, matchParams, NotificationEvents } from './events/notification-events';
import { StreamConsumer } from './events/stream-consumer';
import { type NotificationDraft, NotificationsService } from './notifications.service';
import { RealtimeEvents } from './realtime/realtime-events';

/**
 * Outbox stream consumer'lari: `notifications` (push + in-app) va `realtime` (WebSocket) —
 * alohida consumer group'lar, shuning uchun sekin push provayderi WS yangilanishlarini ushlab turmaydi.
 */
@Injectable()
export class EventConsumers implements OnApplicationBootstrap, OnModuleDestroy {
  readonly notifications: StreamConsumer;
  readonly realtime: StreamConsumer;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) redis: Redis,
    notificationEvents: NotificationEvents,
    realtimeEvents: RealtimeEvents,
  ) {
    this.notifications = new StreamConsumer(redis, 'notifications', (e) => notificationEvents.handle(e));
    this.realtime = new StreamConsumer(redis, 'realtime', (e) => realtimeEvents.handle(e));
  }

  /** Gateway'lar init bo'lgandan keyin (WS server tayyor). */
  onApplicationBootstrap() {
    if (!this.env.RUN_WORKERS) return;
    this.notifications.start();
    this.realtime.start();
  }

  async onModuleDestroy() {
    await Promise.all([this.notifications.stop(), this.realtime.stop()]);
  }

  async ensureGroups() {
    await Promise.all([this.notifications.ensureGroup(), this.realtime.ensureGroup()]);
  }

  /** Yangi event'larni darhol qayta ishlash (testlar / qo'lda). */
  async drain() {
    return { realtime: await this.realtime.drain(), notifications: await this.notifications.drain() };
  }
}

type ReminderKind = '24h' | '2h';

/** BullMQ job'lari (JobsService chaqiradi): eslatmalar, kutish ro'yxati takliflari, retry, receipt'lar. */
@Injectable()
export class NotificationJobs {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly events: NotificationEvents,
    private readonly waitlist: WaitlistService,
  ) {}

  /**
   * T-24h va T-2h eslatmalari confirmed o'yinchilarga. Har biri bir marta (`reminder_<kind>:<booking>`).
   * Booking eslatma vaqtidan keyin tasdiqlangan bo'lsa (masalan, o'yinga 5 soat qolganda) — 24h eslatmasi yuborilmaydi;
   * job kechiksa ham 24h eslatmasi T-2h dan keyin yuborilmaydi (o'rniga 2h eslatmasi ketadi).
   */
  async reminders(limit = 500): Promise<{ queued: number }> {
    const due = await rows<{ booking_id: string; user_id: string; match_id: string; kind: ReminderKind }>(
      this.db,
      sql`SELECT b.id AS booking_id, b.user_id, b.match_id, k.kind
          FROM matches m
          JOIN bookings b ON b.match_id = m.id AND b.status = 'confirmed'
          CROSS JOIN (VALUES ('24h', interval '24 hours'), ('2h', interval '2 hours')) AS k(kind, lead)
          WHERE m.status IN ('open', 'full') AND m.starts_at > now()
            AND m.starts_at <= now() + interval '24 hours'
            AND m.starts_at - k.lead <= now()
            AND b.confirmed_at <= m.starts_at - k.lead
            AND (k.kind = '2h' OR m.starts_at - interval '2 hours' > now())
            AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.dedupe_key = 'reminder_' || k.kind || ':' || b.id::text)
          ORDER BY m.starts_at
          LIMIT ${limit}`,
    );
    if (!due.length) return { queued: 0 };
    const drafts: NotificationDraft[] = [];
    for (const matchId of new Set(due.map((d) => d.match_id))) {
      const m = await loadMatchCtx(this.db, matchId);
      if (!m) continue;
      for (const d of due.filter((x) => x.match_id === matchId)) {
        drafts.push({
          userId: d.user_id,
          type: d.kind === '24h' ? 'match.reminder_24h' : 'match.reminder_2h',
          dedupeKey: `reminder_${d.kind}:${d.booking_id}`,
          params: (l) => matchParams(m, l),
          data: { url: `/booking/${d.booking_id}`, booking_id: d.booking_id, match_id: matchId, map_url: mapUrl(m) },
          ttlSec: d.kind === '24h' ? 6 * 3600 : 3600,
        });
      }
    }
    return { queued: (await this.notifications.notify(drafts)).length };
  }

  /** Muddati o'tgan kutish ro'yxati takliflari -> keyingi navbatdagiga. */
  async waitlistOffers(): Promise<{ matches: number; offered: number }> {
    const matchIds = await this.waitlist.expireOffers();
    let offered = 0;
    for (const id of matchIds) offered += await this.events.offerWaitlist(id);
    return { matches: matchIds.length, offered };
  }

  retryQueued() {
    return this.notifications.retryQueued();
  }

  checkReceipts() {
    return this.notifications.checkReceipts();
  }
}
