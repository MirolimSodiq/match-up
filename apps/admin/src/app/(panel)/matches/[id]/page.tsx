'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import type { AdminMatchDetail } from '@matchup/contracts';
import { IconChevronLeft, IconClock, IconPin } from '@/components/icons';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, DataTable, ErrorBox, MoneyText, PageHeader, Segmented, SlotsBar, Spinner, StatusBadge } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatDateTime, formatPct, formatTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { sportColors } from '@/lib/tokens';
import { CancelDialog } from './cancel-dialog';

type D = AdminMatchDetail;
type Tab = 'roster' | 'bookings' | 'payments' | 'refunds' | 'host' | 'audit';

function Kv({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export default function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { m, f, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('roster');
  const [cancelOpen, setCancelOpen] = useState(false);

  const q = useQuery({ queryKey: ['match', id], queryFn: () => unwrap(api.GET('/v1/admin/matches/{matchIdOrCode}', { params: { path: { matchIdOrCode: id } } })) });
  const publish = useMutation({
    mutationFn: () => unwrap(api.POST('/v1/admin/matches/{matchId}/publish', { params: { path: { matchId: q.data!.id } } })),
    onSuccess: () => {
      toast(m.matchDetail.published);
      void qc.invalidateQueries();
    },
  });

  const d = q.data;
  const tz = d?.timezone;
  const dt = (iso: string | null) => formatDateTime(iso, lang, tz);

  const cols = useMemo(() => {
    const roster: ColumnDef<D['roster'][number], unknown>[] = [
      { id: 'name', header: m.common.name, cell: ({ row: { original: r } }) => <span className="font-medium">{r.is_guest ? `${r.display_name}` : r.display_name}</span> },
      { id: 'phone', header: m.common.phone, cell: ({ row: { original: r } }) => <span className="tabular-nums text-text-muted">{r.user?.phone ?? '—'}</span> },
      { id: 'status', header: m.common.status, cell: ({ row: { original: r } }) => <StatusBadge status={r.status} label={m.participantStatus[r.status] ?? r.status} /> },
      { id: 'side', header: m.matchDetail.side, cell: ({ row: { original: r } }) => r.side_no ?? '—' },
      { id: 'ci', header: 'Check-in', cell: ({ row: { original: r } }) => dt(r.checked_in_at) },
    ];
    const bookings: ColumnDef<D['bookings'][number], unknown>[] = [
      { id: 'user', header: m.payments.player, cell: ({ row: { original: b } }) => <div><div className="font-medium">{b.user.display_name}</div><div className="text-xs tabular-nums text-text-muted">{b.user.phone}</div></div> },
      { id: 'seats', header: m.matchDetail.seats, cell: ({ row: { original: b } }) => b.seats },
      { id: 'status', header: m.common.status, cell: ({ row: { original: b } }) => <StatusBadge status={b.status} label={m.bookingStatus[b.status] ?? b.status} /> },
      { id: 'paid', header: m.matchDetail.paid, cell: ({ row: { original: b } }) => <div><MoneyText money={b.paid} className={b.status === 'confirmed' || b.status === 'completed' ? 'font-semibold' : 'text-text-muted'} />{b.wallet_applied.amount > 0 && <div className="text-xs text-text-muted">{m.matchDetail.wallet}: {b.wallet_applied.formatted}</div>}</div> },
      { id: 'created', header: m.payments.created, cell: ({ row: { original: b } }) => dt(b.created_at) },
      { id: 'note', header: '', cell: ({ row: { original: b } }) => <span className="text-xs text-text-muted">{b.cancel_reason ? (m.refundReason[b.cancel_reason] ?? b.cancel_reason) : b.expires_at ? `→ ${formatTime(b.expires_at, tz)}` : ''}</span> },
    ];
    const payments: ColumnDef<D['payments'][number], unknown>[] = [
      { id: 'provider', header: m.payments.provider, cell: ({ row: { original: p } }) => <span className="font-semibold">{m.provider[p.provider] ?? p.provider}</span> },
      { id: 'amount', header: m.common.amount, cell: ({ row: { original: p } }) => <MoneyText money={p.amount} className="font-semibold" /> },
      { id: 'refunded', header: m.payments.refunded, cell: ({ row: { original: p } }) => (p.refunded.amount ? <MoneyText money={p.refunded} /> : '—') },
      { id: 'status', header: m.common.status, cell: ({ row: { original: p } }) => <StatusBadge status={p.status} label={m.paymentStatus[p.status] ?? p.status} /> },
      { id: 'tx', header: m.matchDetail.tx, cell: ({ row: { original: p } }) => <span className="font-mono text-xs text-text-muted">{p.provider_transaction_id ?? '—'}</span> },
      { id: 'at', header: m.payments.created, cell: ({ row: { original: p } }) => dt(p.succeeded_at ?? p.created_at) },
    ];
    const refunds: ColumnDef<D['refunds'][number], unknown>[] = [
      { id: 'amount', header: m.common.amount, cell: ({ row: { original: r } }) => <MoneyText money={r.amount} className="font-semibold" /> },
      { id: 'dest', header: m.matchDetail.destination, cell: ({ row: { original: r } }) => m.refundDestination[r.destination] },
      { id: 'status', header: m.common.status, cell: ({ row: { original: r } }) => <StatusBadge status={r.status} label={m.refundStatus[r.status] ?? r.status} /> },
      { id: 'reason', header: m.matchDetail.reason, cell: ({ row: { original: r } }) => m.refundReason[r.reason] ?? r.reason },
      { id: 'pid', header: m.refunds.providerRefundId, cell: ({ row: { original: r } }) => <div><span className="font-mono text-xs">{r.provider_refund_id ?? '—'}</span>{r.note && <div className="text-xs text-text-muted">{r.note}</div>}</div> },
      { id: 'at', header: m.common.date, cell: ({ row: { original: r } }) => dt(r.completed_at ?? r.created_at) },
    ];
    const hosts: ColumnDef<D['host_assignments'][number], unknown>[] = [
      { id: 'host', header: m.matches.host, cell: ({ row: { original: h } }) => <div><div className="font-medium">{h.host.display_name}</div><div className="text-xs tabular-nums text-text-muted">{h.host.phone}</div></div> },
      { id: 'status', header: m.common.status, cell: ({ row: { original: h } }) => <StatusBadge status={h.status} label={m.assignmentStatus[h.status] ?? h.status} /> },
      { id: 'fee', header: m.matchDetail.hostFee, cell: ({ row: { original: h } }) => <MoneyText money={h.fee} /> },
      { id: 'round', header: m.matchDetail.offeredAt, cell: ({ row: { original: h } }) => <div>{dt(h.offered_at)}<div className="text-xs text-text-muted">{f(m.matchDetail.round, { n: h.dispatch_round })}</div></div> },
      { id: 'arr', header: '', cell: ({ row: { original: h } }) => <span className="text-xs text-text-muted">{h.arrived_at ? `${dt(h.arrived_at)} · ${h.arrival_distance_m ?? '?'} m` : (h.decline_reason ?? '')}</span> },
    ];
    const audit: ColumnDef<D['audit'][number], unknown>[] = [
      { id: 'at', header: m.common.date, cell: ({ row: { original: a } }) => dt(a.created_at) },
      { id: 'action', header: m.common.actions, cell: ({ row: { original: a } }) => <Badge>{a.action}</Badge> },
      { id: 'actor', header: m.matchDetail.actor, cell: ({ row: { original: a } }) => a.actor?.display_name ?? m.matchDetail.system },
      { id: 'changes', header: '', cell: ({ row: { original: a } }) => <code className="block max-w-md truncate text-xs text-text-muted">{Object.keys(a.changes ?? {}).length ? JSON.stringify(a.changes) : ''}</code> },
    ];
    return { roster, bookings, payments, refunds, hosts, audit };
  }, [m, lang, tz]);

  if (q.isLoading) return <div className="py-20 text-center text-text-muted"><Spinner /></div>;
  if (!d) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;

  const sc = sportColors(d.sport);
  // Bekor qilingan match'da host haqi faqat host haqiqatan tayinlangan bo'lsa xarajat
  const hostCost = d.status !== 'cancelled' || d.host_assignments.some((h) => ['accepted', 'arrived', 'completed'].includes(h.status)) ? d.host_fee.amount : 0;
  const margin = d.revenue.net.amount - (d.lease_cost?.amount ?? 0) - hostCost;
  const marginFmt = (() => {
    const som = Math.round(margin / 100);
    const s = Math.abs(som).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${som < 0 ? '−' : ''}${s} ${m.common.som}`;
  })();
  const canCancel = ['draft', 'open', 'full'].includes(d.status);
  const activeRoster = d.roster.filter((r) => ['held', 'confirmed', 'checked_in', 'no_show'].includes(r.status));

  const tabs: { value: Tab; label: string }[] = [
    { value: 'roster', label: `${m.matchDetail.roster} · ${activeRoster.length}` },
    { value: 'bookings', label: `${m.matchDetail.bookings} · ${d.bookings.length}` },
    { value: 'payments', label: `${m.matchDetail.payments} · ${d.payments.length}` },
    { value: 'refunds', label: `${m.matchDetail.refunds} · ${d.refunds.length}` },
    { value: 'host', label: m.matchDetail.hostAssignments },
    { value: 'audit', label: m.matchDetail.audit },
  ];

  return (
    <>
      <PageHeader
        back={
          <Link href="/matches" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text">
            <IconChevronLeft /> {m.nav.matches}
          </Link>
        }
        title={d.title || `${d.format} ${d.venue.name}`}
        subtitle={<span className="font-mono">{d.public_code}</span>}
        actions={
          <>
            {d.status === 'draft' && (
              <Button loading={publish.isPending} onClick={() => publish.mutate()}>
                {m.matchDetail.publish}
              </Button>
            )}
            {canCancel && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                {m.matchDetail.cancelMatch}
              </Button>
            )}
          </>
        }
      />
      {publish.error ? <div className="mb-4"><ErrorBox error={publish.error} /></div> : null}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Sport rangidagi karta — player'dagi match detali uslubida */}
        <div className="overflow-hidden rounded-xl p-6 text-on-sport shadow-card" style={{ background: `linear-gradient(160deg, ${sc.base}, ${sc.deep})` }}>
          <div className="flex items-center justify-between">
            <span className="rounded-pill bg-sport-glass-strong px-3 py-1 text-xs font-semibold">{m.sports[d.sport] ?? d.sport} · {d.format}</span>
            <span className="rounded-pill bg-on-sport px-3 py-1 text-xs font-bold" style={{ color: sc.deep }}>
              {m.matchStatus[d.status] ?? d.status}
            </span>
          </div>
          <div className="display mt-5 text-[76px] leading-[76px]">{formatTime(d.starts_at, tz)}</div>
          <div className="mt-1 text-sm font-semibold" style={{ color: sc.muted }}>
            <IconClock className="mr-1 inline" /> {formatDate(d.starts_at, lang, tz)} · {formatTime(d.starts_at, tz)}–{formatTime(d.ends_at, tz)}
          </div>
          <div className="mt-4 text-sm font-semibold">
            <IconPin className="mr-1 inline" /> {d.venue.name} · {d.pitch.name}
          </div>
          <div className="text-xs" style={{ color: sc.muted }}>{d.city.name} · {d.timezone}</div>
          <div className="mt-5 flex items-end justify-between">
            <div className="display text-3xl">{d.price.formatted}</div>
            <div className="text-right text-xs" style={{ color: sc.muted }}>
              {d.slots.confirmed}/{d.slots.max} · {formatPct(d.fill_rate)}
            </div>
          </div>
          {d.status === 'cancelled' && (
            <div className="mt-4 rounded-md bg-sport-glass px-3 py-2 text-sm font-semibold">
              {f(m.matchDetail.cancelledBecause, { reason: m.cancelReason[d.cancel_reason ?? ''] ?? d.cancel_reason ?? '' })}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="card p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">{m.matchDetail.slots}</div>
            <div className="display mt-2 text-[28px] leading-8">
              {d.slots.confirmed}
              <span className="text-text-muted">/{d.slots.max}</span>
            </div>
            <div className="mt-3">
              <SlotsBar confirmed={d.slots.confirmed} held={d.slots.held} max={d.slots.max} min={d.slots.min_to_play} sport={d.sport} />
            </div>
            <div className="mt-2 text-xs text-text-muted">
              {f(m.matchDetail.held, { n: d.slots.held })} · {f(m.matchDetail.minToPlay, { n: d.slots.min_to_play })}
            </div>
          </div>
          <div className="card p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">{m.matchDetail.net}</div>
            <div className="display mt-2 text-[28px] leading-8">{d.revenue.net.formatted}</div>
            <div className="mt-2 space-y-0.5 text-xs text-text-muted">
              <div>{m.matchDetail.gross}: {d.revenue.gross.formatted}</div>
              <div>{m.matchDetail.refunded}: {d.revenue.refunded.formatted}</div>
            </div>
          </div>
          <div className="card p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">{m.matchDetail.margin}</div>
            <div className={`display mt-2 text-[28px] leading-8 ${margin < 0 ? 'text-danger' : ''}`}>{marginFmt}</div>
            <div className="mt-2 space-y-0.5 text-xs text-text-muted">
              <div>{m.matchDetail.lease}: {d.lease_cost?.formatted ?? '—'}</div>
              <div className={hostCost ? undefined : 'line-through'}>{m.matchDetail.hostFee}: {d.host_fee.formatted}</div>
            </div>
          </div>
          <Card title={m.matchDetail.overview} className="sm:col-span-2 xl:col-span-3">
            <div className="grid gap-x-8 sm:grid-cols-2">
              <div>
                <Kv label={m.matchDetail.bookingCloses}>{dt(d.booking_closes_at)}</Kv>
                <Kv label={m.matchDetail.minDeadline}>{dt(d.min_players_deadline)}</Kv>
                <Kv label={m.matchDetail.lease}>{d.lease ? `${formatTime(d.lease.starts_at, tz)}–${formatTime(d.lease.ends_at, tz)} · ${d.lease.cost.formatted}` : '—'}</Kv>
              </div>
              <div>
                <Kv label={m.matchForm.levelMin}>{[d.level.min, d.level.max].map((l) => (l ? m.level[l] : m.matchForm.anyLevel)).join(' – ')}</Kv>
                <Kv label={m.matchForm.visibility}>{{ public: m.matchForm.visPublic, unlisted: m.matchForm.visUnlisted, private: m.matchForm.visPrivate }[d.visibility]}</Kv>
                <Kv label={m.matchDetail.policy}>{d.cancellation_policy.summary}</Kv>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-6 mb-3 overflow-x-auto">
        <Segmented value={tab} onChange={setTab} options={tabs} />
      </div>
      <Card padded={false}>
        {tab === 'roster' && <DataTable columns={cols.roster} data={d.roster} empty={m.matchDetail.noRoster} rowKey={(r) => r.participant_id} />}
        {tab === 'bookings' && <DataTable columns={cols.bookings} data={d.bookings} empty={m.matchDetail.noBookings} rowKey={(r) => r.id} />}
        {tab === 'payments' && <DataTable columns={cols.payments} data={d.payments} empty={m.matchDetail.noPayments} rowKey={(r) => r.id} />}
        {tab === 'refunds' && <DataTable columns={cols.refunds} data={d.refunds} empty={m.matchDetail.noRefunds} rowKey={(r) => r.id} />}
        {tab === 'host' && <DataTable columns={cols.hosts} data={d.host_assignments} empty={m.matchDetail.noHost} rowKey={(r) => r.id} />}
        {tab === 'audit' && <DataTable columns={cols.audit} data={d.audit} rowKey={(r) => String(r.id)} />}
      </Card>

      <CancelDialog match={d} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </>
  );
}
