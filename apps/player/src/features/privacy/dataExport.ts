import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { DataSubjectRequest } from '@matchup/contracts';
import { API_URL, api, authHeaders, call, refreshOnce } from '@/api/client';
import { ApiError } from '@/api/errors';

const FILE_PREFIX = 'matchup-data-';

/** Yuklash xatosida javob tanasi o'qilmaydi — HTTP holati bo'yicha Problem `code`. */
const STATUS_CODES: Record<number, string> = { 401: 'UNAUTHORIZED', 404: 'NOT_FOUND', 409: 'EXPORT_NOT_READY', 410: 'EXPORT_EXPIRED' };

/** expo-file-system: "Unable to download a file: response has status 410" -> ApiError. */
function downloadError(err: unknown): ApiError {
  const message = err instanceof Error ? err.message : String(err);
  const status = Number(/status (\d{3})/.exec(message)?.[1] ?? /HTTP (\d{3})/.exec(message)?.[1]);
  if (!status) return ApiError.network(err);
  return new ApiError({ status, code: STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'UNKNOWN') });
}

/**
 * Tayyor eksport faylini (`download_url`) Bearer token bilan diskka yuklaydi va ulashish oynasini ochadi
 * (Fayllar, AirDrop, pochta ...). Fayl ilovaning kesh papkasida — avvalgi nusxalar o'chiriladi.
 */
export async function shareDataExport(request: DataSubjectRequest, dialogTitle: string): Promise<void> {
  if (!request.download_url) throw new ApiError({ status: 409, code: 'EXPORT_NOT_READY' });
  const filename = `${FILE_PREFIX}${(request.completed_at ?? request.requested_at).slice(0, 10)}.json`;
  if (Platform.OS === 'web') return saveOnWeb(request.id, filename);
  if (!(await Sharing.isAvailableAsync())) throw ApiError.client('SHARING_UNAVAILABLE');

  removeOldCopies();
  const file = await downloadWithAuth(`${API_URL}${request.download_url}`, new File(Paths.cache, filename));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle });
}

/** Access token muddati o'tgan bo'lsa (401) — bir marta yangilab qayta urinadi. */
async function downloadWithAuth(url: string, destination: File): Promise<File> {
  const attempt = (token?: string) => File.downloadFileAsync(url, destination, { headers: authHeaders(token), idempotent: true });
  let error: ApiError;
  try {
    return await attempt();
  } catch (err) {
    error = downloadError(err);
  }
  if (error.status !== 401) throw error;
  const fresh = await refreshOnce();
  if (!fresh) throw error;
  try {
    return await attempt(fresh);
  } catch (err) {
    throw downloadError(err);
  }
}

/** Shaxsiy ma'lumotlar keshda to'planib qolmasin: har yuklashda faqat oxirgi nusxa qoladi. */
function removeOldCopies() {
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && entry.name.startsWith(FILE_PREFIX)) entry.delete();
    }
  } catch {
    // Kesh tozalanmasa ham yuklash davom etadi
  }
}

/** Web: fetch (refresh bilan) -> Blob -> brauzer yuklashi. */
async function saveOnWeb(id: string, filename: string): Promise<void> {
  const blob = await call(api.GET('/v1/me/data-exports/{id}', { params: { path: { id } }, parseAs: 'blob' }));
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
