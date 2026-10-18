import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { colors } from '@/components/theme';

/** Provider sahifasidan ilovaga qaytish manzili (dev: exp://…/--/booking/return, prod: matchup://booking/return). */
export const paymentReturnUrl = () => Linking.createURL('booking/return');

/**
 * Yaratilgan checkout URL'lari (booking id -> url). `GET /v1/bookings/{id}` URL'ni qaytarmaydi,
 * shuning uchun "To'lov sahifasini ochish" tugmasi uchun shu sessiya davomida eslab qolamiz.
 */
const checkouts = new Map<string, string>();
let lastPendingBookingId: string | undefined;

export function rememberCheckout(bookingId: string, url: string) {
  checkouts.set(bookingId, url);
  lastPendingBookingId = bookingId;
}

export const checkoutUrlFor = (bookingId: string) => checkouts.get(bookingId);
export const lastPendingBooking = () => lastPendingBookingId;

/** Payme/Click sahifasini ilova ichidagi brauzerda ochadi; foydalanuvchi yopganda (yoki qaytganda) resolve bo'ladi. */
export async function openCheckout(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      controlsColor: colors.primary,
      dismissButtonStyle: 'close',
    });
  } catch {
    // Brauzer ochilmadi (masalan, web'da popup bloklandi) — "To'lov sahifasini ochish" tugmasi qoladi
  }
}

/** To'lov brauzerini yopadi (ochiq bo'lmasa yoki platforma qo'llamasa — jim). */
export function closeCheckout(): void {
  Promise.resolve()
    .then(() => WebBrowser.dismissBrowser())
    .catch(() => undefined);
}

export const PROVIDER_COLORS: Record<string, string> = {
  payme: '#00CCCC',
  click: '#0073FF',
  wallet: colors.primary,
};
