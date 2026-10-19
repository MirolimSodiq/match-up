'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { DailyChart } from '@/components/daily-chart';
import { Badge, Card, ErrorBox, PageHeader, Segmented, Spinner, Stat, StatusBadge } from '@/components/ui';
import { useReference } from '@/lib/queries';
import { api, unwrap } from '@/lib/api';
import { dayRange, formatPct, todayIn } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { colors, SPORTS } from '@/lib/tokens';

type Preset = 'last7' | 'last30' | 'next7' | 'custom';

function presetRange(p: Exclude<Preset, 'custom'>): { from: string; to: string } {
  if (p === 'last7') return { from: todayIn(undefined, -6), to: todayIn() };
  if (p === 'next7') return { from: todayIn(), to: todayIn(undefined, 6) };
  return { from: todayIn(undefined, -29), to: todayIn() };
}

export default function DashboardPage() {
  const { m, f } = useI18n();
  const ref = useReference();
  const [preset, setPreset] = useState<Preset>('last30');
  const [custom, setCustom] = useState(() => ({ from: todayIn(undefined, -29), to: todayIn(undefined, 14) }));
  const [cityId, setCityId] = useState<number | ''>('');
  const range = preset === 'custom' ? custom : presetRange(preset);

  const q = useQuery({
    queryKey: ['dashboard', range, cityId],
    queryFn: () => unwrap(api.GET('/v1/admin/dashboard', { params: { query: { ...dayRange(range.from, range.to), ...(cityId ? { city_id: cityId } : {}) } } })),
    placeholderData: keepPreviousData,
  });
  const d = q.data;

  return (
    <>
      <PageHeader title={m.dashboard.title} />

      {/* Filtrlar: bitta qator, hamma narsani qamraydi */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented
          value={preset}
          onChange={setPreset}
          options={[
            { value: 'last7', label: m.dashboard.last7 },
            { value: 'last30', label: m.dashboard.last30 },
            { value: 'next7', label: m.dashboard.next7 },
            { value: 'custom', label: m.dashboard.custom },
          ]}
        />
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" className="field w-40" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} aria-label={m.common.from} />
            <span className="text-text-muted">—</span>
            <input type="date" className="field w-40" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} aria-label={m.common.to} />
          </div>
        )}
        <select className="field w-44" value={cityId} onChange={(e) => setCityId(e.target.value ? Number(e.target.value) : '')} aria-label={m.common.city}>
          <option value="">{m.common.city}: {m.common.all}</option>
          {ref.data?.cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {q.isFetching && <Spinner small />}
      </div>

      {q.error && !d ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : null}
      {!d ? (
        !q.error && (
          <div className="py-20 text-center text-text-muted">
            <Spinner />
          </div>
        )
      ) : (
        <div className={q.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label={m.dashboard.matches} value={d.matches.total} hint={f(m.dashboard.cancelledMatches, { n: d.cancellations.matches, pct: formatPct(d.cancellations.match_rate) })} accent={SPORTS.football!.base} />
            <Stat label={m.dashboard.fillRate} value={formatPct(d.fill_rate)} hint={f(m.dashboard.seats, { confirmed: d.seats.confirmed, capacity: d.seats.capacity })} accent={SPORTS.football!.base} />
            <Stat label={m.dashboard.gmv} value={d.gmv.formatted} hint={m.dashboard.gmvHint} accent={colors.primary} />
            <Stat label={m.dashboard.netRevenue} value={d.net_revenue.formatted} hint={`${m.dashboard.refunds}: ${d.refunds.formatted}`} accent={colors.primary} />
            <Stat label={m.dashboard.leaseCost} value={d.lease_cost.formatted} accent={colors.warning} />
            <Stat label={m.dashboard.hostPayouts} value={d.host_payouts.formatted} accent={colors.warning} />
            <Stat
              label={m.dashboard.grossMargin}
              value={<span className={d.gross_margin.amount < 0 ? 'text-danger' : undefined}>{d.gross_margin.formatted}</span>}
              hint={formatPct(d.gross_margin_pct, 1)}
              accent={d.gross_margin.amount < 0 ? colors.danger : colors.success}
            />
            <Stat label={m.dashboard.noShowRate} value={formatPct(d.no_show_rate, 1)} hint={f(m.dashboard.attendance, { checked_in: d.attendance.checked_in, no_show: d.attendance.no_show })} accent={colors.danger} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card title={m.dashboard.daily}>{d.series.length ? <DailyChart series={d.series} /> : <p className="py-10 text-center text-sm text-text-muted">{m.dashboard.noData}</p>}</Card>
            <div className="space-y-4">
              <Card title={m.dashboard.byStatus}>
                <ul className="space-y-2.5">
                  {(['open', 'full', 'in_progress', 'completed', 'cancelled'] as const).map((s) => (
                    <li key={s} className="flex items-center justify-between text-sm">
                      <StatusBadge status={s} label={m.matchStatus[s] ?? s} />
                      <span className="font-semibold tabular-nums">{d.matches.by_status[s] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title={m.dashboard.cancellations}>
                <p className="text-sm text-text-muted">{f(m.dashboard.cancelledBookings, { n: d.cancellations.bookings, pct: formatPct(d.cancellations.booking_rate) })}</p>
                {d.cancellations.by_reason?.length ? (
                  <ul className="mt-3 space-y-2">
                    {d.cancellations.by_reason.map((r) => (
                      <li key={r.reason} className="flex justify-between text-sm">
                        <span>{m.cancelReason[r.reason ?? ''] ?? r.reason}</span>
                        <span className="font-semibold tabular-nums">{r.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
              <Link href="/refunds" className="card flex items-center justify-between p-5 hover:shadow-card">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">{m.dashboard.refundQueue}</div>
                  <div className="display mt-1 text-2xl">{d.refund_queue.amount.formatted}</div>
                </div>
                <Badge tone={d.refund_queue.count ? 'warning' : 'success'}>{d.refund_queue.count}</Badge>
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
