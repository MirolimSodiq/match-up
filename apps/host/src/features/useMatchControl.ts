import { useMemo } from 'react';
import { useHostMatch, useRoster } from '@/api/queries';
import { useSession } from '@/auth/session';
import { applyEvents, rosterCounts } from '@/offline/core';
import { useOfflineStore } from '@/offline/store';

/**
 * O'yin boshqaruvi uchun yagona holat: roster (tarmoq yoki disk) + lokal navbat = ekrandagi ro'yxat.
 * QR skaner, jamoalar va yakunlash ekranlari shu hook'dan foydalanadi.
 */
export function useMatchControl(matchId: string) {
  const { user } = useSession();
  const host = useHostMatch(matchId);
  const roster = useRoster(matchId);
  const events = useOfflineStore((s) => s.eventsFor(matchId), [matchId]);
  const sync = useOfflineStore((s) => s.getSync(matchId), [matchId]);
  const pendingCount = useOfflineStore((s) => s.pendingCount(user?.id, matchId), [matchId, user?.id]);

  const data = roster.data;
  const participants = useMemo(
    () => (data ? applyEvents(data.roster.participants ?? [], events, data.fetchedAt) : []),
    [data, events],
  );
  const counts = useMemo(() => rosterCounts(participants), [participants]);
  const summary = data?.roster.match ?? host.match?.match;

  return {
    hostMatch: host.match,
    summary,
    roster,
    rosterData: data,
    participants,
    counts,
    events,
    sync,
    pendingCount,
    sides: data?.roster.sides ?? [],
    publicKey: data?.roster.qr_public_key,
  };
}
