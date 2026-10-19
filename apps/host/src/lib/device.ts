import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import type { DeviceInfo } from '@matchup/contracts';
import { KEYS, storage } from './storage';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

let deviceId: string | undefined;

/** O'rnatish bo'yicha barqaror qurilma identifikatori (sessiyalar ro'yxati, waiver imzosi uchun). */
export async function loadDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  const stored = await storage.get(KEYS.deviceId);
  if (stored) {
    deviceId = stored;
    return stored;
  }
  const created = randomUUID();
  await storage.set(KEYS.deviceId, created);
  deviceId = created;
  return created;
}

export function currentDeviceId(): string | undefined {
  return deviceId;
}

export async function deviceInfo(locale: string): Promise<DeviceInfo> {
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
  return { device_id: await loadDeviceId(), platform, app_version: APP_VERSION, locale };
}

export const uuid = () => randomUUID();
