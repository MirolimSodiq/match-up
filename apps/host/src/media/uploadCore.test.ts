import { describe, expect, it } from 'vitest';
import {
  classify,
  completeBody,
  contentTypeFor,
  mergeParts,
  missingParts,
  pickNext,
  planParts,
  processingGiveUpMs,
  progress,
  retryDelay,
  shouldYield,
  type UploadJob,
  uploadedBytes,
  validateClip,
  visibleJobs,
  waitsForWifi,
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

describe('yozuvlar (AI-Cam)', () => {
  const rec = (over: Partial<UploadJob> = {}) => job({ id: 'r1', kind: 'recording', state: 'queued', sizeBytes: 15 * 1024 * MiB, partSize: 16 * MiB, createdAt: 1, ...over });
  const clip = (over: Partial<UploadJob> = {}) => job({ id: 'c1', state: 'queued', createdAt: 5, ...over });
  const wifi = { online: true, wifi: true };
  const cellular = { online: true, wifi: false };

  it("yakunlash: yozuvda ETag'lar yuborilmaydi (server ListParts'dan oladi)", () => {
    expect(completeBody(rec({ etags: {} }))).toEqual({});
  });

  it("navbat: avval kliplar (keyin qo'shilgan bo'lsa ham), keyin yozuv", () => {
    expect(pickNext([rec(), clip()], 10, wifi, false)?.id).toBe('c1');
    expect(pickNext([rec()], 10, wifi, false)?.id).toBe('r1');
    expect(pickNext([rec(), clip({ nextRetryAt: 100 })], 10, wifi, false)?.id).toBe('r1');
    expect(pickNext([rec(), clip()], 10, { online: false, wifi: false }, true)).toBeUndefined();
  });

  it("yozuv mobil internetda kutadi (ruxsat berilmagan bo'lsa); klip — yo'q", () => {
    expect(waitsForWifi(rec(), cellular, false)).toBe(true);
    expect(waitsForWifi(rec(), cellular, true)).toBe(false);
    expect(waitsForWifi(clip(), cellular, false)).toBe(false);
    expect(pickNext([rec()], 10, cellular, false)).toBeUndefined();
    expect(pickNext([rec(), clip()], 10, cellular, false)?.id).toBe('c1');
    expect(pickNext([rec()], 10, cellular, true)?.id).toBe('r1');
  });

  it("yozuv navbatdagi klipga yo'l beradi", () => {
    expect(shouldYield(rec({ state: 'uploading' }), [rec({ state: 'uploading' }), clip()], 10)).toBe(true);
    expect(shouldYield(rec({ state: 'uploading' }), [clip({ state: 'processing' })], 10)).toBe(false);
    expect(shouldYield(clip({ state: 'uploading' }), [clip({ id: 'c2' })], 10)).toBe(false);
  });

  it("ro'yxatlar turi bo'yicha alohida; eski navbat (kind yo'q) — highlight", () => {
    const jobs = [rec(), clip(), job({ id: 'old', state: 'paused' })];
    expect(visibleJobs(jobs, 'm1').map((j) => j.id)).toEqual(['c1', 'old']);
    expect(visibleJobs(jobs, 'm1', 'recording').map((j) => j.id)).toEqual(['r1']);
  });

  it('server qayta ishlashini kutish: yozuv — soatlab', () => {
    expect(processingGiveUpMs(rec())).toBeGreaterThan(processingGiveUpMs(clip()) * 10);
  });
});
