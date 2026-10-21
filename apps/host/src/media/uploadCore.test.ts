import { describe, expect, it } from 'vitest';
import {
  classify,
  completeBody,
  contentTypeFor,
  mergeParts,
  missingParts,
  planParts,
  progress,
  retryDelay,
  type UploadJob,
  uploadedBytes,
  validateClip,
  visibleJobs,
} from './uploadCore';

const MiB = 1024 * 1024;

function job(over: Partial<UploadJob> = {}): UploadJob {
  return {
    id: 'l1',
    matchId: 'm1',
    fileUri: 'file:///doc/l1.mp4',
    contentType: 'video/mp4',
    sizeBytes: 20 * MiB + 5,
    durationMs: 30_000,
    taggedParticipantIds: [],
    state: 'uploading',
    partSize: 8 * MiB,
    etags: {},
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('planParts', () => {
  it("server bilan bir xil bo'laklar: oxirgisi qoldiq", () => {
    expect(planParts(20 * MiB + 5, 8 * MiB)).toEqual([
      { partNumber: 1, offset: 0, length: 8 * MiB },
      { partNumber: 2, offset: 8 * MiB, length: 8 * MiB },
      { partNumber: 3, offset: 16 * MiB, length: 4 * MiB + 5 },
    ]);
    expect(planParts(16 * MiB, 8 * MiB).map((p) => p.length)).toEqual([8 * MiB, 8 * MiB]);
    expect(planParts(1000, 8 * MiB)).toEqual([{ partNumber: 1, offset: 0, length: 1000 }]);
  });
});

describe('davom ettirish', () => {
  it("server haqiqat: to'liq qism — tayyor, chala/yo'q qism — qayta yuklanadi", () => {
    const j = job({ etags: { 1: '"a"', 2: '"b"', 3: '"stale"' } });
    const merged = mergeParts(j, [
      { part_number: 1, etag: '"a"', size_bytes: 8 * MiB },
      { part_number: 2, etag: '"b2"', size_bytes: 3 * MiB }, // uzilgan PUT
    ]);
    expect(merged).toEqual({ 1: '"a"' });
    expect(missingParts({ ...j, etags: merged }).map((p) => p.partNumber)).toEqual([2, 3]);
  });

  it("lokal ETag yo'qolgan bo'lsa ham server ro'yxatidan tiklanadi", () => {
    const merged = mergeParts(job(), [{ part_number: 3, etag: '"c"', size_bytes: 4 * MiB + 5 }]);
    expect(merged).toEqual({ 3: '"c"' });
  });

  it('progress: tayyor qismlar + joriy qism baytlari', () => {
    const j = job({ etags: { 1: '"a"' }, inflightBytes: 2 * MiB });
    expect(uploadedBytes(j)).toBe(10 * MiB);
    expect(progress(j)).toBeCloseTo((10 * MiB) / (20 * MiB + 5));
    expect(progress({ ...j, state: 'processing' })).toBe(1);
    expect(progress(job({ partSize: undefined, state: 'queued' }))).toBe(0);
  });
});

describe('completeBody', () => {
  it('barcha qismlar tartib bilan + sha256', () => {
    const j = job({ etags: { 3: '"c"', 1: '"a"', 2: '"b"' }, sha256: 'ab'.repeat(32) });
    expect(completeBody(j)).toEqual({
      parts: [
        { part_number: 1, etag: '"a"' },
        { part_number: 2, etag: '"b"' },
        { part_number: 3, etag: '"c"' },
      ],
      checksum_sha256: 'ab'.repeat(32),
    });
    expect(() => completeBody(job({ etags: { 1: '"a"' } }))).toThrow(/part 2/);
  });
});

describe('xatolar', () => {
  it('internet -> pauza, sessiya yo\'q -> qaytadan, URL muddati -> yangilash, qolgani -> xato', () => {
    expect(classify('NETWORK')).toBe('pause');
    expect(classify('INTERNAL', 503)).toBe('pause');
    expect(classify('UPLOAD_EXPIRED', 410)).toBe('restart');
    expect(classify('S3_FORBIDDEN', 403)).toBe('refresh_urls');
    expect(classify('FORBIDDEN', 403)).toBe('fail');
    expect(classify('VALIDATION_FAILED', 422)).toBe('fail');
  });

  it('backoff: 2 s dan 2 daqiqagacha', () => {
    const mid = () => 0.5;
    expect(retryDelay(1, mid)).toBe(2_000);
    expect(retryDelay(3, mid)).toBe(8_000);
    expect(retryDelay(20, mid)).toBe(120_000);
  });
});

describe('klip tekshiruvi', () => {
  it('mp4/mov, ≤ 150 MB, ≤ 60 s', () => {
    expect(contentTypeFor('file:///x/IMG_0001.MOV')).toBe('video/quicktime');
    expect(contentTypeFor('file:///x/a.mp4')).toBe('video/mp4');
    expect(contentTypeFor('file:///x/a', 'video/mp4')).toBe('video/mp4');
    expect(contentTypeFor('file:///x/a.webm')).toBeUndefined();
    expect(validateClip({ sizeBytes: 10, durationMs: 60_200, contentType: 'video/mp4' })).toBeNull();
    expect(validateClip({ sizeBytes: 10, durationMs: 61_000, contentType: 'video/mp4' })).toBe('TOO_LONG');
    expect(validateClip({ sizeBytes: 151 * MiB, durationMs: 10, contentType: 'video/mp4' })).toBe('TOO_LARGE');
    expect(validateClip({ sizeBytes: 1, durationMs: 1 })).toBe('UNSUPPORTED');
  });

  it("ko'rinadigan yuklashlar: shu match, tayyor bo'lmaganlar, yangisi birinchi", () => {
    const list = [job({ id: 'a', createdAt: 1 }), job({ id: 'b', createdAt: 3 }), job({ id: 'c', state: 'ready' }), job({ id: 'd', matchId: 'm2' })];
    expect(visibleJobs(list, 'm1').map((j) => j.id)).toEqual(['b', 'a']);
  });
});
