import type Redis from 'ioredis';
import { ENV, type Env } from '../src/config/env';
import { MEDIA_WORKER_GROUP, MediaQueueMetrics, METRICS_NAMESPACE } from '../src/jobs/media-queue-metrics';
import { REDIS } from '../src/redis/redis.module';
import { createTestApp, uuid, type TestCtx } from './helpers';

describe('Media navbati metrikasi (worker autoscaling)', () => {
  let ctx: TestCtx;
  let redis: Redis;
  let metrics: MediaQueueMetrics;

  beforeAll(async () => {
    ctx = await createTestApp();
    redis = ctx.app.get(REDIS);
    metrics = ctx.app.get(MediaQueueMetrics);
  });
  afterAll(() => ctx.close());

  it("backlog = yetkazilmagan + ACK qilinmagan; eng eski xabar yoshi; guruh yo'q va stream yo'q holatlari", async () => {
    const stream = `test:media-jobs:${uuid()}`;
    const now = Date.now();
    expect(await metrics.lane(stream, now)).toEqual({ backlog: 0, in_flight: 0, oldest_age_s: 0 });

    // 3 ta job: 5, 3 va 1 daqiqa oldin navbatga qo'yilgan; worker guruhi hali yo'q
    for (const minAgo of [5, 3, 1]) await redis.xadd(stream, `${now - minAgo * 60_000}-0`, 'job_id', uuid());
    expect(await metrics.lane(stream, now)).toEqual({ backlog: 3, in_flight: 0, oldest_age_s: 300 });

    // Worker birinchisini oldi (ACK qilinmagan) — hali backlog'da, eng eski u
    await redis.xgroup('CREATE', stream, MEDIA_WORKER_GROUP, '0');
    const read = (await redis.xreadgroup('GROUP', MEDIA_WORKER_GROUP, 'w1', 'COUNT', 1, 'STREAMS', stream, '>')) as [string, [string, string[]][]][];
    const firstId = read[0]![1][0]![0];
    expect(await metrics.lane(stream, now)).toEqual({ backlog: 3, in_flight: 1, oldest_age_s: 300 });

    // ACK — eng eskisi endi navbatdagi ikkinchisi
    await redis.xack(stream, MEDIA_WORKER_GROUP, firstId);
    expect(await metrics.lane(stream, now)).toEqual({ backlog: 2, in_flight: 0, oldest_age_s: 180 });

    // Hammasi bajarildi: stream'da yozuvlar qoladi (MAXLEN), lekin backlog yo'q
    const rest = (await redis.xreadgroup('GROUP', MEDIA_WORKER_GROUP, 'w1', 'COUNT', 10, 'STREAMS', stream, '>')) as [string, [string, string[]][]][];
    for (const [id] of rest[0]![1]) await redis.xack(stream, MEDIA_WORKER_GROUP, id);
    expect(await redis.xlen(stream)).toBe(3);
    expect(await metrics.lane(stream, now)).toEqual({ backlog: 0, in_flight: 0, oldest_age_s: 0 });
    await redis.del(stream);
  });

  it("run: har lane uchun CloudWatch EMF qatori (faqat CLOUDWATCH_METRICS_CELL berilganda)", async () => {
    const env = ctx.app.get<Env>(ENV);
    const lines: string[] = [];
    metrics.write = (line) => lines.push(line);
    try {
      const silent = await metrics.run();
      expect(Object.keys(silent)).toEqual(['default', 'recording']);
      expect(lines).toEqual([]);

      env.CLOUDWATCH_METRICS_CELL = 'matchup-test';
      const now = Date.now();
      const stats = await metrics.run(now);
      expect(lines).toHaveLength(2);
      expect(lines.every((l) => l.endsWith('\n') && !l.slice(0, -1).includes('\n'))).toBe(true);
      const docs = lines.map((l) => JSON.parse(l));
      expect(docs.map((d) => d.Lane)).toEqual(['default', 'recording']);
      expect(docs[1]).toEqual({
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
        Cell: 'matchup-test',
        Lane: 'recording',
        Backlog: stats.recording.backlog,
        InFlight: stats.recording.in_flight,
        OldestJobAgeSeconds: stats.recording.oldest_age_s,
      });
    } finally {
      delete env.CLOUDWATCH_METRICS_CELL;
    }
  });
});
