/**
 * Highlight yuklash yadrosi (sof TS — RN/Expo'siz, vitest bilan tekshiriladi).
 *
 * Oqim: init (`POST .../highlights/uploads`) -> har qism `PUT <presigned>` (ETag) -> complete.
 * Internet uzilsa yoki ilova yopilsa: holat diskda; davom ettirishda server haqiqati
 * (`GET /v1/media/{id}/upload` -> `uploaded_parts`) lokal ETag'lar bilan birlashtiriladi.
 */

export type UploadState =
  /** Navbatda (internet kutilmoqda yoki boshqa yuklash tugashini kutadi). */
  | 'queued'
  | 'uploading'
  /** Internet yo'q — tarmoq qaytganda avtomatik davom etadi. */
  | 'paused'
  | 'completing'
  /** Serverda: worker HLS yasayapti. */
  | 'processing'
  | 'ready'
  | 'failed';

export interface UploadJob {
  /** Lokal id (fayl nomi). */
  id: string;
  matchId: string;
  /** Ilova hujjatlar papkasidagi nusxa (kesh tozalansa ham yo'qolmaydi). */
  fileUri: string;
  contentType: 'video/mp4' | 'video/quicktime';
  sizeBytes: number;
  durationMs: number;
  recordedAt?: string;
  title?: string;
  taggedParticipantIds: string[];
  sha256?: string;

  state: UploadState;
  mediaId?: string;
  highlightId?: string;
  partSize?: number;
  /** part_number -> ETag (yuklangan qismlar). */
  etags: Record<number, string>;
  /** Joriy qismning yuborilgan baytlari (progress uchun, diskka yozilmaydi). */
  inflightBytes?: number;
  attempt: number;
  nextRetryAt?: number;
  /** Oxirgi xato kodi (ApiError.code yoki lokal: FILE_MISSING, NETWORK ...). */
  error?: string;
  failureCode?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PartSpec {
  partNumber: number;
  offset: number;
  length: number;
}

/** Server bilan bir xil: oxirgisidan tashqari barcha qismlar `partSize` bayt. */
export function planParts(size: number, partSize: number): PartSpec[] {
  const count = Math.max(1, Math.ceil(size / partSize));
  return Array.from({ length: count }, (_, i) => ({
    partNumber: i + 1,
    offset: i * partSize,
    length: i < count - 1 ? partSize : size - partSize * (count - 1),
  }));
}

export interface ServerPart {
  part_number: number;
  etag: string;
  size_bytes: number;
}

/**
 * Lokal ETag'lar + server ro'yxati. Server haqiqat: unda to'liq hajmda bor qism — tayyor (lokal ETag
 * yo'qolgan bo'lsa ham); serverda yo'q qism lokal "tayyor" bo'lsa ham qayta yuklanadi.
 */
export function mergeParts(job: Pick<UploadJob, 'sizeBytes' | 'partSize'>, server: readonly ServerPart[]): Record<number, string> {
  const plan = planParts(job.sizeBytes, job.partSize!);
  const byNumber = new Map(server.map((p) => [p.part_number, p]));
  const out: Record<number, string> = {};
  for (const p of plan) {
    const s = byNumber.get(p.partNumber);
    if (s && s.size_bytes === p.length) out[p.partNumber] = s.etag;
  }
  return out;
}

export function missingParts(job: Pick<UploadJob, 'sizeBytes' | 'partSize' | 'etags'>): PartSpec[] {
  return planParts(job.sizeBytes, job.partSize!).filter((p) => !job.etags[p.partNumber]);
}

export function uploadedBytes(job: Pick<UploadJob, 'sizeBytes' | 'partSize' | 'etags' | 'inflightBytes'>): number {
  if (!job.partSize) return 0;
  const done = planParts(job.sizeBytes, job.partSize)
    .filter((p) => job.etags[p.partNumber])
    .reduce((s, p) => s + p.length, 0);
  return Math.min(job.sizeBytes, done + (job.inflightBytes ?? 0));
}

/** 0..1 — yuklash (qayta ishlash bosqichlari alohida ko'rsatiladi). */
export function progress(job: UploadJob): number {
  if (job.state === 'completing' || job.state === 'processing' || job.state === 'ready') return 1;
  return job.sizeBytes > 0 ? uploadedBytes(job) / job.sizeBytes : 0;
}

export function completeBody(job: Pick<UploadJob, 'sizeBytes' | 'partSize' | 'etags' | 'sha256'>) {
  const parts = planParts(job.sizeBytes, job.partSize!).map((p) => {
    const etag = job.etags[p.partNumber];
    if (!etag) throw new Error(`part ${p.partNumber} yuklanmagan`);
    return { part_number: p.partNumber, etag };
  });
  return { parts, ...(job.sha256 ? { checksum_sha256: job.sha256 } : {}) };
}

/** Eksponensial backoff (2 s .. 2 daq) + jitter. */
export function retryDelay(attempt: number, random = Math.random): number {
  const base = Math.min(120_000, 2_000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + random() * 0.5));
}

export type ErrorAction =
  /** Internet yo'q / server javob bermadi: pauza, tarmoq qaytganda davom. */
  | 'pause'
  /** Multipart sessiya yo'q bo'ldi (muddat o'tdi / abort): boshidan yangi init. */
  | 'restart'
  /** Presigned URL muddati o'tdi (403): yangi URL'lar bilan qayta urinish. */
  | 'refresh_urls'
  /** Qayta urinish ma'nosiz (ruxsat yo'q, validatsiya, fayl yo'q). */
  | 'fail';

export function classify(code: string | undefined, status?: number): ErrorAction {
  if (code === 'NETWORK' || code === 'TIMEOUT' || code === 'RATE_LIMITED' || (status !== undefined && status >= 500)) return 'pause';
  if (code === 'UPLOAD_EXPIRED' || code === 'NOT_FOUND') return 'restart';
  if (code === 'S3_FORBIDDEN') return 'refresh_urls';
  if (code === 'UPLOAD_INCOMPLETE') return 'refresh_urls';
  return 'fail';
}

/** Ekranda ko'rinadigan (faol yoki yaqinda tugagan) yuklashlar — eng yangisi birinchi. */
export function visibleJobs(jobs: readonly UploadJob[], matchId: string): UploadJob[] {
  return jobs.filter((j) => j.matchId === matchId && j.state !== 'ready').sort((a, b) => b.createdAt - a.createdAt);
}

export function contentTypeFor(uri: string, mimeType?: string | null): UploadJob['contentType'] | undefined {
  const ext = uri.split('?')[0]!.split('.').pop()?.toLowerCase();
  if (ext === 'mov' || mimeType === 'video/quicktime') return 'video/quicktime';
  if (ext === 'mp4' || ext === 'm4v' || mimeType === 'video/mp4') return 'video/mp4';
  return undefined;
}

export const LIMITS = { maxBytes: 150 * 1024 * 1024, maxDurationMs: 60_000 } as const;

/** Tanlangan/yozilgan videoni yuklashdan oldin tekshirish (server ham tekshiradi). */
export function validateClip(c: { sizeBytes: number; durationMs: number; contentType?: string }): 'TOO_LARGE' | 'TOO_LONG' | 'UNSUPPORTED' | null {
  if (!c.contentType) return 'UNSUPPORTED';
  if (c.sizeBytes > LIMITS.maxBytes) return 'TOO_LARGE';
  if (c.durationMs > LIMITS.maxDurationMs + 500) return 'TOO_LONG';
  return null;
}
