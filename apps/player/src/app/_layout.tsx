import '@/i18n';
import { useEffect, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api/errors';
import { SessionProvider, useSession } from '@/auth/session';
import { colors } from '@/components/theme';
import { Button, ErrorView } from '@/components/ui';

void SplashScreen.preventAutoHideAsync();

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Faqat tarmoq/5xx xatolarini qayta urinamiz; 4xx (biznes xatolar) darhol ko'rsatiladi
        retry: (count, err) => err instanceof ApiError && (err.code === 'NETWORK' || err.status >= 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

export default function RootLayout() {
  const [queryClient] = useState(makeQueryClient);

  // Ilova fonga o'tganda polling to'xtaydi, qaytganda (masalan, Payme ilovasidan) so'rovlar yangilanadi
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { t } = useTranslation();
  const { status, retry, signOut } = useSession();

  // Sessiya o'qilguncha navigator yo'q (splash ko'rinadi): aks holda guard'lar deep link'ni login'ga burib yuboradi
  if (status === 'loading') return null;
  SplashScreen.hide();

  if (status === 'offline') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ErrorView error={ApiError.network()} onRetry={retry} />
        <Button title={t('profile.logout')} variant="ghost" onPress={() => void signOut()} />
      </View>
    );
  }

  const signedIn = status === 'signedIn';
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'onboarding'}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('tabs.discover') }} />
        <Stack.Screen name="match/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="match/[id]/waiver" options={{ title: t('waiver.title') }} />
        <Stack.Screen name="match/[id]/checkout" options={{ title: t('checkout.title') }} />
        <Stack.Screen name="booking/[id]/index" options={{ title: t('booking.title') }} />
        <Stack.Screen name="booking/[id]/ticket" options={{ title: t('ticket.title'), presentation: 'modal' }} />
        <Stack.Screen name="booking/return" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
