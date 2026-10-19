import { useEffect, useState } from 'react';

/** Har `intervalMs` da yangilanadigan joriy vaqt (taymerlar uchun). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Qolgan vaqt: "9:05" yoki "1:02:09" (manfiy bo'lsa 0:00). */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Masofa: 850 -> "850 m", 1234 -> "1.2 km". */
export function formatDistance(m: number, units: { m: (v: number) => string; km: (v: string) => string }): string {
  return m < 1000 ? units.m(Math.round(m)) : units.km((m / 1000).toFixed(1));
}
