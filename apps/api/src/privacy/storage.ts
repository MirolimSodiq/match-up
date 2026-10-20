import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * DSR fayllari uchun ombor. MVP: lokal disk (`STORAGE_DIR`); keyin S3 (eu-central-1, SSE-KMS) —
 * shu interfeysni amalga oshiruvchi klass bilan almashtiriladi.
 */
export interface FileStorage {
  put(key: string, body: Buffer): Promise<void>;
  open(key: string): ReadStream;
  remove(key: string): Promise<void>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  }

  /** Kalit faqat root ichida qoladi (`../` bilan chiqib bo'lmaydi). */
  private path(key: string): string {
    const full = join(this.root, key);
    const rel = relative(this.root, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`storage: yaroqsiz kalit ${key}`);
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true, mode: 0o700 });
    // Shaxsiy ma'lumot: faqat API process egasi o'qiy oladi
    await writeFile(full, body, { mode: 0o600 });
  }

  open(key: string): ReadStream {
    return createReadStream(this.path(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
