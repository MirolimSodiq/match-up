import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

export const REDIS = Symbol('REDIS');

const log = new Logger('Redis');

function createRedis(env: Env): Redis {
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  // Listener bo'lmasa ioredis xatoni logger'ni chetlab console.error'ga yozadi ("Unhandled error event").
  // Ulanish xatolari har reconnect urinishida takrorlanadi — uzilish boshida bir marta log qilamiz;
  // ioredis o'zi qayta ulanadi.
  let down = false;
  redis.on('error', (err: Error & { code?: string }) => {
    // ECONNREFUSED (AggregateError) da message bo'sh bo'ladi — code bilan birga chiqaramiz
    if (!down) log.warn(`Ulanish xatosi: ${[err.code, err.message].filter(Boolean).join(' ')}`);
    down = true;
  });
  redis.on('ready', () => {
    if (down) log.log('Ulanish tiklandi');
    down = false;
  });
  return redis;
}

@Global()
@Module({
  providers: [{ provide: REDIS, inject: [ENV], useFactory: createRedis }],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}
