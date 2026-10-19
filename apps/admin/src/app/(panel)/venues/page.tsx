'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { IconPlus, IconSearch } from '@/components/icons';
import { Badge, Button, ErrorBox, PageHeader, Pager, Spinner, SportChip } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useReference } from '@/lib/queries';
import { debounce, useUrlState } from '@/lib/use-url-state';

const LIMIT = 24;

function VenuesList() {
  const { m, f } = useI18n();
  const ref = useReference();
  const [s, setS] = useUrlState({ city: '', q: '', active: '', offset: '0' });
  const [search, setSearch] = useState(s.q);
  const pushQ = useMemo(() => debounce((q: string) => setS({ q, offset: '0' }), 350), [setS]);
  const query = {
    limit: LIMIT,
    offset: Number(s.offset) || 0,
    ...(s.city ? { city_id: Number(s.city) } : {}),
    ...(s.q ? { q: s.q } : {}),
    ...(s.active ? { is_active: s.active as 'true' | 'false' } : {}),
  };
  const list = useQuery({ queryKey: ['venues', query], queryFn: () => unwrap(api.GET('/v1/admin/venues', { params: { query } })), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader
        title={m.venues.title}
        actions={
          <Link href="/venues/new">
            <Button icon={<IconPlus />}>{m.venues.create}</Button>
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <select className="field w-44" value={s.city} onChange={(e) => setS({ city: e.target.value, offset: '0' })} aria-label={m.common.city}>
          <option value="">
            {m.common.city}: {m.common.all}
          </option>
          {ref.data?.cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="field w-40" value={s.active} onChange={(e) => setS({ active: e.target.value, offset: '0' })} aria-label={m.common.status}>
          <option value="">{m.common.all}</option>
          <option value="true">{m.common.active}</option>
          <option value="false">{m.common.inactive}</option>
        </select>
        <label className="relative min-w-56 flex-1">
          <IconSearch className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
          <input
            className="field pl-9"
            placeholder={m.venues.searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              pushQ(e.target.value.trim());
            }}
          />
        </label>
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      {list.isLoading && (
        <div className="py-16 text-center">
          <Spinner />
        </div>
      )}
      <div className={`grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
        {list.data?.items.map((v) => (
          <Link key={v.id} href={`/venues/${v.id}`} className="card flex flex-col p-5 transition hover:shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-lg font-bold">{v.name}</div>
                <div className="truncate text-sm text-text-muted">
                  {v.city.name}
                  {v.address_text ? ` · ${v.address_text}` : ''}
                </div>
              </div>
              {!v.is_active && <Badge>{m.common.inactive}</Badge>}
            </div>
            <ul className="mt-4 space-y-2">
              {v.pitches.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm">
                  <span className={`font-semibold ${p.is_active ? '' : 'text-text-muted line-through'}`}>{p.name}</span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {p.sports.map((sp) => (
                      <SportChip key={sp} sport={sp} />
                    ))}
                  </span>
                </li>
              ))}
              {!v.pitches.length && <li className="text-sm text-text-muted">{m.venues.noPitches}</li>}
            </ul>
            <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
              {v.amenities.map((a) => (
                <Badge key={a.code}>{a.name}</Badge>
              ))}
              <span className="ml-auto text-xs font-semibold text-text-muted">{f(m.venues.upcoming, { n: v.upcoming_matches })}</span>
            </div>
          </Link>
        ))}
      </div>
      {list.data && !list.data.items.length && <p className="py-16 text-center text-sm text-text-muted">{m.common.empty}</p>}
      <Pager total={list.data?.total ?? 0} limit={LIMIT} offset={Number(s.offset) || 0} onChange={(o) => setS({ offset: String(o) })} />
    </>
  );
}

export default function VenuesPage() {
  return (
    <Suspense>
      <VenuesList />
    </Suspense>
  );
}
