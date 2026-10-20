import { useEffect } from 'react';
import { router } from 'expo-router';
import { Loading } from '@matchup/ui';

/**
 * Telegram Login deep link'i (matchup://auth/telegram#tgAuthResult=...). Natijani WebBrowser auth sessiyasi
 * o'zi ushlaydi; Android'da ilova URL bilan ham ochilishi mumkin — shunda login ekraniga qaytamiz.
 */
export default function TelegramReturnScreen() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/login');
  }, []);
  return <Loading />;
}
