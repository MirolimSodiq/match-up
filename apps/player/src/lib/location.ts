import * as Location from 'expo-location';
import type { GeoPoint } from '@matchup/contracts';

/** Ikki nuqta orasidagi masofa (km), haversine. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export type DevicePosition = { status: 'granted'; point: GeoPoint } | { status: 'denied' } | { status: 'unavailable' };

/** Foreground ruxsat so'raydi va joriy (yoki oxirgi ma'lum) joylashuvni qaytaradi. */
export async function getDevicePosition(): Promise<DevicePosition> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== Location.PermissionStatus.GRANTED) return { status: 'denied' };
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { status: 'granted', point: { lat: pos.coords.latitude, lng: pos.coords.longitude } };
  } catch {
    return { status: 'unavailable' };
  }
}
