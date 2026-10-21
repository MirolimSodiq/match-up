import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Kichik qiymatlar uchun kalit-qiymat ombori. Native'da Keychain/Keystore (expo-secure-store),
 * web'da (faqat dev preview) localStorage.
 */
export const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },

  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // private rejim — e'tiborsiz
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },

  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // e'tiborsiz
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export const KEYS = {
  accessToken: 'mu.host.access_token',
  refreshToken: 'mu.host.refresh_token',
  deviceId: 'mu.host.device_id',
  locale: 'mu.host.locale',
  devOffline: 'mu.host.dev_offline',
  profile: 'mu.host.profile',
  recordingCellular: 'mu.host.recording_cellular',
} as const;
