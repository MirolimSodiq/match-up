import '@/i18n';
import { type PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { AppState, Platform, StyleSheet } from 'react-native';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DefaultTheme, SplashScreen, Stack, type Theme, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, fontAssets, fontFamily, navigationColors, ToastProvider, type UIConfig, UIProvider } from '@matchup/ui';
import { ApiError } from '@/api/errors';
import { SessionProvider, useSession } from '@/auth/session';
import { errorMessage } from '@/i18n/errors';
import { syncEngine } from '@/offline/sync';

const navigationTheme: Theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, ...navigationColors } };

void SplashScreen.preventAutoHideAsync();
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
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    syncEngine.start(queryClient);
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, [queryClient]);

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
  const { status } = useSession();

  // Sessiya o'qilguncha navigator yo'q (splash ko'rinadi)
  if (status === 'loading') return null;
  SplashScreen.hide();

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
      <Stack.Protected guard={status === 'notHost'}>
        <Stack.Screen name="not-host" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="match/[id]/index" options={{ headerShown: false }} />
        <Stack.Screen name="match/[id]/scan" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="match/[id]/teams" options={sheet} />
        <Stack.Screen name="match/[id]/complete" options={sheet} />
        <Stack.Screen name="match/[id]/sync" options={sheet} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
