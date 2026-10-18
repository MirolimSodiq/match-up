import { createContext, type PropsWithChildren, use, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthSuccess, User } from '@matchup/contracts';
import { api, call } from '@/api/client';
import { ApiError } from '@/api/errors';
import { qk } from '@/api/queries';
import { currentLocale, restoreLocale, toAppLocale } from '@/i18n';
import { loadDeviceId } from '@/lib/device';
import { type SessionEndReason, tokens } from './tokens';

/**
 * - `loading`    — token'lar va profil o'qilmoqda (splash ko'rinadi)
 * - `signedOut`  — login ekranlari
 * - `onboarding` — yangi foydalanuvchi: ism, shahar, sport, consent'lar
 * - `signedIn`   — asosiy ilova
 * - `offline`    — token bor, lekin profilni olib bo'lmadi (tarmoq)
 */
export type SessionStatus = 'loading' | 'signedOut' | 'onboarding' | 'signedIn' | 'offline';

interface SessionValue {
  status: SessionStatus;
  user?: User;
  /** Oxirgi sessiya nima uchun tugadi (login ekranida xabar uchun). */
  endedReason?: Exclude<SessionEndReason, 'logout'>;
  signIn(auth: AuthSuccess): Promise<void>;
  signOut(): Promise<void>;
  /** Onboarding tugagach yangilangan profil. */
  completeOnboarding(user: User): void;
  retry(): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = use(SessionContext);
  if (!v) throw new Error('useSession: SessionProvider ichida chaqiring');
  return v;
}

const statusFor = (u: User): SessionStatus => (u.onboarded === false ? 'onboarding' : 'signedIn');

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<User>();
  const [endedReason, setEndedReason] = useState<SessionValue['endedReason']>();
  const [attempt, setAttempt] = useState(0);

  const applyUser = useCallback(
    (u: User) => {
      setUser(u);
      queryClient.setQueryData(qk.me, u);
      setStatus(statusFor(u));
    },
    [queryClient],
  );

  // Ishga tushish: til, qurilma id, saqlangan sessiya
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([restoreLocale(), loadDeviceId()]);
      if (!(await tokens.load())) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      try {
        const me = await call(api.GET('/v1/me'));
        if (!cancelled) applyUser(me);
      } catch (err) {
        if (cancelled) return;
        // 401 + muvaffaqiyatsiz refresh bo'lsa tokens.end() allaqachon signedOut qiladi
        if (err instanceof ApiError && err.code === 'NETWORK') setStatus('offline');
        else if (!tokens.access) setStatus('signedOut');
        else setStatus('offline');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyUser, attempt]);

  // Refresh token bekor qilinsa (TOKEN_REUSED / muddati o'tgan) yoki logout — login'ga qaytamiz
  useEffect(
    () =>
      tokens.onEnd((reason) => {
        setUser(undefined);
        setEndedReason(reason === 'logout' ? undefined : reason);
        setStatus('signedOut');
        queryClient.clear();
      }),
    [queryClient],
  );

  const signIn = useCallback(
    async (auth: AuthSuccess) => {
      await tokens.save(auth);
      setEndedReason(undefined);
      // Ekranda tanlangan til ustun: profil (push/SMS tili) boshqacha bo'lsa — serverga yozamiz
      const locale = currentLocale();
      if (toAppLocale(auth.user.locale) !== locale) {
        void call(api.PATCH('/v1/me', { body: { locale } })).catch(() => undefined);
      }
      if (auth.is_new_user) {
        setUser(auth.user);
        queryClient.setQueryData(qk.me, auth.user);
        setStatus('onboarding');
      } else {
        applyUser(auth.user);
      }
    },
    [applyUser, queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await call(api.POST('/v1/auth/logout'));
    } catch {
      // Server sessiyasi baribir muddati bilan tugaydi; lokal chiqish muhimroq
    }
    await tokens.end('logout');
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      endedReason,
      signIn,
      signOut,
      completeOnboarding: applyUser,
      retry: () => {
        setStatus('loading');
        setAttempt((a) => a + 1);
      },
    }),
    [status, user, endedReason, signIn, signOut, applyUser],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}
