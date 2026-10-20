import { hostname } from 'node:os';
import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { EVENTS_STREAM } from '../../common/outbox';

/** Redis Stream yozuvi (OutboxRelay formati). */
export interface OutboxEvent {
  /** Stream entry id (`1729400000000-0`). */
  streamId: string;
  /** outbox_events.id — idempotentlik kaliti. */
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export type EventHandler = (event: OutboxEvent) => Promise<void>;

type StreamEntry = [id: string, fields: string[]];

const MAX_DELIVERIES = 5;
const STALE_MS = 60_000;
export const DEAD_LETTER_STREAM = `${EVENTS_STREAM}:dead`;

export function parseEntry([streamId, fields]: StreamEntry): OutboxEvent {
  const f: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) f[fields[i]!] = fields[i + 1]!;
  const [aggregateType = '', aggregateId = ''] = (f.aggregate ?? '').split(':');
  let payload: Record<string, unknown> = {};
  try {
    payload = f.payload ? (JSON.parse(f.payload) as Record<string, unknown>) : {};
  } catch {
    // buzilgan payload — handler bo'sh obyekt bilan ishlaydi
  }
  return { streamId, id: f.id ?? streamId, type: f.type ?? '', aggregateType, aggregateId, payload };
}

/**
 * Consumer group (XREADGROUP + XACK). Har bir guruh event'ni bir marta oladi; bir nechta instance
 * bitta guruhda ishlasa — event ulardan faqat biriga tushadi. Handler xato bersa event ACK
 * qilinmaydi va keyinroq (XAUTOCLAIM) qayta olinadi; 5 urinishdan keyin dead-letter stream'ga.
 * Handler'lar idempotent bo'lishi shart (at-least-once).
 */
export class StreamConsumer {
  private readonly log: Logger;
  private readonly consumer = `${hostname()}-${process.pid}`;
  private blocking?: Redis;
  private running?: Promise<void>;
  private stopped = false;
  private lastReclaim = 0;

  constructor(
    private readonly redis: Redis,
    readonly group: string,
    private readonly handler: EventHandler,
  ) {
    this.log = new Logger(`Stream:${group}`);
  }

  /** Guruh yo'q bo'lsa — faqat yangi event'lardan ('$') boshlab yaratiladi. */
  async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', EVENTS_STREAM, this.group, '$', 'MKSTREAM');
    } catch (err) {
      if (!String((err as Error).message).includes('BUSYGROUP')) throw err;
    }
  }

  start(): void {
    if (this.running) return;
    const blocking = (this.blocking = this.redis.duplicate());
    this.running = (async () => {
      await this.ensureGroup();
      this.log.log(`consumer ${this.consumer} ishga tushdi`);
      while (!this.stopped) {
        try {
          if (Date.now() - this.lastReclaim > STALE_MS / 2) {
            this.lastReclaim = Date.now();
            await this.reclaimStale();
          }
          await this.readBatch(blocking, 5000);
        } catch (err) {
          if (this.stopped) break;
          this.log.error(`o'qishda xato: ${(err as Error).message}`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.blocking?.disconnect();
    await this.running?.catch(() => undefined);
  }

  /** Testlar va qo'lda ishga tushirish uchun: kutmasdan hamma yangi event'larni qayta ishlaydi. */
  async drain(): Promise<number> {
    await this.ensureGroup();
    let total = 0;
    for (;;) {
      const n = await this.readBatch(this.redis);
      total += n;
      if (n === 0) return total;
    }
  }

  private async readBatch(conn: Redis, blockMs?: number): Promise<number> {
    const res = (await (blockMs === undefined
      ? conn.xreadgroup('GROUP', this.group, this.consumer, 'COUNT', 100, 'STREAMS', EVENTS_STREAM, '>')
      : conn.xreadgroup('GROUP', this.group, this.consumer, 'COUNT', 100, 'BLOCK', blockMs, 'STREAMS', EVENTS_STREAM, '>'))) as
      | [string, StreamEntry[]][]
      | null;
    const entries = res?.[0]?.[1] ?? [];
    for (const entry of entries) await this.process(entry);
    return entries.length;
  }

  private async process(entry: StreamEntry): Promise<boolean> {
    const event = parseEntry(entry);
    try {
      await this.handler(event);
      await this.redis.xack(EVENTS_STREAM, this.group, event.streamId);
      return true;
    } catch (err) {
      this.log.error(`${event.type} (${event.id}) qayta ishlanmadi: ${(err as Error).message}`);
      return false;
    }
  }

  /** O'lgan consumer'lar yoki xato bergan event'lar: qayta urinish yoki dead-letter. */
  async reclaimStale(): Promise<number> {
    const pending = (await this.redis.xpending(EVENTS_STREAM, this.group, 'IDLE', STALE_MS, '-', '+', 100)) as [
      string,
      string,
      number,
      number,
    ][];
    let n = 0;
    for (const [id, , , deliveries] of pending) {
      const claimed = (await this.redis.xclaim(EVENTS_STREAM, this.group, this.consumer, STALE_MS, id)) as StreamEntry[];
      const entry = claimed[0];
      if (!entry) {
        // Stream'dan o'chirilgan (MAXLEN) — faqat ACK
        await this.redis.xack(EVENTS_STREAM, this.group, id);
        continue;
      }
      if (deliveries >= MAX_DELIVERIES) {
        this.log.error(`event ${id} ${deliveries} marta muvaffaqiyatsiz — dead-letter`);
        await this.redis.xadd(DEAD_LETTER_STREAM, 'MAXLEN', '~', '10000', '*', 'group', this.group, 'stream_id', id, ...entry[1]);
        await this.redis.xack(EVENTS_STREAM, this.group, id);
        continue;
      }
      if (await this.process(entry)) n++;
    }
    return n;
  }
}
