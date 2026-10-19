'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { User } from '@matchup/contracts';
import { api, authFetch, unwrap } from '@/lib/api';
import { LANGS, useI18n, type Lang } from '@/lib/i18n';
import { IconCalendar, IconCard, IconDashboard, IconLogout, IconPin, IconRefund, IconUsers } from './icons';
import { cx, Segmented } from './ui';

export function Shell({ children }: { children: ReactNode }) {
  const { m, lang, setLang } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  const me = useQuery({ queryKey: ['me'], queryFn: () => authFetch<User>('/api/auth/me'), staleTime: 5 * 60_000 });
  const queue = useQuery({
    queryKey: ['refunds', 'badge'],
    queryFn: () => unwrap(api.GET('/v1/admin/refunds', { params: { query: { limit: 1 } } })),
    refetchInterval: 60_000,
  });

  const nav = [
    { href: '/', label: m.nav.dashboard, icon: <IconDashboard />, exact: true },
    { href: '/matches', label: m.nav.matches, icon: <IconCalendar /> },
    { href: '/venues', label: m.nav.venues, icon: <IconPin /> },
    { href: '/hosts', label: m.nav.hosts, icon: <IconUsers /> },
    { href: '/payments', label: m.nav.payments, icon: <IconCard /> },
    { href: '/refunds', label: m.nav.refunds, icon: <IconRefund />, badge: queue.data?.total },
  ];

  async function logout() {
    setLeaving(true);
    await authFetch('/api/auth/logout', {}).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 z-30 flex flex-col border-b border-border bg-surface lg:h-screen lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:block lg:py-6">
          <Link href="/" className="block">
            <div className="display text-[26px] leading-7 text-text">Match Up</div>
            <div className="text-xs font-semibold text-text-muted">{m.app.tagline}</div>
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {nav.map((n) => {
            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-3 rounded-pill px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition',
                  active ? 'bg-primary text-on-primary shadow-card' : 'text-text-muted hover:bg-surface-muted hover:text-text',
                )}
              >
                {n.icon}
                <span className="flex-1">{n.label}</span>
                {n.badge ? (
                  <span className={cx('rounded-pill px-2 text-xs tabular-nums', active ? 'bg-sport-glass-strong' : 'bg-warning-soft text-warning')}>{n.badge}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="hidden border-t border-border p-4 lg:block">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">
              {(me.data?.display_name ?? '·').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{me.data?.display_name ?? '…'}</div>
              <div className="truncate text-xs text-text-muted">{me.data?.phone}</div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Segmented size="sm" value={lang} onChange={(v: Lang) => setLang(v)} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
            <button type="button" onClick={logout} disabled={leaving} className="flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm font-semibold text-text-muted hover:bg-surface-muted hover:text-text">
              <IconLogout />
              {m.nav.logout}
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mb-4 flex justify-end gap-2 lg:hidden">
          <Segmented size="sm" value={lang} onChange={(v: Lang) => setLang(v)} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
          <button type="button" onClick={logout} className="rounded-pill p-2 text-text-muted hover:bg-surface-muted" aria-label={m.nav.logout}>
            <IconLogout />
          </button>
        </div>
        <div className="mx-auto max-w-[1280px]">{children}</div>
      </main>
    </div>
  );
}
