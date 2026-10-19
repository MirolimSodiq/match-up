'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { MESSAGES, type Messages } from './messages';

export type Lang = 'uz-Latn' | 'ru';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'uz-Latn', label: 'UZ' },
  { code: 'ru', label: 'RU' },
];

/** "{n} ta match" + { n: 3 } -> "3 ta match" */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

interface I18n {
  lang: Lang;
  m: Messages;
  f: typeof fmt;
  setLang: (lang: Lang) => void;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const qc = useQueryClient();
  const router = useRouter();

  const setLang = useCallback(
    (next: Lang) => {
      // API Accept-Language'ni shu cookie'dan oladi (BFF) -> pul va kontent tarjimasi ham almashadi
      document.cookie = `mu_lang=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next === 'ru' ? 'ru' : 'uz-Latn';
      setLangState(next);
      void qc.invalidateQueries();
      router.refresh();
    },
    [qc, router],
  );

  const value = useMemo(() => ({ lang, m: MESSAGES[lang], f: fmt, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider topilmadi');
  return v;
}
