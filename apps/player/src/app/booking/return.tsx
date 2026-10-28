import { useEffect } from 'react';
import { router } from 'expo-router';
import { Loading } from '@matchup/ui';
import { closeCheckout, lastPendingBooking } from '@/features/payment';

/**
 * Payme/Click/Rahmat `return_url` deep link'i (matchup://booking/return; Rahmat'da `return_error_url` ham shu). Booking id'si URL'da yo'q —
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
