import { useEffect, useMemo, useState } from 'react';
import type { City, GeoPoint } from '@matchup/contracts';
import { type DevicePosition, distanceKm, getDevicePosition } from '@/lib/location';

/** Qurilma shahardan shuncha km'dan uzoq bo'lsa (masalan, simulator Kupertinoda) — shahar markazi ishlatiladi. */
const MAX_DEVICE_DISTANCE_KM = 100;

export type OriginMode = 'near' | 'city';

export interface DiscoveryOrigin {
  point: GeoPoint;
  source: 'device' | 'city';
  /** Nega shahar markaziga qaytildi (UI xabari uchun). */
  fallback?: 'far' | 'denied';
}

export function useDiscoveryOrigin(city: City | undefined, mode: OriginMode): DiscoveryOrigin | undefined {
  const [device, setDevice] = useState<DevicePosition | null>(null);

  useEffect(() => {
    if (mode !== 'near' || device !== null) return;
    let cancelled = false;
    void getDevicePosition().then((p) => {
      if (!cancelled) setDevice(p);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, device]);

  return useMemo(() => {
    const center = city?.center;
    if (!center) return undefined;
    if (mode === 'city') return { point: center, source: 'city' };
    if (device === null) return undefined; // ruxsat / joylashuv kutilmoqda
    if (device.status !== 'granted') return { point: center, source: 'city', fallback: 'denied' };
    if (distanceKm(device.point, center) > MAX_DEVICE_DISTANCE_KM) return { point: center, source: 'city', fallback: 'far' };
    return { point: device.point, source: 'device' };
  }, [city, mode, device]);
}
