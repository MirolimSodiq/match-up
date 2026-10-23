import { Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { CommerceModule } from '../commerce/commerce.module';
import { OpsAlerts } from '../common/ops-alerts';
import { ENV, type Env } from '../config/env';
import { AutoRefunds } from './auto-refunds';
import { ClickRefundAdapter, PaymeRefundAdapter, REFUND_ADAPTERS, type RefundAdapter, UzumRefundAdapter } from './refund.adapters';
import { RefundSettlement } from './refund-settlement';

/** Avto-refund job'i (`provider-refunds`, har daqiqa) — o'z navbatida, maintenance job'lariga to'siq bo'lmaydi. */
@Injectable()
export class RefundJobs implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('RefundJobs');
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly auto: AutoRefunds,
  ) {}

  async onModuleInit() {
    if (!this.env.RUN_WORKERS) return;
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue('refunds', { connection: this.connection });
    await this.queue.upsertJobScheduler(
      'provider-refunds',
      { every: 60_000 },
      { name: 'provider-refunds', opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );
    this.worker = new Worker('refunds', () => this.auto.run(), { connection: this.connection, concurrency: 1 });
    this.worker.on('failed', (job, err) => this.log.error(`${job?.name} xato: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }
}

/** Provider refund'lari: adapterlar, hisobga yozish (webhook'lar va admin uchun ham) va avto-refund job'i. */
@Module({
  imports: [CommerceModule],
  providers: [
    PaymeRefundAdapter,
    ClickRefundAdapter,
    UzumRefundAdapter,
    {
      provide: REFUND_ADAPTERS,
      inject: [PaymeRefundAdapter, ClickRefundAdapter, UzumRefundAdapter],
      useFactory: (...adapters: RefundAdapter[]) => adapters,
    },
    OpsAlerts,
    RefundSettlement,
    AutoRefunds,
    RefundJobs,
  ],
  exports: [RefundSettlement, AutoRefunds],
})
export class RefundsModule {}
