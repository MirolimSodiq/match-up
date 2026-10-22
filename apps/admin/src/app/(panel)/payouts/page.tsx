'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import type { AdminHostPayout } from '@matchup/contracts';
import { IconCheck, IconSearch } from '@/components/icons';
import { useToast } from '@/components/toast';
import { Button, Card, DataTable, ErrorBox, Field, Modal, MoneyText, PageHeader, Pager, Segmented, Spinner, StatusBadge } from '@/components/ui';
import { api, idempotencyKey, unwrap } from '@/lib/api';
import { formatDateTime, formatDay } from '@/lib/format';
import { type Lang, useI18n } from '@/lib/i18n';
import { debounce, useUrlState } from '@/lib/use-url-state';

const LIMIT = 50;
type View = 'pending' | 'paid' | 'all';
const STATUS: Record<View, string | undefined> = { pending: 'pending', paid: 'paid', all: undefined };

const period = (p: { start: string; end: string }, lang: Lang) => `${formatDay(p.start, lang)} – ${formatDay(p.end, lang)}`;

/** Bitta yoki bir nechta payout'ni "to'landi" deb belgilash (ommaviyda bitta o'tkazma raqami). */
function PaidDialog({ payouts, onClose, onDone }: { payouts: AdminHostPayout[]; onClose: () => void; onDone: () => void }) {
  const { m, f, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(idempotencyKey);
  const single = payouts.length === 1 ? payouts[0]! : null;
  const body = { provider_ref: ref.trim(), ...(note.trim() ? { note: note.trim() } : {}) };
  const save = useMutation({
    mutationFn: async () => {
      if (single) {
        await unwrap(api.POST('/v1/admin/host-payouts/{payoutId}/paid', { params: { path: { payoutId: single.id }, header: { 'Idempotency-Key': key } }, body }));
        return 1;
      }
      const r = await unwrap(api.POST('/v1/admin/host-payouts/paid', { params: { header: { 'Idempotency-Key': key } }, body: { ...body, ids: payouts.map((p) => p.id) } }));
      return r.items.length;
    },
    onSuccess: (count) => {
      void qc.invalidateQueries({ queryKey: ['payouts'] });
      toast(single ? m.payouts.marked : f(m.payouts.markedBulk, { count }));
      onDone();
    },
  });
  // Jami — valyuta bo'yicha (amalda faqat UZS)
  const totals = useMemo(() => {
    const byCur = new Map<string, number>();
    for (const p of payouts) byCur.set(p.amount.currency, (byCur.get(p.amount.currency) ?? 0) + p.amount.amount);
    // API'dagi `formatted` bilan bir xil: bo'sh joy bilan guruhlash ("380 000 so'm")
    const group = new Intl.NumberFormat('ru-RU');
    return [...byCur.entries()].map(([cur, amount]) => `${group.format(Math.round(amount / 100))} ${cur === 'UZS' ? m.common.som : cur}`).join(', ');
  }, [payouts, m]);

  return (
    <Modal
      open
      onClose={onClose}
      title={single ? m.payouts.markTitle : f(m.payouts.markBulkTitle, { count: payouts.length })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button variant="success" icon={<IconCheck />} loading={save.isPending} disabled={!ref.trim()} onClick={() => save.mutate()}>
            {m.payouts.markPaid}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">
        {single
          ? f(m.payouts.markText, { amount: single.amount.formatted ?? '', host: single.host.display_name ?? '', period: period(single.period, lang) })
          : f(m.payouts.markBulkText, { amount: totals, count: payouts.length })}
      </p>
      <div className="mt-4 space-y-4">
        <Field label={m.payouts.transferRef}>
          <input className="field font-mono" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field label={`${m.payouts.note} (${m.common.optional})`}>
          <textarea className="field min-h-20" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        {save.error ? <ErrorBox error={save.error} /> : null}
      </div>
    </Modal>
  );
}

/** Payout tafsiloti: rekvizit, holat va unga kirgan o'yinlar. */
function DetailModal({ id, onClose, onPay }: { id: string; onClose: () => void; onPay: (p: AdminHostPayout) => void }) {
  const { m, lang } = useI18n();
  const d = useQuery({ queryKey: ['payouts', 'detail', id], queryFn: () => unwrap(api.GET('/v1/admin/host-payouts/{payoutId}', { params: { path: { payoutId: id } } })) });
  const p = d.data;
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={m.payouts.detailTitle}
      footer={
        p?.status === 'pending' ? (
          <Button variant="success" icon={<IconCheck />} onClick={() => onPay(p)}>
            {m.payouts.markPaid}
          </Button>
        ) : undefined
      }
    >
      {d.error ? <ErrorBox error={d.error} onRetry={() => d.refetch()} /> : null}
      {!p ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-lg font-bold">{p.host.display_name}</div>
              <div className="text-sm tabular-nums text-text-muted">{p.host.phone}</div>
              <div className="mt-1 text-sm">
                {p.host.payout_method ? (m.payoutMethod[p.host.payout_method] ?? p.host.payout_method) : m.payouts.noDetails}
                {p.host.payout_details_ref && <span className="ml-2 font-mono text-xs text-text-muted">{p.host.payout_details_ref}</span>}
              </div>
            </div>
            <div className="text-right">
              <MoneyText money={p.amount} className="text-2xl font-bold" />
              <div className="text-sm text-text-muted">{period(p.period, lang)}</div>
              <div className="mt-1">
                <StatusBadge status={p.status} label={m.payoutStatus[p.status] ?? p.status} />
              </div>
            </div>
          </div>
          {p.status === 'paid' && (
            <div className="rounded-lg bg-surface-muted px-4 py-3 text-sm">
              <span className="font-mono font-semibold">{p.provider_ref}</span>
              <span className="text-text-muted">
                {' · '}
                {formatDateTime(p.paid_at, lang)}
                {p.paid_by && ` · ${m.payouts.paidBy}: ${p.paid_by.display_name}`}
              </span>
              {p.note && <div className="mt-1 text-text-muted">{p.note}</div>}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-text-muted uppercase">
                  <th className="px-3 py-2">{m.payments.match}</th>
                  <th className="px-3 py-2">{m.common.date}</th>
                  <th className="px-3 py-2">{m.payouts.completedAt}</th>
                  <th className="px-3 py-2 text-right">{m.common.amount}</th>
                </tr>
              </thead>
              <tbody>
                {p.assignments.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/matches/${a.match.id}`} className="hover:underline">
                        <span className="font-mono text-xs font-semibold">{a.match.public_code}</span>
                        <div className="text-xs text-text-muted">
                          {a.match.title} · {a.match.venue_name}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(a.match.starts_at, lang)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(a.completed_at, lang)}</td>
                    <td className="px-3 py-2 text-right">
                      <MoneyText money={a.fee} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PayoutsTable() {
  const { m, f, lang } = useI18n();
  const [s, setS] = useUrlState({ view: 'pending', q: '', offset: '0' });
  const [search, setSearch] = useState(s.q);
  const pushQ = useMemo(() => debounce((q: string) => setS({ q, offset: '0' }), 350), [setS]);
  const [selected, setSelected] = useState<Map<string, AdminHostPayout>>(new Map());
  const [paying, setPaying] = useState<AdminHostPayout[] | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const view = (s.view in STATUS ? s.view : 'pending') as View;
  const filter = { ...(STATUS[view] ? { status: STATUS[view] } : {}), ...(s.q ? { q: s.q } : {}) };
  const query = { limit: LIMIT, offset: Number(s.offset) || 0, ...filter };
  const list = useQuery({ queryKey: ['payouts', query], queryFn: () => unwrap(api.GET('/v1/admin/host-payouts', { params: { query } })), placeholderData: keepPreviousData });
  const items = list.data?.items;
  const selectable = view === 'pending';

  const toggle = (p: AdminHostPayout, on: boolean) =>
    setSelected((cur) => {
      const next = new Map(cur);
      if (on) next.set(p.id, p);
      else next.delete(p.id);
      return next;
    });
  const pagePending = (items ?? []).filter((p) => p.status === 'pending');
  const allOnPage = pagePending.length > 0 && pagePending.every((p) => selected.has(p.id));

  const columns = useMemo<ColumnDef<AdminHostPayout, unknown>[]>(
    () => [
      ...(selectable
        ? [
            {
              id: 'select',
              header: () => (
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  aria-label={m.payouts.selectAll}
                  checked={allOnPage}
                  onChange={(e) => setSelected(e.target.checked ? new Map(pagePending.map((p) => [p.id, p])) : new Map())}
                />
              ),
              cell: ({ row: { original: p } }) => (
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  aria-label={p.host.display_name ?? p.id}
                  checked={selected.has(p.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => toggle(p, e.target.checked)}
                />
              ),
            } satisfies ColumnDef<AdminHostPayout, unknown>,
          ]
        : []),
      { id: 'period', header: m.payouts.period, cell: ({ row: { original: p } }) => <span className="whitespace-nowrap">{period(p.period, lang)}</span> },
      {
        id: 'host',
        header: m.payouts.host,
        cell: ({ row: { original: p } }) => (
          <div>
            <div className="font-medium">{p.host.display_name}</div>
            <div className="text-xs tabular-nums text-text-muted">{p.host.phone}</div>
          </div>
        ),
      },
      {
        id: 'method',
        header: m.payouts.method,
        cell: ({ row: { original: p } }) =>
          p.host.payout_method ? (
            <div>
              <div className="font-semibold">{m.payoutMethod[p.host.payout_method] ?? p.host.payout_method}</div>
              {p.host.payout_details_ref && <div className="max-w-48 truncate font-mono text-xs text-text-muted" title={p.host.payout_details_ref}>{p.host.payout_details_ref}</div>}
            </div>
          ) : (
            <span className="text-xs text-warning">{m.payouts.noDetails}</span>
          ),
      },
      { id: 'count', header: m.payouts.assignments, cell: ({ row: { original: p } }) => <span className="tabular-nums">{p.assignments_count}</span> },
      { id: 'amount', header: m.common.amount, cell: ({ row: { original: p } }) => <MoneyText money={p.amount} className="text-base font-bold" /> },
      {
        id: 'status',
        header: m.common.status,
        cell: ({ row: { original: p } }) => (
          <div>
            <StatusBadge status={p.status} label={m.payoutStatus[p.status] ?? p.status} />
            {p.provider_ref && <div className="mt-1 font-mono text-xs text-text-muted">{p.provider_ref}</div>}
            {p.paid_at && (
              <div className="text-xs text-text-muted">
                {formatDateTime(p.paid_at, lang)}
                {p.paid_by && ` · ${p.paid_by.display_name}`}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'action',
        header: '',
        cell: ({ row: { original: p } }) =>
          p.status === 'pending' ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="success"
                icon={<IconCheck />}
                onClick={(e) => {
                  e.stopPropagation();
                  setPaying([p]);
                }}
              >
                {m.payouts.markPaid}
              </Button>
            </div>
          ) : null,
      },
    ],
    [m, lang, selectable, selected, allOnPage, items],
  );

  const exportQuery = new URLSearchParams(filter as Record<string, string>).toString();
  const totals = list.data?.totals ?? [];
  return (
    <>
      <PageHeader
        title={m.payouts.title}
        subtitle={m.payouts.subtitle}
        actions={
          <a
            href={`/api/proxy/v1/admin/host-payouts/export${exportQuery ? `?${exportQuery}` : ''}`}
            download
            className="inline-flex h-11 items-center justify-center gap-2 rounded-pill border border-border-strong bg-surface px-5 text-[15px] font-semibold whitespace-nowrap text-text transition hover:bg-surface-muted"
          >
            {m.payouts.exportCsv}
          </a>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Segmented
          value={view}
          onChange={(v) => {
            setSelected(new Map());
            setS({ view: v, offset: '0' });
          }}
          options={[
            { value: 'pending', label: m.payouts.pending },
            { value: 'paid', label: m.payouts.paid },
            { value: 'all', label: m.payouts.all },
          ]}
        />
        <label className="relative min-w-64 flex-1">
          <IconSearch className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
          <input
            className="field pl-9"
            placeholder={m.payouts.searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              pushQ(e.target.value.trim());
            }}
          />
        </label>
        {totals.map((t) => (
          <span key={t.currency} className="text-sm font-semibold text-text-muted">
            {f(m.payouts.totals, { count: t.count, amount: t.amount.formatted ?? '' })}
          </span>
        ))}
      </div>
      {selectable && selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button variant="success" icon={<IconCheck />} onClick={() => setPaying([...selected.values()])}>
            {f(m.payouts.markSelected, { count: selected.size })}
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Map())}>
            {m.common.cancel}
          </Button>
        </div>
      )}
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      <Card padded={false} className={list.isPlaceholderData ? 'opacity-60' : undefined}>
        <DataTable
          columns={columns}
          data={items}
          loading={list.isLoading}
          empty={view === 'pending' ? m.payouts.empty : undefined}
          rowKey={(p) => p.id}
          onRowClick={(p) => setDetail(p.id)}
        />
        <Pager
          total={list.data?.total ?? 0}
          limit={LIMIT}
          offset={Number(s.offset) || 0}
          onChange={(o) => {
            setSelected(new Map());
            setS({ offset: String(o) });
          }}
        />
      </Card>
      {detail && !paying && (
        <DetailModal
          id={detail}
          onClose={() => setDetail(null)}
          onPay={(p) => {
            setPaying([p]);
          }}
        />
      )}
      {paying && (
        <PaidDialog
          payouts={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            setDetail(null);
            setSelected(new Map());
          }}
        />
      )}
    </>
  );
}

export default function PayoutsPage() {
  return (
    <Suspense>
      <PayoutsTable />
    </Suspense>
  );
}
