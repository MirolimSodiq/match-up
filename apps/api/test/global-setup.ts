import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import Redis from 'ioredis';
import { Client } from 'pg';
import { runMigrations } from '../scripts/migrate';

/** Har ishga tushishda toza baza: DROP/CREATE -> migratsiyalar -> dev seed. */
export default async function globalSetup() {
  require('./env');
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  await runMigrations(process.env.DATABASE_URL!, { seed: true, log: false });

  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();

  // MinIO bucket'lari (idempotent)
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
  for (const Bucket of [process.env.MEDIA_RAW_BUCKET!, process.env.MEDIA_BUCKET!]) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket }));
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err;
    }
  }
  s3.destroy();
}
