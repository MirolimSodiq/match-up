import { Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { AdminModule } from '../admin/admin.module';
import { AdminService } from '../admin/admin.service';
import { CommerceModule } from '../commerce/commerce.module';
import { SeatsService } from '../commerce/seats.service';
import { DB, type Db, rows } from '../db/db';
import { HostModule } from '../host/host.module';
import { DispatchService } from '../host/host.service';
import { REDIS } from '../redis/redis.module';

export const EVENTS_STREAM = 'matchup:events';

/** Outbox relay: yozilgan domain event'larni Redis Stream'ga chiqaradi (consumer'lar idempotent). */
@Injectable()
export class OutboxRelay {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async run(batch = 200): Promise<number> {
    return this.db.transaction(async (tx) => {
      const events = await rows<{ id: string; aggregate_type: string; aggregate_id: string; event_type: string; payload: unknown }>(
        tx,
        sql`SELECT id, aggregate_type, aggregate_id, event_type, payload FROM outbox_events
            WHERE published_at IS NULL ORDER BY created_at LIMIT ${batch} FOR UPDATE SKIP LOCKED`,
      );
      for (const e of events) {
        await this.redis.xadd(
          EVENTS_STREAM, 'MAXLEN', '~', '100000', '*',
          'id', e.id, 'type', e.event_type, 'aggregate', `${e.aggregate_type}:${e.aggregate_id}`, 'payload', JSON.stringify(e.payload),
        );
      }
      if (events.length) {
        await tx.execute(
          sql`UPDATE outbox_events SET published_at = now() WHERE id = ANY(string_to_array(${events.map((e) => e.id).join(',')}, ',')::uuid[])`,
        );
      }
      return events.length;
    });
  }
}

/** BullMQ job scheduler: hold expiry, host dispatch, minimum o'yinchi tekshiruvi, outbox relay. */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly seats: SeatsService,
    private readonly dispatch: DispatchService,
    private readonly admin: AdminService,
    private readonly outbox: OutboxRelay,
  ) {}

  async onModuleInit() {
    if (!this.env.RUN_WORKERS) return;
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue('maintenance', { connection: this.connection });
    const every = { 'expire-holds': 30_000, 'dispatch-hosts': 60_000, 'cancel-underfilled': 300_000, 'outbox-relay': 2_000 };
    for (const [name, ms] of Object.entries(every)) {
      await this.queue.upsertJobScheduler(name, { every: ms }, { name, opts: { removeOnComplete: 100, removeOnFail: 500 } });
    }
    this.worker = new Worker('maintenance', (job) => this.process(job.name), { connection: this.connection, concurrency: 1 });
    this.worker.on('failed', (job, err) => this.log.error(`${job?.name} xato: ${err.message}`));
    this.log.log('Background job\'lar ishga tushdi');
  }

  async process(name: string) {
    switch (name) {
      case 'expire-holds':
        return { expired: await this.seats.expireDue() };
      case 'dispatch-hosts':
        return this.dispatch.run();
      case 'cancel-underfilled':
        return { cancelled: await this.admin.cancelUnderfilled() };
      case 'outbox-relay':
        return { published: await this.outbox.run() };
      default:
        throw new Error(`Noma'lum job: ${name}`);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }
}

@Module({
  imports: [CommerceModule, HostModule, AdminModule],
  providers: [JobsService, OutboxRelay],
  exports: [JobsService, OutboxRelay],
})
export class JobsModule {}
