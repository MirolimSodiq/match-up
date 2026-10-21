import { readFileSync } from 'node:fs';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  type Part,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as cloudFrontSign } from '@aws-sdk/cloudfront-signer';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV, type Env } from '../config/env';

export interface UploadedPart {
  part_number: number;
  etag: string;
  size_bytes: number;
}

/** S3 xatosi nomi (`NoSuchUpload`, `InvalidPart`, `NoSuchKey`, ...) — SDK'dan mustaqil tekshirish uchun. */
export function s3ErrorName(err: unknown): string | undefined {
  if (err instanceof S3ServiceException) return err.name;
  const e = err as { name?: unknown; Code?: unknown };
  return typeof e?.Code === 'string' ? e.Code : typeof e?.name === 'string' ? e.name : undefined;
}

/**
 * S3-mos object storage (AWS S3 yoki MinIO). Video API orqali o'tmaydi: API faqat multipart
 * sessiyani ochadi/yopadi va presigned URL beradi (ARCHITECTURE §4.10).
 *
 * Ikki client: `s3` — API'ning o'z so'rovlari (konteyner ichida `http://minio:9000` bo'lishi mumkin),
 * `presigner` — telefon ochadigan URL'lar (`S3_PUBLIC_ENDPOINT`, imzo host header'ini ham qamraydi).
 */
@Injectable()
export class ObjectStorage {
  readonly rawBucket: string;
  readonly mediaBucket: string;
  private readonly s3: S3Client;
  private readonly presigner: S3Client;

  constructor(@Inject(ENV) env: Env) {
    this.rawBucket = env.MEDIA_RAW_BUCKET;
    this.mediaBucket = env.MEDIA_BUCKET;
    const base = {
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
      // MinIO checksum header'larini (CRC32) qo'llab-quvvatlaydi, lekin presigned PUT'da client ularni yubormaydi
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.s3 = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
    this.presigner = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT });
  }

  async createMultipart(bucket: string, key: string, contentType: string): Promise<string> {
    const res = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    );
    if (!res.UploadId) throw new Error('storage: UploadId qaytmadi');
    return res.UploadId;
  }

  /**
   * Qism uchun presigned PUT. `Content-Length` imzoga kiradi — client aynan shu hajmdagi bo'lakni yuboradi,
   * shuning uchun e'lon qilingan hajmdan (≤ 150 MB) ortiq yuklab bo'lmaydi.
   */
  presignPart(bucket: string, key: string, uploadId: string, partNumber: number, contentLength: number, ttlSec: number) {
    return getSignedUrl(
      this.presigner,
      new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: contentLength }),
      { expiresIn: ttlSec, signableHeaders: new Set(['content-length']) },
    );
  }

  async listParts(bucket: string, key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    for (;;) {
      const res = await this.s3.send(
        new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker, MaxParts: 1000 }),
      );
      for (const p of res.Parts ?? []) {
        if (p.PartNumber && p.ETag) parts.push({ part_number: p.PartNumber, etag: p.ETag, size_bytes: p.Size ?? 0 });
      }
      if (!res.IsTruncated) return parts;
      marker = res.NextPartNumberMarker;
    }
  }

  async completeMultipart(bucket: string, key: string, uploadId: string, parts: { part_number: number; etag: string }[]) {
    const list: Part[] = parts.map((p) => ({ PartNumber: p.part_number, ETag: normalizeEtag(p.etag) }));
    await this.s3.send(
      new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: list } }),
    );
  }

  async abortMultipart(bucket: string, key: string, uploadId: string): Promise<void> {
    try {
      await this.s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    } catch (err) {
      if (s3ErrorName(err) !== 'NoSuchUpload') throw err;
    }
  }

  /** Obyekt hajmi; yo'q bo'lsa — undefined. */
  async head(bucket: string, key: string): Promise<{ size: number; contentType?: string } | undefined> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      const name = s3ErrorName(err);
      if (name === 'NotFound' || name === 'NoSuchKey') return undefined;
      throw err;
    }
  }

  async getText(bucket: string, key: string): Promise<string> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`storage: ${key} bo'sh`);
    return res.Body.transformToString('utf8');
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /** S3/MinIO presigned GET (CloudFront sozlanmagan muhitlar uchun). */
  presignGet(bucket: string, key: string, ttlSec: number, contentDisposition?: string): Promise<string> {
    return getSignedUrl(
      this.presigner,
      new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: contentDisposition }),
      { expiresIn: ttlSec },
    );
  }
}

/** Client ETag'ni qo'shtirnoqsiz yoki qo'shtirnoq bilan yuborishi mumkin — S3 qo'shtirnoqli kutadi. */
export function normalizeEtag(etag: string): string {
  const v = etag.trim().replace(/^W\//, '');
  return v.startsWith('"') ? v : `"${v}"`;
}

/**
 * Ijro uchun muddatli URL: CloudFront signed URL (prod) yoki S3/MinIO presigned GET (dev, staging).
 * Natija bucket'i (`MEDIA_BUCKET`) to'g'ridan-to'g'ri ochiq emas.
 */
@Injectable()
export class MediaUrlSigner {
  private readonly log = new Logger('MediaUrlSigner');
  private readonly cdn?: { domain: string; keyPairId: string; privateKey: string };

  constructor(
    @Inject(ENV) env: Env,
    private readonly storage: ObjectStorage,
  ) {
    if (env.MEDIA_CDN_DOMAIN && env.MEDIA_CDN_KEY_PAIR_ID && env.MEDIA_CDN_PRIVATE_KEY_FILE) {
      this.cdn = {
        domain: env.MEDIA_CDN_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        keyPairId: env.MEDIA_CDN_KEY_PAIR_ID,
        privateKey: readFileSync(env.MEDIA_CDN_PRIVATE_KEY_FILE, 'utf8'),
      };
      this.log.log(`CloudFront signed URL: ${this.cdn.domain}`);
    }
  }

  get mode(): 'cloudfront' | 'presigned' {
    return this.cdn ? 'cloudfront' : 'presigned';
  }

  /** `expiresAt` — Unix soniya; bir so'rovdagi barcha URL'lar bir xil muddat bilan imzolanadi. */
  async sign(bucket: string, key: string, expiresAt: number): Promise<string> {
    if (this.cdn) {
      const url = `https://${this.cdn.domain}/${key.split('/').map(encodeURIComponent).join('/')}`;
      return cloudFrontSign({
        url,
        keyPairId: this.cdn.keyPairId,
        privateKey: this.cdn.privateKey,
        dateLessThan: new Date(expiresAt * 1000).toISOString(),
      });
    }
    const ttl = Math.max(60, expiresAt - Math.floor(Date.now() / 1000));
    return this.storage.presignGet(bucket, key, ttl);
  }
}
