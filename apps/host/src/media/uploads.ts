import { useMemo, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';
import { Directory, File, FileMode, Paths, UploadType } from 'expo-file-system';
import { api, call } from '@/api/client';
import { ApiError } from '@/api/errors';
import { uuid } from '@/lib/device';
import { KEYS, storage } from '@/lib/storage';
import { network } from '@/offline/network';
import {
  classify,
  completeBody,
  isRecording,
  mergeParts,
  missingParts,
  type PartSpec,
  pickNext,
  processingGiveUpMs,
  type RecordingCamera,
  retryDelay,
  shouldYield,
  type UploadJob,
  type UploadKind,
  visibleJobs,
} from './uploadCore';

/**
 * Yuklash navbati (diskda: `matchup-host/uploads.json` + video nusxasi `matchup-host/uploads/`): highlight
 * kliplari va to'liq o'yin yozuvlari. Bir vaqtda bitta yuklash; har qism alohida native PUT (progress bilan).
 * Internet uzilsa — pauza, tarmoq qaytganda / ilova faollashganda / backoff tugaganda avtomatik davom etadi.
 * Ilova qayta ochilsa ham davom etadi: server qaysi qismlar borligini aytadi (`GET /v1/media/{id}/upload`).
 * Yozuvlar — kliplardan keyin va standart bo'yicha faqat Wi-Fi'da; klip navbatga tushsa yozuv qismlar orasida
 * bo'shatadi.
 */

const persistent = Platform.OS !== 'web';
const root = persistent ? new Directory(Paths.document, 'matchup-host') : null;
const videos = persistent ? new Directory(Paths.document, 'matchup-host', 'uploads') : null;
const index = root ? new File(root, 'uploads.json') : null;
const PROCESSING_POLL_MS = 4_000;

type Listener = () => void;

/** Yozuv kliplarga yo'l berdi — xato emas, navbatga qaytadi. */
class YieldSignal extends Error {}

class PartHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`${code} (${status})`);
  }
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

class UploadEngine {
  private jobs: UploadJob[] = [];
  private listeners = new Set<Listener>();
  private version = 0;
  private userId?: string;
  private running?: string;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private poller?: ReturnType<typeof setInterval>;
  private queryClient?: QueryClient;
  private started = false;
  private hydrated = false;
  private allowCellular = false;

