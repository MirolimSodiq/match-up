import { createContext, type PropsWithChildren, use, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthSuccess, User } from '@matchup/contracts';
import { api, call } from '@/api/client';
import { ApiError } from '@/api/errors';
import { qk } from '@/api/queries';
import { currentLocale, restoreLocale, toAppLocale } from '@/i18n';
import { loadDeviceId } from '@/lib/device';
import { KEYS, storage } from '@/lib/storage';
import { network } from '@/offline/network';
import { offlineStore } from '@/offline/store';
import { uploadEngine } from '@/media/uploads';
import { syncEngine } from '@/offline/sync';
import { type SessionEndReason, tokens } from './tokens';

/**
 * - `loading`  — token'lar va profil o'qilmoqda (splash)
 * - `signedOut`— login
 * - `notHost`  — kirdi, lekin `GET /v1/me` -> `roles` da `host` yo'q
 * - `signedIn` — host ilovasi (internetsiz ochilsa ham: oxirgi saqlangan profil bilan)
 */
export type SessionStatus = 'loading' | 'signedOut' | 'notHost' | 'signedIn';

interface SessionValue {
  status: SessionStatus;
  user?: User;
  /** Profil serverdan emas, diskdan olingan (internet yo'q edi). */
  offlineProfile: boolean;
  endedReason?: Exclude<SessionEndReason, 'logout'>;
  signIn(auth: AuthSuccess): Promise<void>;
  signOut(): Promise<void>;
  /** `notHost` holatida rolni qayta tekshirish (admin endigina host qilgan bo'lsa). */
  recheck(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = use(SessionContext);
  if (!v) throw new Error('useSession: SessionProvider ichida chaqiring');
  return v;
}

export const isHost = (u: User | undefined) => !!u?.roles.includes('host');

/** Profil diskda saqlanadi: maydonda internetsiz ilova ochilsa ham host ishlay olsin. */
async function cacheUser(u: User | undefined) {
  if (u) await storage.set(KEYS.profile, JSON.stringify({ id: u.id, display_name: u.display_name, phone: u.phone, roles: u.roles, locale: u.locale, country_code: u.country_code }));
  else await storage.remove(KEYS.profile);
}

async function cachedUser(): Promise<User | undefined> {
  try {
    const raw = await storage.get(KEYS.profile);
    return raw ? (JSON.parse(raw) as User) : undefined;
  } catch {
    return undefined;
  }
}

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<User>();
  const [offlineProfile, setOfflineProfile] = useState(false);
  const [endedReason, setEndedReason] = useState<SessionValue['endedReason']>();

  const applyUser = useCallback(
    (u: User, fromCache = false) => {
      setUser(u);
      setOfflineProfile(fromCache);
      queryClient.setQueryData(qk.me, u);
      const host = isHost(u);
      setStatus(host ? 'signedIn' : 'notHost');
      syncEngine.setUser(host ? u.id : undefined);
      uploadEngine.setUser(host ? u.id : undefined);
      if (!fromCache) void cacheUser(u);
    },
    [queryClient],
  );

  // Ishga tushish: til, qurilma id, tarmoq, offline store, saqlangan sessiya
  useEffect(() => {
    let cancelled = false;
    (async () => {
      offlineStore.hydrate();
      await Promise.all([restoreLocale(), loadDeviceId(), network.start()]);
      if (!(await tokens.load())) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      try {
        const me = await call(api.GET('/v1/me'));
        if (!cancelled) applyUser(me);
      } catch (err) {
        if (cancelled) return;
        // Internet yo'q — oxirgi profil bilan ishlaymiz (navbat keyin sinxronlanadi)
        const cached = await cachedUser();
        if (err instanceof ApiError && err.code === 'NETWORK' && cached) applyUser(cached, true);
        else if (!tokens.access) setStatus('signedOut');
        else if (cached) applyUser(cached, true);
        else setStatus('signedOut');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyUser]);

  // Refresh token bekor qilinsa yoki logout — login'ga qaytamiz
  useEffect(
    () =>
      tokens.onEnd((reason) => {
        setUser(undefined);
        setEndedReason(reason === 'logout' ? undefined : reason);
        setStatus('signedOut');
        syncEngine.setUser(undefined);
        uploadEngine.setUser(undefined);
        void cacheUser(undefined);
        queryClient.clear();
      }),
    [queryClient],
  );

  const signIn = useCallback(
    async (auth: AuthSuccess) => {
      await tokens.save(auth);
      setEndedReason(undefined);
      const locale = currentLocale();
      if (toAppLocale(auth.user.locale) !== locale) {
        void call(api.PATCH('/v1/me', { body: { locale } })).catch(() => undefined);
      }
      // Rollar token bilan birga keladi; ishonch uchun profilni qayta olamiz
      try {
        applyUser(await call(api.GET('/v1/me')));
      } catch {
        applyUser(auth.user);
      }
    },
    [applyUser],
  );

  const signOut = useCallback(async () => {
    try {
      await call(api.POST('/v1/auth/logout'));
    } catch {
      // Server sessiyasi baribir muddati bilan tugaydi
    }
    offlineStore.clearForLogout();
    await tokens.end('logout');
  }, []);

  const recheck = useCallback(async () => {
    applyUser(await call(api.GET('/v1/me')));
  }, [applyUser]);

  const value = useMemo<SessionValue>(
    () => ({ status, user, offlineProfile, endedReason, signIn, signOut, recheck }),
    [status, user, offlineProfile, endedReason, signIn, signOut, recheck],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}
