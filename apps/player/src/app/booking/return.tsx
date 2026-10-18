import { useEffect } from 'react';
import { router } from 'expo-router';
import { Loading } from '@/components/ui';
import { closeCheckout, lastPendingBooking } from '@/features/payment';

/**
 * Payme/Click `return_url` deep link'i (matchup://booking/return). Booking id'si URL'da yo'q —
 * booking yaratilishidan oldin ma'lum emas — shuning uchun oxirgi kutilayotgan booking'ga qaytamiz.
 */
export default function PaymentReturnScreen() {
  useEffect(() => {
    closeCheckout();
    const id = lastPendingBooking();
    if (router.canGoBack()) router.back();
    else if (id) router.replace({ pathname: '/booking/[id]', params: { id } });
    else router.replace('/bookings');
  }, []);
  return <Loading />;
}
