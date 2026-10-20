import { useQueryClient } from '@tanstack/react-query';
import type { Booking, MatchDetail, RealtimeSlots } from '@matchup/contracts';
import { qk } from '@/api/queries';
import { useRealtimeRoom } from './socket';

const isSlots = (s: object): s is RealtimeSlots => 'available' in s;

/**
 * Match tafsilotlarida jonli bo'sh joylar: `slots.updated` keshdagi sonlarni darhol yangilaydi,
 * so'ng ishtirokchilar ro'yxati uchun match qayta so'raladi.
 * `cacheKey` — ekran ochilgan identifikator (UUID yoki public code), `matchId` — xona uchun UUID.
 */
export function useMatchLive(cacheKey: string, matchId: string | undefined) {
  const queryClient = useQueryClient();
  const apply = (s: RealtimeSlots) => {
    const cur = queryClient.getQueryData<MatchDetail>(qk.match(cacheKey));
    if (!cur || (cur.status === s.status && cur.slots.taken === s.taken && cur.slots.max === s.max)) return false;
    queryClient.setQueryData<MatchDetail>(qk.match(cacheKey), {
      ...cur,
      status: s.status,
      slots: { ...cur.slots, taken: s.taken, available: s.available, max: s.max },
    });
    return true;
  };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: qk.match(cacheKey) });
  return useRealtimeRoom(
    matchId ? `match:${matchId}` : null,
    'slots.updated',
    (s) => {
      if (apply(s)) refresh();
    },
    // Qayta ulangandan keyin: uzilish paytida o'zgargan bo'lsa — sinxronlash
    (st) => isSlots(st) && apply(st) && refresh(),
  );
}

/**
 * Booking holati (to'lovdan qaytgach): `booking.updated` kelganda booking qayta so'raladi.
 * 2 soniyalik polling (useBooking) saqlanadi — WS faqat tezlashtiradi.
 */
export function useBookingLive(bookingId: string) {
  const queryClient = useQueryClient();
  const sync = (status: string) => {
    const cur = queryClient.getQueryData<Booking>(qk.booking(bookingId));
    if (cur && cur.status !== status) void queryClient.invalidateQueries({ queryKey: qk.booking(bookingId) });
  };
  return useRealtimeRoom(
    bookingId ? `booking:${bookingId}` : null,
    'booking.updated',
    (b) => sync(b.status),
    (st) => 'booking_id' in st && sync(st.status),
  );
}