  // --- holat ------------------------------------------------------------------
  private hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      if (index?.exists) this.jobs = JSON.parse(index.textSync()) as UploadJob[];
    } catch {
      this.jobs = [];
    }
    // Ilova yopilganda ketayotgan yuklash — davom ettiriladi
    for (const j of this.jobs) if (j.state === 'uploading' || j.state === 'completing') j.state = 'queued';
  }

  private persist() {
    if (!index || !root) return;
    try {
      if (!root.exists) root.create({ intermediates: true, idempotent: true });
      index.writeSync(JSON.stringify(this.jobs.map(({ inflightBytes: _i, ...j }) => j)));
    } catch (err) {
      console.warn('uploads: diskka yozilmadi', err);
    }
  }

  private emit(save = true) {
    if (save) this.persist();
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  private patch(id: string, p: Partial<UploadJob>, save = true) {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...p, updatedAt: Date.now() } : j));
    this.emit(save);
  }

  get(id: string) {
    return this.jobs.find((j) => j.id === id);
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  list(matchId: string, kind: UploadKind = 'highlight') {
    return visibleJobs(this.jobs, matchId, kind);
  }

  /** Yozuvlarni mobil internetda ham yuklash (standart — faqat Wi-Fi). */
  get cellularAllowed() {
    return this.allowCellular;
  }

  async setCellularAllowed(value: boolean) {
    this.allowCellular = value;
    await storage.set(KEYS.recordingCellular, value ? '1' : '0');
    const running = this.running ? this.get(this.running) : undefined;
    if (!value && running && isRecording(running) && !network.wifi) this.abort?.abort();
    this.emit(false);
    this.kick();
  }

  // --- hayot sikli ------------------------------------------------------------
  start(client: QueryClient) {
    this.queryClient = client;
    this.hydrate();
    if (this.started) return;
    this.started = true;
    network.subscribe(() => {
      if (network.online) this.kick();
      // Dev "offline rejim" yoki tizim tarmog'i yo'qoldi — joriy PUT darhol to'xtatiladi
      else this.abort?.abort();
      // Wi-Fi'dan mobil internetga o'tildi — yozuv to'xtaydi (gigabaytlar mobil trafikda ketmasin)
      const running = this.running ? this.get(this.running) : undefined;
      if (network.online && running && isRecording(running) && !network.wifi && !this.allowCellular) this.abort?.abort();
    });
    AppState.addEventListener('change', (s) => {
      if (s === 'active') this.kick();
    });
    this.poller = setInterval(() => void this.pollProcessing(), PROCESSING_POLL_MS);
    void storage.get(KEYS.recordingCellular).then((v) => {
      this.allowCellular = v === '1';
      this.kick();
    });
  }

  setUser(id: string | undefined) {
    this.userId = id;
    this.hydrate();
    if (id) this.kick();
    else this.abort?.abort();
  }

  /**
   * Videoni ilova papkasiga nusxalab navbatga qo'yadi (picker/kamera fayli keshda — tizim tozalashi mumkin).
   * Fayl serverda tayyor (`ready`, worker checksum'ni tekshirgan) bo'lgandagina o'chiriladi.
   */
  async enqueue(input: {
    matchId: string;
    sourceUri: string;
    contentType: UploadJob['contentType'];
    sizeBytes: number;
    durationMs: number;
    recordedAt?: string;
    title?: string;
    taggedParticipantIds: string[];
  }): Promise<UploadJob> {
    this.hydrate();
    const id = uuid();
    let fileUri = input.sourceUri;
    let sizeBytes = input.sizeBytes;
    if (videos) {
      if (!videos.exists) videos.create({ intermediates: true, idempotent: true });
      const ext = input.contentType === 'video/quicktime' ? 'mov' : 'mp4';
      const dest = new File(videos, `${id}.${ext}`);
      await new File(input.sourceUri).copy(dest);
      fileUri = dest.uri;
      // Qismlar va imzolangan Content-Length aynan shu fayl hajmidan hisoblanadi
      sizeBytes = Number(dest.size) || sizeBytes;
    }
    const now = Date.now();
    const job: UploadJob = {
      id,
      matchId: input.matchId,
      fileUri,
      contentType: input.contentType,
      sizeBytes,
      durationMs: Math.min(Math.max(1, Math.round(input.durationMs)), 60_000),
      recordedAt: input.recordedAt,
      title: input.title?.trim() || undefined,
      taggedParticipantIds: input.taggedParticipantIds,
      state: 'queued',
      etags: {},
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs = [...this.jobs, job];
    this.emit();
    this.kick();
    return job;
  }

  /**
   * To'liq o'yin yozuvi (kamera telefoni): fayl kesh papkasidan ilova papkasiga **ko'chiriladi** (15 GB nusxa
   * olinmaydi). Fayl serverda tayyor bo'lgach o'chiriladi.
   */
  async enqueueRecording(input: {
    matchId: string;
    sourceUri: string;
    contentType: UploadJob['contentType'];
    durationMs: number;
    camera: RecordingCamera;
  }): Promise<UploadJob> {
    this.hydrate();
    const id = uuid();
    let fileUri = input.sourceUri;
    let sizeBytes = 0;
    const src = new File(input.sourceUri);
    if (videos) {
      if (!videos.exists) videos.create({ intermediates: true, idempotent: true });
      const dest = new File(videos, `${input.camera.clientCameraId}.${input.contentType === 'video/quicktime' ? 'mov' : 'mp4'}`);
      await src.move(dest);
      fileUri = dest.uri;
      sizeBytes = Number(dest.size);
    } else {
      sizeBytes = Number(src.size);
    }
    const now = Date.now();
    const job: UploadJob = {
      id,
      kind: 'recording',
      camera: input.camera,
      matchId: input.matchId,
      fileUri,
      contentType: input.contentType,
      sizeBytes,
      durationMs: Math.max(1, Math.round(input.durationMs)),
      recordedAt: input.camera.startedAt,
      taggedParticipantIds: [],
      state: 'queued',
      etags: {},
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs = [...this.jobs, job];
    this.emit();
    this.kick();
    return job;
  }

  /** Qo'lda "Davom ettirish" / "Qayta urinish". Serverda xato bergan klip — boshidan yangi yuklash. */
  retry(id: string) {
    const j = this.get(id);
    if (!j) return;
    const fresh = j.failureCode ? { mediaId: undefined, highlightId: undefined, partSize: undefined, etags: {}, failureCode: undefined } : {};
    this.patch(id, { ...fresh, state: 'queued', attempt: 0, nextRetryAt: undefined, error: undefined });
    this.kick();
  }

  async remove(id: string) {
    const j = this.get(id);
    if (!j) return;
    if (this.running === id) this.abort?.abort();
    if (j.mediaId && ['queued', 'paused', 'uploading', 'failed'].includes(j.state) && !j.highlightId) {
      await call(api.DELETE('/v1/media/{mediaId}/upload', { params: { path: { mediaId: j.mediaId } } })).catch(() => undefined);
    }
    this.deleteFile(j);
    this.jobs = this.jobs.filter((x) => x.id !== id);
    this.emit();
  }

  private deleteFile(j: UploadJob) {
    try {
      const f = new File(j.fileUri);
      if (f.exists) f.delete();
    } catch {
      // e'tiborsiz
    }
  }

  /** Navbatdagi yuklashni boshlaydi (bittadan): avval kliplar, keyin yozuvlar (Wi-Fi'da). */
  kick() {
    if (this.running || !this.userId || !network.online) return;
    const next = pickNext(this.jobs, Date.now(), { online: network.online, wifi: network.wifi }, this.allowCellular);
    if (!next) {
      this.scheduleWake();
      return;
    }
    this.running = next.id;
    void this.run(next.id).finally(() => {
      this.running = undefined;
      this.abort = undefined;
      this.kick();
    });
  }

  private scheduleWake() {
    clearTimeout(this.timer);
    const waits = this.jobs.filter((j) => j.state === 'paused' && j.nextRetryAt).map((j) => j.nextRetryAt!);
    if (!waits.length) return;
    this.timer = setTimeout(() => this.kick(), Math.max(500, Math.min(...waits) - Date.now()));
  }

  // --- yuklash ----------------------------------------------------------------
  private async run(id: string) {
    const abort = (this.abort = new AbortController());
    try {
      this.patch(id, { state: 'uploading', error: undefined });
      let job = this.get(id)!;
      const file = new File(job.fileUri);
      if (!file.exists) throw new PartHttpError('FILE_MISSING', 0);
      // Yozuv: 15 GB faylning SHA-256 telefon uchun og'ir — worker probe bilan tekshiradi
      if (!job.sha256 && !isRecording(job)) {
        const sha256 = await file.digest('SHA-256').catch(() => undefined);
        if (sha256) this.patch(id, { sha256 });
      }

      let urls = await this.prepare(id);
      if (!urls) return; // allaqachon yakunlangan (serverda processing/ready)
      job = this.get(id)!;
      for (const part of missingParts(job)) {
        if (abort.signal.aborted || network.forcedOffline) throw ApiError.network(new Error('offline'));
        if (shouldYield(job, this.jobs, Date.now())) throw new YieldSignal();
        let url = urls.get(part.partNumber);
        if (!url) {
          // Server URL'larni partiyalab beradi (yozuv: 100 tadan) — keyingi partiya
          urls = (await this.prepare(id)) ?? new Map();
          url = urls.get(part.partNumber);
          if (!url) throw new PartHttpError('UPLOAD_INCOMPLETE', 0);
        }
        let etag: string;
        try {
          etag = await this.putPart(id, file, part, url, abort.signal);
        } catch (err) {
          if (!(err instanceof PartHttpError) || err.code !== 'S3_FORBIDDEN') throw err;
          // Presigned URL muddati o'tgan — yangilari bilan bir marta qayta
          urls = (await this.prepare(id)) ?? new Map();
          url = urls.get(part.partNumber);
          if (!url) throw err;
          etag = await this.putPart(id, file, part, url, abort.signal);
        }
        this.patch(id, { etags: { ...this.get(id)!.etags, [part.partNumber]: etag }, inflightBytes: 0, attempt: 0 });
      }

      this.patch(id, { state: 'completing', inflightBytes: 0 });
      job = this.get(id)!;
      const done = await call(api.POST('/v1/media/{mediaId}/complete', { params: { path: { mediaId: job.mediaId! } }, body: completeBody(job) }));
      this.patch(id, { state: 'processing', highlightId: done.highlight_id ?? undefined, attempt: 0, nextRetryAt: undefined });
      this.invalidate(job);
    } catch (err) {
      if (err instanceof YieldSignal) this.patch(id, { state: 'queued', inflightBytes: 0 });
      else this.onError(id, err);
    }
  }

  /**
   * Multipart sessiya: yangi (init) yoki mavjudini davom ettirish (server qismlari + yangi URL'lar).
   * `undefined` — media allaqachon yakunlangan.
   */
  private async prepare(id: string): Promise<Map<number, string> | undefined> {
    const job = this.get(id)!;
    if (!job.mediaId && job.camera) {
      const c = job.camera;
      // Kamera yozish boshida oflayn bo'lgan bo'lishi mumkin — ro'yxatga olish idempotent
      await call(
        api.PUT('/v1/host/matches/{matchId}/recording/cameras/{clientCameraId}', {
          params: { path: { matchId: job.matchId, clientCameraId: c.clientCameraId } },
          body: {
            position: c.position,
            started_at: c.startedAt,
            stopped_at: c.stoppedAt,
            duration_ms: job.durationMs,
            device_model: c.deviceModel,
            fps: c.fps,
            width: c.width,
            height: c.height,
          },
        }),
      );
      const init = await call(
        api.POST('/v1/host/matches/{matchId}/recording/cameras/{clientCameraId}/upload', {
          params: { path: { matchId: job.matchId, clientCameraId: c.clientCameraId } },
          body: { content_type: job.contentType, size_bytes: job.sizeBytes, duration_ms: job.durationMs },
        }),
      );
      this.patch(id, { mediaId: init.media_id, partSize: init.upload.part_size_bytes, etags: mergeParts({ sizeBytes: job.sizeBytes, partSize: init.upload.part_size_bytes }, init.upload.uploaded_parts) });
      return new Map(init.upload.parts.map((p) => [p.part_number, p.url]));
    }
    if (!job.mediaId) {
      const init = await call(
        api.POST('/v1/host/matches/{matchId}/highlights/uploads', {
          params: { path: { matchId: job.matchId } },
          body: {
            content_type: job.contentType,
            size_bytes: job.sizeBytes,
            duration_ms: job.durationMs,
            recorded_at: job.recordedAt,
            title: job.title,
            tagged_participant_ids: job.taggedParticipantIds,
          },
        }),
      );
      this.patch(id, { mediaId: init.media_id, partSize: init.upload.part_size_bytes, etags: {} });
      return new Map(init.upload.parts.map((p) => [p.part_number, p.url]));
    }
    try {
      const r = await call(api.GET('/v1/media/{mediaId}/upload', { params: { path: { mediaId: job.mediaId } } }));
      const etags = mergeParts({ sizeBytes: job.sizeBytes, partSize: r.upload.part_size_bytes }, r.upload.uploaded_parts);
      this.patch(id, { partSize: r.upload.part_size_bytes, etags });
      return new Map(r.upload.parts.map((p) => [p.part_number, p.url]));
    } catch (err) {
      // Javob yo'qolgan complete: media allaqachon processing/ready
      if (err instanceof ApiError && err.code === 'INVALID_STATE') {
        const m = await call(api.GET('/v1/media/{mediaId}', { params: { path: { mediaId: job.mediaId } } }));
        if (m.status === 'processing' || m.status === 'ready') {
          this.patch(id, { state: 'processing', highlightId: m.highlight_id ?? undefined });
          return undefined;
        }
      }
      throw err;
    }
  }

  /** Bo'lakni o'qib vaqtinchalik faylga yozadi va native PUT (progress bilan) qiladi. ETag qaytaradi. */
  private async putPart(id: string, file: File, part: PartSpec, url: string, signal: AbortSignal): Promise<string> {
    const handle = file.open(FileMode.ReadOnly);
    let bytes: Uint8Array;
    try {
      handle.offset = part.offset;
      bytes = await handle.readBytes(part.length);
    } finally {
      handle.close();
    }
    if (bytes.length !== part.length) throw new PartHttpError('FILE_CHANGED', 0);
    const tmp = new File(Paths.cache, `mu-upload-${id}-${part.partNumber}.part`);
    try {
      if (tmp.exists) tmp.delete();
      tmp.create();
      await tmp.write(bytes);
      let res;
      try {
        res = await tmp.upload(url, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          // Yozuv: ilova fonga o'tsa ham joriy qism tugasin (iOS); keyingisi ilova faollashganda
          sessionType: this.get(id)?.kind === 'recording' ? 'background' : 'foreground',
          signal,
          // iOS native Int64 -> BigInt keladi
          onProgress: ({ bytesSent }) => this.patch(id, { inflightBytes: Math.min(Number(bytesSent), part.length) }, false),
        });
      } catch (err) {
        throw ApiError.network(err);
      }
      if (res.status === 403) throw new PartHttpError('S3_FORBIDDEN', 403);
      if (res.status >= 500) throw new PartHttpError('INTERNAL', res.status);
      if (res.status < 200 || res.status >= 300) throw new PartHttpError('UPLOAD_REJECTED', res.status);
      const etag = header(res.headers, 'etag');
      if (!etag) throw new PartHttpError('NO_ETAG', res.status);
      return etag;
    } finally {
      try {
        if (tmp.exists) tmp.delete();
      } catch {
        // e'tiborsiz
      }
    }
  }

  private onError(id: string, err: unknown) {
    const job = this.get(id);
    if (!job) return;
    const code = err instanceof ApiError || err instanceof PartHttpError ? err.code : 'UNKNOWN';
    const status = err instanceof ApiError || err instanceof PartHttpError ? err.status : undefined;
    const action = classify(code, status);
    const attempt = job.attempt + 1;
    if (action === 'pause' || (action === 'refresh_urls' && attempt <= 5)) {
      this.patch(id, { state: 'paused', attempt, nextRetryAt: Date.now() + retryDelay(attempt), error: code, inflightBytes: 0 });
    } else if (action === 'restart' && attempt <= 3) {
      // Sessiya yo'qoldi — yangi init bilan boshidan
      this.patch(id, { state: 'queued', attempt, mediaId: undefined, partSize: undefined, etags: {}, error: code, inflightBytes: 0 });
    } else {
      if (code === 'UNKNOWN') console.warn('upload xatosi', err);
      this.patch(id, { state: 'failed', error: code, inflightBytes: 0, nextRetryAt: undefined });
    }
  }

  private invalidate(job: UploadJob) {
    void this.queryClient?.invalidateQueries({ queryKey: [isRecording(job) ? 'host-recording' : 'host-highlights', job.matchId] });
  }

  /** Server tomondagi qayta ishlash (worker) holati. */
  private async pollProcessing() {
    if (!this.userId || !network.online) return;
    const now = Date.now();
    for (const j of this.jobs.filter((x) => x.state === 'processing' && x.mediaId && now - x.updatedAt < processingGiveUpMs(x))) {
      try {
        const m = await call(api.GET('/v1/media/{mediaId}', { params: { path: { mediaId: j.mediaId! } } }));
        if (m.status === 'ready') {
          this.deleteFile(j);
          this.patch(j.id, { state: 'ready', highlightId: m.highlight_id ?? j.highlightId });
          this.invalidate(j);
        } else if (m.status === 'failed' || m.status === 'rejected') {
          this.patch(j.id, { state: 'failed', failureCode: m.failure_code ?? 'PROCESSING_FAILED', error: m.failure_code ?? undefined });
          this.invalidate(j);
        } else if (m.processing?.stage) {
          this.emit(false);
        }
      } catch {
        // keyingi siklda
      }
    }
  }
}

export const uploadEngine = new UploadEngine();

export function useUploads(matchId: string, kind: UploadKind = 'highlight'): UploadJob[] {
  const version = useSyncExternalStore(uploadEngine.subscribe, uploadEngine.getVersion);
  return useMemo(() => uploadEngine.list(matchId, kind), [version, matchId, kind]);
}

/** Yozuvlarni mobil internetda ham yuklash sozlamasi (ekranda o'zgarsa qayta chiziladi). */
export function useCellularAllowed(): boolean {
  useSyncExternalStore(uploadEngine.subscribe, uploadEngine.getVersion);
  return uploadEngine.cellularAllowed;
}
