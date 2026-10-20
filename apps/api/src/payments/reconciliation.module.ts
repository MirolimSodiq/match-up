import { Controller, Get, HttpCode, Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { z } from 'zod';
import { type Actor, CurrentActor } from '../admin/audit';
import { bool, csv, DateTime, Page } from '../admin/schemas';
import { ENV, type Env } from '../config/env';
import { AppError } from '../common/errors';
import { IdempotencyKey, ReqLocale, Roles, ZBody, ZQuery } from '../common/http';
import type { Locale } from '../common/i18n';
import {
  ClickReconciliationAdapter,
  PaymeReconciliationAdapter,
  RECON_PROVIDERS,
  RECONCILIATION_ADAPTERS,
  type ReconciliationAdapter,
  type ReconProvider,
  UzumReconciliationAdapter,
} from './reconciliation.adapters';
import { ReconciliationService } from './reconciliation.service';

const Provider = z.enum(RECON_PROVIDERS as [ReconProvider, ...ReconProvider[]]);
const MAX_PERIOD_MS = 31 * 86_400_000;

const RunList = z.object({
  provider: csv(Provider).optional(),
  status: csv(z.enum(['running', 'completed', 'failed'])).optional(),
  has_diffs: bool.optional(),
  date_from: DateTime.optional(),
  date_to: DateTime.optional(),
  ...Page,
});

const RunCreate = z
  .object({
    /** Bo'lmasa — davr bo'yicha ro'yxat bera oladigan barcha provider'lar. */
    provider: Provider.optional(),
    date_from: DateTime,
    date_to: DateTime,
  })
  .refine((b) => new Date(b.date_from) < new Date(b.date_to), { path: ['date_to'], message: 'date_to > date_from' })
  .refine((b) => new Date(b.date_to).getTime() - new Date(b.date_from).getTime() <= MAX_PERIOD_MS, {
    path: ['date_to'],
    message: "davr 31 kundan oshmasin",
  });

@Roles('admin')
@Controller('v1/admin/finance/reconciliation')
export class AdminReconciliationController {
  constructor(private readonly recon: ReconciliationService) {}

  @Get()
  list(@ZQuery(RunList) q: z.infer<typeof RunList>) {
    return this.recon.list(q);
  }

  @Get(':runId')
  detail(@Param('runId', ParseUUIDPipe) id: string, @ReqLocale() locale: Locale) {
    return this.recon.detail(id, locale);
  }

  /** Qo'lda solishtirish: sinxron bajariladi (bir kunlik hajm — bir necha soniya), natija darhol qaytadi. */
  @Post()
  @HttpCode(201)
  async create(@ZBody(RunCreate) body: z.infer<typeof RunCreate>, @IdempotencyKey() _key: string, @CurrentActor() actor: Actor) {
    let adapters: ReconciliationAdapter[];
    if (body.provider) {
      const a = this.recon.adapter(body.provider);
      const reason = a ? a.unsupported : 'adapter yo\'q';
      if (reason !== null) throw new AppError('VALIDATION_FAILED', {}, [{ field: 'provider', code: 'unsupported', message: reason }]);
      adapters = [a!];
    } else {
      adapters = this.recon.supported();
      if (!adapters.length) {
        throw new AppError('VALIDATION_FAILED', {}, [
          { field: 'provider', code: 'unsupported', message: "Davr bo'yicha ro'yxat bera oladigan provider yo'q" },
        ]);
      }
    }
    const from = new Date(body.date_from);
    const to = new Date(body.date_to);
    const items = [];
    for (const a of adapters) items.push(this.recon.presentRun(await this.recon.run(a.provider, from, to, actor)));
    return { items };
  }
}

/**
 * Kechki reconciliation (BullMQ, alohida `reconciliation` navbati — uzoq davom etsa ham `maintenance`
 * navbatidagi hold/outbox job'larini to'smaydi). Cron: RECONCILE_CRON, Asia/Tashkent.
 */
@Injectable()
export class ReconciliationJobs implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ReconciliationJobs');
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly recon: ReconciliationService,
  ) {}

  async onModuleInit() {
    if (!this.env.RUN_WORKERS) return;
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue('reconciliation', { connection: this.connection });
    await this.queue.upsertJobScheduler(
      'nightly-reconcile',
      { pattern: this.env.RECONCILE_CRON, tz: 'Asia/Tashkent' },
      { name: 'nightly-reconcile', opts: { removeOnComplete: 60, removeOnFail: 60 } },
    );
    this.worker = new Worker('reconciliation', () => this.recon.nightly(), { connection: this.connection, concurrency: 1 });
    this.worker.on('failed', (job, err) => this.log.error(`${job?.name} xato: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }
}

@Module({
  controllers: [AdminReconciliationController],
  providers: [
    PaymeReconciliationAdapter,
    ClickReconciliationAdapter,
    UzumReconciliationAdapter,
    {
      provide: RECONCILIATION_ADAPTERS,
      inject: [PaymeReconciliationAdapter, ClickReconciliationAdapter, UzumReconciliationAdapter],
      useFactory: (...adapters: ReconciliationAdapter[]) => adapters,
    },
    ReconciliationService,
    ReconciliationJobs,
  ],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
