'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import type { AdminMatch } from '@matchup/contracts';
import { IconPlus, IconSearch } from '@/components/icons';
import { Button, Card, DataTable, ErrorBox, MoneyText, PageHeader, Pager, Segmented, SlotsBar, SportChip, StatusBadge } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatPct, formatTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useAllVenues, useReference } from '@/lib/queries';
import { debounce, useUrlState } from '@/lib/use-url-state';

const LIMIT = 25;
const STATUSES = ['draft', 'open', 'full', 'in_progress', 'completed', 'cancelled'] as const;

function MatchesTable() {
  const { m, lang } = useI18n();
  const router = useRouter();
  const ref = useReference();
  const venues = useAllVenues(false);
  const [f, setF] = useUrlState({ scope: 'upcoming', status: '', city: '', venue: '', sport: '', q: '', offset: '0' });
  const [search, setSearch] = useState(f.q);
  const pushQ = useMemo(() => debounce((q: string) => setF({ q, offset: '0' }), 350), [setF]);

  const now = useMemo(() => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(), []);
  const query = {
    limit: LIMIT,
    offset: Number(f.offset) || 0,
    sort: f.scope === 'past' ? ('-starts_at' as const) : ('starts_at' as const),
    ...(f.scope === 'upcoming' ? { date_from: now } : f.scope === 'past' ? { date_to: now } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.city ? { city_id: Number(f.city) } : {}),
    ...(f.venue ? { venue_id: f.venue } : {}),
    ...(f.sport ? { sport: f.sport } : {}),
    ...(f.q ? { q: f.q } : {}),
  };
  const list = useQuery({
    queryKey: ['matches', query],
    queryFn: () => unwrap(api.GET('/v1/admin/matches', { params: { query } })),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<AdminMatch, unknown>[]>(
    () => [
      {
        id: 'when',
        header: m.matches.startsAt,
        cell: ({ row: { original: r } }) => (
          <div className="whitespace-nowrap">
            <div className="display text-lg leading-6">{formatTime(r.starts_at, r.timezone)}</div>
            <div className="text-xs text-text-muted">{formatDate(r.starts_at, lang, r.timezone)}</div>
          </div>
        ),
      },
      {
        id: 'match',
        header: m.payments.match,
        cell: ({ row: { original: r } }) => (
          <div className="min-w-48">
            <div className="flex items-center gap-2">
              <SportChip sport={r.sport} />
              <span className="font-mono text-xs text-text-muted">{r.public_code}</span>
            </div>
            <div className="mt-1 font-semibold">{r.title || `${r.format} ${r.venue.name}`}</div>
            <div className="text-xs text-text-muted">
              {r.venue.name} · {r.pitch.name} · {r.format}
            </div>
          </div>
        ),
      },
      { id: 'status', header: m.common.status, cell: ({ row: { original: r } }) => <StatusBadge status={r.status} label={m.matchStatus[r.status] ?? r.status} /> },
      {
        id: 'slots',
        header: m.matches.slots,
        cell: ({ row: { original: r } }) => <SlotsBar confirmed={r.slots.confirmed} held={r.slots.held} max={r.slots.max} min={r.slots.min_to_play} sport={r.sport} />,
      },
      { id: 'fill', header: m.matches.fill, cell: ({ row: { original: r } }) => <span className="tabular-nums">{formatPct(r.fill_rate)}</span> },
      {
        id: 'revenue',
        header: m.matches.revenue,
        cell: ({ row: { original: r } }) => (
          <div className="text-right">
            <MoneyText money={r.revenue.net} className="font-semibold" />
            {r.revenue.refunded.amount > 0 && (
              <div className="text-xs text-text-muted">
                −<MoneyText money={r.revenue.refunded} />
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'host',
        header: m.matches.host,
        cell: ({ row: { original: r } }) =>
          r.host ? (
            <div className="text-sm">
              <div className="font-medium">{r.host.display_name}</div>
              <div className="text-xs text-text-muted">{m.assignmentStatus[r.host.assignment_status]}</div>
            </div>
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
    ],
    [m, lang],
  );

  return (
    <>
      <PageHeader
        title={m.matches.title}
        actions={
          <Link href="/matches/new">
            <Button icon={<IconPlus />}>{m.matches.create}</Button>
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={f.scope}
          onChange={(scope) => setF({ scope, offset: '0' })}
          options={[
            { value: 'upcoming', label: m.matches.upcoming },
            { value: 'past', label: m.matches.past },
            { value: 'all', label: m.common.all },
          ]}
        />
        <select className="field w-48" value={f.status} onChange={(e) => setF({ status: e.target.value, offset: '0' })} aria-label={m.common.status}>
          <option value="">
            {m.common.status}: {m.common.all}
          </option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {m.matchStatus[s]}
            </option>
          ))}
        </select>
        <select className="field w-44" value={f.city} onChange={(e) => setF({ city: e.target.value, offset: '0' })} aria-label={m.common.city}>
          <option value="">
            {m.common.city}: {m.common.all}
          </option>
          {ref.data?.cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="field w-60" value={f.venue} onChange={(e) => setF({ venue: e.target.value, offset: '0' })} aria-label={m.common.venue}>
          <option value="">
            {m.common.venue}: {m.common.all}
          </option>
          {venues.data?.items
            .filter((v) => !f.city || v.city.id === Number(f.city))
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
        </select>
        <select className="field w-44" value={f.sport} onChange={(e) => setF({ sport: e.target.value, offset: '0' })} aria-label={m.common.sport}>
          <option value="">
            {m.common.sport}: {m.common.all}
          </option>
          {ref.data?.sports.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="relative min-w-56 flex-1">
          <IconSearch className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
          <input
            className="field pl-9"
            placeholder={m.matches.searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              pushQ(e.target.value.trim());
            }}
          />
        </label>
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      <Card padded={false} className={list.isPlaceholderData ? 'opacity-60' : undefined}>
        <DataTable columns={columns} data={list.data?.items} loading={list.isLoading} onRowClick={(r) => router.push(`/matches/${r.id}`)} rowKey={(r) => r.id} />
        <Pager total={list.data?.total ?? 0} limit={LIMIT} offset={Number(f.offset) || 0} onChange={(o) => setF({ offset: String(o) })} />
      </Card>
    </>
  );
}

export default function MatchesPage() {
  return (
    <Suspense>
      <MatchesTable />
    </Suspense>
  );
}
