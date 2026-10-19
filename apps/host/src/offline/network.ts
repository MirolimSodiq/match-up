import { useSyncExternalStore } from 'react';
import * as Network from 'expo-network';
import { KEYS, storage } from '@/lib/storage';

/**
 * Tarmoq holati: tizim (expo-network) + dev "offline rejim" (simulyatorda internetni o'chirib bo'lmaydi).
 * Tizim "ulangan" desa ham server javob bermasligi mumkin — haqiqiy holatni so'rov natijasi hal qiladi,
 * bu yerdagi qiymat faqat sinxronni darhol boshlash uchun signal.
 */
type Listener = () => void;

let systemOnline = true;
let forcedOffline = false;
const listeners = new Set<Listener>();
let snapshot = { online: true, forcedOffline: false };

function update() {
  const online = systemOnline && !forcedOffline;
  if (snapshot.online === online && snapshot.forcedOffline === forcedOffline) return;
  snapshot = { online, forcedOffline };
  listeners.forEach((fn) => fn());
}

const fromState = (s: Network.NetworkState) => s.isConnected !== false && s.isInternetReachable !== false;

export const network = {
  get forcedOffline() {
    return forcedOffline;
  },
  get online() {
    return snapshot.online;
  },

  /** Ilova ishga tushganda bir marta. */
  async start(): Promise<void> {
    forcedOffline = __DEV__ && (await storage.get(KEYS.devOffline)) === '1';
    try {
      systemOnline = fromState(await Network.getNetworkStateAsync());
    } catch {
      systemOnline = true;
    }
    Network.addNetworkStateListener((s) => {
      systemOnline = fromState(s);
      update();
    });
    update();
  },

  async setForcedOffline(value: boolean): Promise<void> {
    forcedOffline = value;
    await storage.set(KEYS.devOffline, value ? '1' : '0');
    update();
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useNetwork() {
  return useSyncExternalStore(network.subscribe, () => snapshot);
}
