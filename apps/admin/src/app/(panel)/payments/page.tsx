'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import type { AdminPayment } from '@matchup/contracts';
import { IconSearch } from '@/components/icons';
import { Card, DataTable, ErrorBox, MoneyText, PageHeader, Pager, StatusBadge } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { dayRange, formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { debounce, useUrlState } from '@/lib/use-url-state';

const LIMIT = 50;
const STATUSES = ['succeeded', 'created', 'pending', 'refunded', 'partially_refunded', 'cancelled', 'failed', 'expired'] as const;
const PROVIDERS = ['payme', 'click', 'wallet'] as const;

function PaymentsTable() {
  const { m, f, lang } = useI18n();
  const [s, setS] = useUrlState({ status: '', provider: '', from: '', to: '', q: '', offset: '0' });
  const [search, setSearch] = useState(s.q);
  const pushQ = useMemo(() => debounce((q: string) => setS({ q, offset: '0' }), 350), [setS]);

  const range = s.from && s.to ? dayRange(s.from, s.to) : s.from ? { date_from: dayRange(s.from, s.from).date_from } : s.to ? { date_to: dayRange(s.to, s.to).date_to } : {};
  const query = {
    limit: LIMIT,
    offset: Number(s.offset) || 0,
    ...range,
    ...(s.status ? { status: s.status } : {}),
    ...(s.provider ? { provider: s.provider } : {}),
    ...(s.q ? { q: s.q } : {}),
  };
  const list = useQuery({ queryKey: ['payments', query], queryFn: () => unwrap(api.GET('/v1/admin/payments', { params: { query } })), placeholderData: keepPreviousData });

  const columns = useMemo<ColumnDef<AdminPayment, unknown>[]>(
    () => [
      { id: 'at', header: m.payments.created, cell: ({ row: { original: p } }) => <span className="whitespace-nowrap">{formatDateTime(p.created_at, lang)}</span> },
      {
        id: 'player',
        header: m.payments.player,
        cell: ({ row: { original: p } }) => (
          <div>
            <div className="font-medium">{p.user.display_name}</div>
            <div className="text-xs tabular-nums text-text-muted">{p.user.phone}</div>
          </div>
        ),
      },
      {
        id: 'match',
        header: m.payments.match,
        cell: ({ row: { original: p } }) => (
          <Link href={`/matches/${p.match.id}`} className="hover:underline">
            <div className="font-mono text-xs font-semibold">{p.match.public_code}</div>
            <div className="text-xs text-text-muted">
              {p.match.venue_name} · {formatDateTime(p.match.starts_at, lang)}
            </div>
          </Link>
        ),
      },
      { id: 'provider', header: m.payments.provider, cell: ({ row: { original: p } }) => <span className="font-semibold">{m.provider[p.provider] ?? p.provider}</span> },
      { id: 'amount', header: m.common.amount, cell: ({ row: { original: p } }) => <MoneyText money={p.amount} className="font-semibold" /> },
      { id: 'refunded', header: m.payments.refunded, cell: ({ row: { original: p } }) => (p.refunded.amount ? <MoneyText money={p.refunded} /> : <span className="text-text-muted">—</span>) },
      { id: 'status', header: m.common.status, cell: ({ row: { original: p } }) => <StatusBadge status={p.status} label={m.paymentStatus[p.status] ?? p.status} /> },
      { id: 'tx', header: m.matchDetail.tx, cell: ({ row: { original: p } }) => <span className="font-mono text-xs text-text-muted">{p.provider_transaction_id ?? '—'}</span> },
    ],
    [m, lang],
  );

  const totals = list.data?.totals ?? [];
  return (
    <>
      <PageHeader title={m.payments.title} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="field w-44" value={s.status} onChange={(e) => setS({ status: e.target.value, offset: '0' })} aria-label={m.common.status}>
          <option value="">
            {m.common.status}: {m.common.all}
          </option>
          {STATUSES.map((x) => (
            <option key={x} value={x}>
              {m.paymentStatus[x]}
            </option>
          ))}
        </select>
        <select className="field w-48" value={s.provider} onChange={(e) => setS({ provider: e.target.value, offset: '0' })} aria-label={m.payments.provider}>
          <option value="">
            {m.payments.provider}: {m.common.all}
          </option>
          {PROVIDERS.map((x) => (
            <option key={x} value={x}>
              {m.provider[x]}
            </option>
          ))}
        </select>
        <input type="date" className="field w-40" value={s.from} onChange={(e) => setS({ from: e.target.value, offset: '0' })} aria-label={m.common.from} />
        <span className="text-text-muted">—</span>
        <input type="date" className="field w-40" value={s.to} onChange={(e) => setS({ to: e.target.value, offset: '0' })} aria-label={m.common.to} />
        <label className="relative min-w-64 flex-1">
          <IconSearch className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
          <input
            className="field pl-9"
            placeholder={m.payments.searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              pushQ(e.target.value.trim());
            }}
          />
        </label>
      </div>
      {totals.map((t) => (
        <p key={t.currency} className="mb-3 text-sm text-text-muted">
          {f(m.payments.totals, { count: t.count, succeeded: t.succeeded?.formatted ?? '—', refunded: t.refunded?.formatted ?? '—' })}
        </p>
      ))}
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      <Card padded={false} className={list.isPlaceholderData ? 'opacity-60' : undefined}>
        <DataTable columns={columns} data={list.data?.items} loading={list.isLoading} rowKey={(p) => p.id} />
        <Pager total={list.data?.total ?? 0} limit={LIMIT} offset={Number(s.offset) || 0} onChange={(o) => setS({ offset: String(o) })} />
      </Card>
    </>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense>
      <PaymentsTable />
    </Suspense>
  );
}
