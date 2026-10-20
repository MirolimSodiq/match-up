import { useEffect } from 'react';
import { router } from 'expo-router';
import { Loading } from '@matchup/ui';
import { useSession } from '@/auth/session';

/**
 * Telegram Login deep link'i (matchup://auth/telegram#tgAuthResult=...). Natijani WebBrowser auth sessiyasi
 * o'zi ushlaydi; Android'da ilova URL bilan ham ochilishi mumkin — shunda oqim boshlangan ekranga qaytamiz
 * (login yoki profildagi "Kirish usullari").
 */
export default function TelegramReturnScreen() {
  const { status } = useSession();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else if (status === 'signedIn') router.replace('/account/sign-in-methods');
    else router.replace('/login');
    // Faqat ochilganda bir marta
  }, []);
  return <Loading />;
}
