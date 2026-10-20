import '@/lib/sentry'; // birinchi: Sentry (DSN bo'lsa) boshqa modullardan oldin
import '@/i18n';
import { type PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DefaultTheme, SplashScreen, Stack, type Theme, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button, colors, ErrorView, fontAssets, fontFamily, navigationColors, ToastProvider, type UIConfig, UIProvider } from '@matchup/ui';
import { ApiError } from '@/api/errors';
import { SessionProvider, useSession } from '@/auth/session';
import { errorMessage } from '@/i18n/errors';

/** React Navigation mavzusi: header va ekran foni och. */
const navigationTheme: Theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, ...navigationColors } };

void SplashScreen.preventAutoHideAsync();
// Klaviatura, modal va o'tishlar ortidagi ildiz fon ham ilova fonida bo'lsin
void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);

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
  // Shrift yuklanmasa ham ilova ishlaydi (tizim shriftiga qaytadi)
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  // Ilova fonga o'tganda polling to'xtaydi, qaytganda (masalan, Payme ilovasidan) so'rovlar yangilanadi
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider style={styles.root}>
      <ThemeProvider value={navigationTheme}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <LocalizedUI>
              <ToastProvider>
                <StatusBar style="dark" />
                {fontsLoaded || fontError ? <RootNavigator /> : null}
              </ToastProvider>
            </LocalizedUI>
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Dizayn tizimi komponentlaridagi umumiy matnlar va xato tarjimasi — joriy tilda. */
function LocalizedUI({ children }: PropsWithChildren) {
  const { t, i18n } = useTranslation();
  const value = useMemo<UIConfig>(
    () => ({ closeLabel: t('common.close'), retryLabel: t('common.retry'), formatError: (err) => errorMessage(t, err) }),
    // `t` til bilan birga yangilanadi; `i18n.language` — aniqlik uchun
    [t, i18n.language],
  );
  return <UIProvider value={value}>{children}</UIProvider>;
}

function RootNavigator() {
  const { t } = useTranslation();
  const { status, retry, signOut } = useSession();

  // Sessiya o'qilguncha navigator yo'q (splash ko'rinadi): aks holda guard'lar deep link'ni login'ga burib yuboradi
  if (status === 'loading') return null;
  SplashScreen.hide();

  if (status === 'offline') {
    return (
      <View style={styles.offline}>
        <ErrorView error={ApiError.network()} onRetry={retry} />
        <Button title={t('profile.logout')} variant="ghost" onPress={() => void signOut()} />
      </View>
    );
  }

  const signedIn = status === 'signedIn';
  // Sport rangidagi ekranlar va oq sheet'lar o'z sarlavhasini chizadi
  const sheet = { headerShown: false, presentation: 'modal' } as const;
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text, fontFamily: fontFamily.semibold },
        headerShadowVisible: false,
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
        <Stack.Screen name="match/[id]/index" options={sheet} />
        <Stack.Screen name="match/[id]/waiver" options={sheet} />
        <Stack.Screen name="match/[id]/checkout" options={sheet} />
        <Stack.Screen name="booking/[id]/index" options={{ headerShown: false }} />
        <Stack.Screen name="booking/[id]/pay" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="booking/[id]/ticket" options={sheet} />
        <Stack.Screen name="booking/return" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  offline: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
});
