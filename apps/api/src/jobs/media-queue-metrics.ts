import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

/** services/media-worker standart consumer group'i (MEDIA_JOBS_GROUP) — ikkala lane'da bir xil. */
export const MEDIA_WORKER_GROUP = 'media-worker';
export const METRICS_NAMESPACE = 'MatchUp/MediaQueue';

export type Lane = 'default' | 'recording';

export interface LaneStats {
  /** Hali yetkazilmagan + yetkazilgan, lekin ACK qilinmagan (ishlanayotgan yoki qulagan worker'niki). */
  backlog: number;
  /** Yetkazilgan, ACK qilinmagan — hozir ishlanayotganlar. */
  in_flight: number;
  /** Eng eski tugallanmagan xabar yoshi (soniya); navbat bo'sh bo'lsa 0. */
  oldest_age_s: number;
}

/** Redis Stream id `<ms>-<seq>` -> ms. */
const idMs = (id: string) => Number(id.split('-')[0]);

/** XINFO GROUPS javobi: [k1, v1, k2, v2, ...] juftliklari. */
function pairs(row: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i + 1 < row.length; i += 2) out[String(row[i])] = row[i + 1];
  return out;
}

/**
 * Media navbati metrikasi (har 60 s, `media-queue-metrics`): lane bo'yicha backlog -> CloudWatch.
 * Media worker autoscaling'i shunga tayanadi (infra/terraform/modules/cell/media_worker.tf): backlog'da
 * ishlov beruvchi task'dan ortiq job bo'lsa — kengayadi, navbat bo'sh tursa — qisqaradi (yozuv lane'i 0 gacha).
 * Shuning uchun metrikani worker emas, API chiqaradi: yozuv lane'ida task 0 ta bo'lishi mumkin.
 *
 * Yuborish — CloudWatch Embedded Metric Format: stdout'ga bitta JSON qator, ECS awslogs uni metrikaga
 * aylantiradi (IAM huquqi va SDK kerak emas). CLOUDWATCH_METRICS_CELL berilmasa (lokal, test) — faqat debug log.
 */
@Injectable()
export class MediaQueueMetrics {
  private readonly log = new Logger('MediaQueueMetrics');
  /** EMF qatorlari chiqadigan joy (testlar almashtiradi). */
  write: (line: string) => void = (line) => process.stdout.write(line);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run(now = Date.now()): Promise<Record<Lane, LaneStats>> {
    const lanes: Record<Lane, string> = { default: this.env.MEDIA_JOBS_STREAM, recording: this.env.MEDIA_RECORDING_JOBS_STREAM };
    const result = {} as Record<Lane, LaneStats>;
    for (const [lane, stream] of Object.entries(lanes) as [Lane, string][]) {
      result[lane] = await this.lane(stream, now);
      const cell = this.env.CLOUDWATCH_METRICS_CELL;
      if (cell) this.write(JSON.stringify(emf(cell, lane, result[lane], now)) + '\n');
    }
    this.log.debug(`media navbati: ${JSON.stringify(result)}`);
    return result;
  }

  async lane(stream: string, now = Date.now()): Promise<LaneStats> {
    let groups: unknown[][];
    try {
      groups = (await this.redis.xinfo('GROUPS', stream)) as unknown[][];
    } catch (err) {
      // Stream hali yaratilmagan — navbat bo'sh
      if (/no such key/i.test(String((err as Error).message))) return { backlog: 0, in_flight: 0, oldest_age_s: 0 };
      throw err;
    }
    const g = groups.map(pairs).find((x) => x.name === MEDIA_WORKER_GROUP);
    const lastDelivered = g ? String(g['last-delivered-id']) : '0-0';
    const inFlight = g ? Number(g.pending) : 0;

    // lag — guruhga hali yetkazilmagan; Valkey hisoblay olmasa (null) yoki guruh yo'q — sanab chiqamiz
    let lag = g && g.lag !== null && g.lag !== undefined ? Number(g.lag) : undefined;
    if (lag === undefined) lag = (await this.redis.xrange(stream, `(${lastDelivered}`, '+', 'COUNT', 10_000)).length;

    let oldest = Infinity;
    if (inFlight > 0) {
      const [, minId] = (await this.redis.xpending(stream, MEDIA_WORKER_GROUP)) as [number, string | null, string | null, unknown];
      if (minId) oldest = Math.min(oldest, idMs(minId));
    }
    if (lag > 0) {
      const [first] = await this.redis.xrange(stream, `(${lastDelivered}`, '+', 'COUNT', 1);
      if (first) oldest = Math.min(oldest, idMs(first[0]));
    }
    return {
      backlog: lag + inFlight,
      in_flight: inFlight,
      oldest_age_s: Number.isFinite(oldest) ? Math.max(0, Math.round((now - oldest) / 1000)) : 0,
    };
  }
}

/** CloudWatch EMF hujjati: Cell + Lane o'lchamlari bo'yicha uchta metrika. */
export function emf(cell: string, lane: Lane, s: LaneStats, now: number) {
  return {
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: METRICS_NAMESPACE,
          Dimensions: [['Cell', 'Lane']],
          Metrics: [
            { Name: 'Backlog', Unit: 'Count' },
            { Name: 'InFlight', Unit: 'Count' },
            { Name: 'OldestJobAgeSeconds', Unit: 'Seconds' },
          ],
        },
      ],
    },
    Cell: cell,
    Lane: lane,
    Backlog: s.backlog,
    InFlight: s.in_flight,
    OldestJobAgeSeconds: s.oldest_age_s,
  };
}
