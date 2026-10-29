import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { colors } from '@matchup/ui';

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

/** Payme/Click/Rahmat sahifasini ilova ichidagi brauzerda ochadi; foydalanuvchi yopganda (yoki qaytganda) resolve bo'ladi. */
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

/** `return_url` (yoki ilova sxemasi) ga qaytish — provider sahifasi to'lovni yakunladi. */
export function isPaymentReturn(url: string): boolean {
  return url.startsWith(paymentReturnUrl()) || url.startsWith('matchup://');
}

/**
 * To'lov sahifasini ochadi: native'da ilova ichidagi WebView ekrani (/booking/[id]/pay),
 * web build'da — avvalgidek yangi oyna (react-native-webview web'da ishlamaydi).
 */
export function startPayment(bookingId: string): void {
  const url = checkoutUrlFor(bookingId);
  if (!url) return;
  if (Platform.OS === 'web') void openCheckout(url);
  else router.push({ pathname: '/booking/[id]/pay', params: { id: bookingId } });
}

/** To'lov brauzerini yopadi (ochiq bo'lmasa yoki platforma qo'llamasa — jim). */
export function closeCheckout(): void {
  Promise.resolve()
    .then(() => WebBrowser.dismissBrowser())
    .catch(() => undefined);
}

export const PROVIDER_COLORS: Record<string, string> = {
  payme: colors.payme,
  click: colors.click,
  multicard: colors.multicard,
  wallet: colors.wallet,
};

/** To'q brend fonidagi harf (kontrast uchun oq). */
export const PROVIDER_ON_COLORS: Record<string, string> = {
  multicard: colors.onPrimary,
};
