'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ToastProvider } from '@/components/toast';
import { ApiError } from '@/lib/api';
import { I18nProvider, type Lang } from '@/lib/i18n';

export function Providers({ lang, children }: { lang: Lang; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            // 4xx — qayta urinish foydasiz (401 da sessionGuard login'ga yo'naltiradi)
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <I18nProvider initial={lang}>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
