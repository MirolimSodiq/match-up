import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

/** `media_processing_jobs.type` (0002) — transcode hozir, AI job'lar Phase 2 (AI-Cam). */
export type MediaJobType = 'transcode' | 'thumbnail' | 'ai_detect_events' | 'ai_auto_clip' | 'face_blur';
export type MediaJobTransport = 'redis_stream' | 'sqs';
/**
 * Bitta transport ichidagi navbat: `default` — kliplar (daqiqalar), `recording` — to'liq o'yin yozuvlari
 * (soatlar, katta disk). Har lane'ni o'z worker servisi o'qiydi, shuning uchun uzun yozuv kliplarni kutdirmaydi.
 */
export type MediaJobLane = 'default' | 'recording';

/**
 * Navbat xabari (v1) — transportdan mustaqil. Xabarda faqat identifikatorlar: worker job tafsilotlarini
 * (bucket, key, cheklovlar) `POST /internal/media/jobs/{id}/start` dan oladi, shuning uchun eski xabar
 * qayta yetkazilsa ham joriy holat bo'yicha ishlaydi.
 */
export interface MediaJobMessage {
  v: 1;
  job_id: string;
  type: MediaJobType;
  media_id: string;
  enqueued_at: string;
}

export interface MediaJobQueue {
  readonly transport: MediaJobTransport;
  /** Xabar id'sini qaytaradi (Redis Stream entry id / SQS MessageId). */
  publish(message: MediaJobMessage, lane?: MediaJobLane): Promise<string>;
}

export const MEDIA_JOB_QUEUES = Symbol('MEDIA_JOB_QUEUES');

/**
 * Job turi -> transport. CPU transcode — Redis Stream (dev va prod bir xil, Python worker consumer group
 * bilan o'qiydi). GPU/AI-Cam job'lari keyinchalik SQS + AWS Batch'ga yo'naltiriladi: `SqsMediaQueue`
 * shu interfeysni amalga oshiradi va `MEDIA_JOB_QUEUES` ro'yxatiga qo'shiladi.
 */
export const JOB_ROUTES: Record<MediaJobType, MediaJobTransport> = {
  transcode: 'redis_stream',
  thumbnail: 'redis_stream',
  ai_detect_events: 'sqs',
  ai_auto_clip: 'sqs',
  face_blur: 'sqs',
};

/** Profil -> lane (`media-sql.ts` dagi `MediaProfile`). */
export function laneFor(profile: string | null | undefined): MediaJobLane {
  return profile === 'recording_v1' ? 'recording' : 'default';
}

@Injectable()
export class RedisStreamMediaQueue implements MediaJobQueue {
  readonly transport = 'redis_stream' as const;
  readonly streams: Record<MediaJobLane, string>;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) env: Env,
  ) {
    this.streams = { default: env.MEDIA_JOBS_STREAM, recording: env.MEDIA_RECORDING_JOBS_STREAM };
  }

  async publish(m: MediaJobMessage, lane: MediaJobLane = 'default'): Promise<string> {
    const id = await this.redis.xadd(
      this.streams[lane], 'MAXLEN', '~', '100000', '*',
      'v', String(m.v), 'job_id', m.job_id, 'type', m.type, 'media_id', m.media_id, 'enqueued_at', m.enqueued_at,
    );
    if (!id) throw new Error('media queue: XADD id qaytarmadi');
    return id;
  }
}
