import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { contentTypeFor, type UploadJob, validateClip } from './uploadCore';

export interface PickedClip {
  uri: string;
  contentType: UploadJob['contentType'];
  sizeBytes: number;
  durationMs: number;
  recordedAt?: string;
}

export type PickResult = { ok: true; clip: PickedClip } | { ok: false; reason: 'cancelled' | 'permission' | 'TOO_LARGE' | 'TOO_LONG' | 'UNSUPPORTED' };

/**
 * Diskdagi haqiqiy hajm: qismlar shundan hisoblanadi va har qism `Content-Length` imzosiga kiradi.
 * Picker metama'lumoti (eksportdan oldingi asl fayl) bilan farq qilishi mumkin — faqat zaxira.
 */
function sizeOf(uri: string, fallback?: number | null): number {
  try {
    const size = Number(new File(uri).size);
    if (size > 0) return size;
  } catch {
    // zaxira — picker qiymati
  }
  return fallback && fallback > 0 ? fallback : 0;
}

export function toClip(input: { uri: string; mimeType?: string | null; fileSize?: number | null; durationMs: number; recordedAt?: string }): PickResult {
  const contentType = contentTypeFor(input.uri, input.mimeType);
  const sizeBytes = sizeOf(input.uri, input.fileSize);
  const invalid = validateClip({ sizeBytes, durationMs: input.durationMs, contentType });
  if (invalid) return { ok: false, reason: invalid };
  return { ok: true, clip: { uri: input.uri, contentType: contentType!, sizeBytes, durationMs: input.durationMs, recordedAt: input.recordedAt } };
}

/**
 * Galereyadan video. iOS: 60 s gacha qirqish oynasi va 720p H.264 ga eksport (hajm kichrayadi,
 * server cheklovi ≤ 150 MB) — `ARCHITECTURE` §4.10 dagi "client 720p ga siqadi".
 */
export async function pickFromLibrary(): Promise<PickResult> {
  // Android'da tizim Photo Picker'i ruxsatsiz ishlaydi; Android ≤ 12 da bu so'rov xotira ruxsatini so'rardi,
  // u esa manifestdan olib tashlangan (app.json `blockedPermissions`) — so'ralsa doim rad etiladi
  if (Platform.OS !== 'android') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'permission' };
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsEditing: true,
    videoMaxDuration: 60,
    videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (res.canceled || !res.assets[0]) return { ok: false, reason: 'cancelled' };
  const a = res.assets[0];
  return toClip({ uri: a.uri, mimeType: a.mimeType, fileSize: a.fileSize, durationMs: a.duration ?? 0 });
}
