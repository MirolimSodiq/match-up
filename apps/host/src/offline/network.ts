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
let systemWifi = false;
let forcedOffline = false;
const listeners = new Set<Listener>();
let snapshot = { online: true, forcedOffline: false, wifi: false };

function update() {
  const online = systemOnline && !forcedOffline;
  const wifi = online && systemWifi;
  if (snapshot.online === online && snapshot.forcedOffline === forcedOffline && snapshot.wifi === wifi) return;
  snapshot = { online, forcedOffline, wifi };
  listeners.forEach((fn) => fn());
}

const fromState = (s: Network.NetworkState) => s.isConnected !== false && s.isInternetReachable !== false;
/** Katta yozuv fayllari mobil internetda yuklanmaydi (standart) — Wi-Fi yoki kabel. */
const isWifi = (s: Network.NetworkState) => s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET;

export const network = {
  get forcedOffline() {
    return forcedOffline;
  },
  get online() {
    return snapshot.online;
  },
  get wifi() {
    return snapshot.wifi;
  },

  /** Ilova ishga tushganda bir marta. */
  async start(): Promise<void> {
    forcedOffline = __DEV__ && (await storage.get(KEYS.devOffline)) === '1';
    try {
      const s = await Network.getNetworkStateAsync();
      systemOnline = fromState(s);
      systemWifi = isWifi(s);
    } catch {
      systemOnline = true;
    }
    Network.addNetworkStateListener((s) => {
      systemOnline = fromState(s);
      systemWifi = isWifi(s);
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
