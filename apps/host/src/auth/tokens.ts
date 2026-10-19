import type { Tokens } from '@matchup/contracts';
import { KEYS, storage } from '@/lib/storage';

/** Sessiya nima uchun tugadi: foydalanuvchi chiqdi, token o'g'irlik belgisi yoki muddati o'tgan. */
export type SessionEndReason = 'logout' | 'token_reused' | 'expired';

interface Pair {
  access: string;
  refresh: string;
}

let current: Pair | null = null;
const listeners = new Set<(reason: SessionEndReason) => void>();

/** Access/refresh token juftligi: xotirada + secure storage'da. */
export const tokens = {
  async load(): Promise<boolean> {
    const [access, refresh] = await Promise.all([storage.get(KEYS.accessToken), storage.get(KEYS.refreshToken)]);
    current = access && refresh ? { access, refresh } : null;
    return current !== null;
  },

  get access(): string | undefined {
    return current?.access;
  },

  get refresh(): string | undefined {
    return current?.refresh;
  },

  async save(t: Pick<Tokens, 'access_token' | 'refresh_token'>): Promise<void> {
    current = { access: t.access_token, refresh: t.refresh_token };
    // Rotation'dan keyin eski refresh token yaroqsiz — yangisini darhol saqlaymiz
    await Promise.all([storage.set(KEYS.accessToken, t.access_token), storage.set(KEYS.refreshToken, t.refresh_token)]);
  },

  /** Token'larni o'chiradi va sessiya tinglovchilariga xabar beradi. */
  async end(reason: SessionEndReason): Promise<void> {
    const had = current !== null;
    current = null;
    await Promise.all([storage.remove(KEYS.accessToken), storage.remove(KEYS.refreshToken)]);
    if (had) listeners.forEach((fn) => fn(reason));
  },

  onEnd(fn: (reason: SessionEndReason) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
