'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import type { AdminRefund } from '@matchup/contracts';
import { IconCheck } from '@/components/icons';
import { useToast } from '@/components/toast';
import { Button, Card, DataTable, ErrorBox, Field, Modal, MoneyText, PageHeader, Pager, Segmented, StatusBadge } from '@/components/ui';
import { api, idempotencyKey, unwrap } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useUrlState } from '@/lib/use-url-state';

const LIMIT = 50;
type View = 'pending' | 'done' | 'wallet';
const FILTERS: Record<View, { status: string; destination: string }> = {
  pending: { status: 'pending', destination: 'original_method' },
  done: { status: 'succeeded,failed', destination: 'original_method' },
  wallet: { status: 'pending,succeeded,failed', destination: 'wallet' },
};

/** Provider kabinetida qaytarilgan pulni "bajarildi" deb belgilash. */
function CompleteDialog({ refund, onClose }: { refund: AdminRefund; onClose: () => void }) {
  const { m, f } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [pid, setPid] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(idempotencyKey);
  const done = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/admin/refunds/{refundId}/complete', {
          params: { path: { refundId: refund.id }, header: { 'Idempotency-Key': key } },
          body: { provider_refund_id: pid.trim(), ...(note.trim() ? { note: note.trim() } : {}) },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['refunds'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
      void qc.invalidateQueries({ queryKey: ['match'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(m.refunds.marked);
      onClose();
    },
  });
  const provider = refund.payment ? (m.provider[refund.payment.provider] ?? refund.payment.provider) : '—';
  return (
    <Modal
      open
      onClose={onClose}
      title={m.refunds.markTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button variant="success" icon={<IconCheck />} loading={done.isPending} disabled={!pid.trim()} onClick={() => done.mutate()}>
            {m.refunds.markDone}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">
        {f(m.refunds.markText, {
          amount: refund.amount.formatted ?? '',
          player: `${refund.user.display_name} (${refund.user.phone ?? ''})`,
          provider,
          tx: refund.payment?.provider_transaction_id ?? '—',
        })}
      </p>
      <div className="mt-4 space-y-4">
        <Field label={m.refunds.providerRefundId}>
          <input className="field font-mono" value={pid} onChange={(e) => setPid(e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field label={`${m.refunds.note} (${m.common.optional})`}>
          <textarea className="field min-h-20" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        {done.error ? <ErrorBox error={done.error} /> : null}
      </div>
    </Modal>
  );
}

function RefundsTable() {
  const { m, f, lang } = useI18n();
  const [s, setS] = useUrlState({ view: 'pending', offset: '0' });
  const [selected, setSelected] = useState<AdminRefund | null>(null);
  const view = (s.view in FILTERS ? s.view : 'pending') as View;
  const query = { limit: LIMIT, offset: Number(s.offset) || 0, ...FILTERS[view] };
  const list = useQuery({ queryKey: ['refunds', query], queryFn: () => unwrap(api.GET('/v1/admin/refunds', { params: { query } })), placeholderData: keepPreviousData });

  const columns = useMemo<ColumnDef<AdminRefund, unknown>[]>(
    () => [
      {
        id: 'at',
        header: view === 'pending' ? m.refunds.waiting : m.common.date,
        cell: ({ row: { original: r } }) => <span className="whitespace-nowrap">{formatDateTime(r.completed_at ?? r.created_at, lang)}</span>,
      },
      {
        id: 'player',
        header: m.payments.player,
        cell: ({ row: { original: r } }) => (
          <div>
            <div className="font-medium">{r.user.display_name}</div>
            <div className="text-xs tabular-nums text-text-muted">{r.user.phone}</div>
          </div>
        ),
      },
      {
        id: 'match',
        header: m.payments.match,
        cell: ({ row: { original: r } }) => (
          <Link href={`/matches/${r.match.id}`} className="hover:underline">
            <div className="font-mono text-xs font-semibold">{r.match.public_code}</div>
            <div className="text-xs text-text-muted">{m.refundReason[r.reason] ?? r.reason}</div>
          </Link>
        ),
      },
      { id: 'amount', header: m.common.amount, cell: ({ row: { original: r } }) => <MoneyText money={r.amount} className="text-base font-bold" /> },
      {
        id: 'payment',
        header: m.payments.provider,
        cell: ({ row: { original: r } }) =>
          r.payment ? (
            <div>
              <div className="font-semibold">{m.provider[r.payment.provider] ?? r.payment.provider}</div>
              <div className="font-mono text-xs text-text-muted">{r.payment.provider_transaction_id ?? '—'}</div>
            </div>
          ) : (
            <span className="text-text-muted">{m.refundDestination.wallet}</span>
          ),
      },
      {
        id: 'status',
        header: m.common.status,
        cell: ({ row: { original: r } }) => (
          <div>
            <StatusBadge status={r.status} label={m.refundStatus[r.status] ?? r.status} />
            {r.provider_refund_id && <div className="mt-1 font-mono text-xs text-text-muted">{r.provider_refund_id}</div>}
            {r.processed_by && (
              <div className="text-xs text-text-muted">
                {m.refunds.processedBy}: {r.processed_by.display_name}
              </div>
            )}
            {r.note && <div className="max-w-56 truncate text-xs text-text-muted" title={r.note}>{r.note}</div>}
          </div>
        ),
      },
      {
        id: 'action',
        header: '',
        cell: ({ row: { original: r } }) =>
          r.status === 'pending' && r.destination === 'original_method' ? (
            <div className="flex justify-end">
              <Button size="sm" variant="success" icon={<IconCheck />} onClick={() => setSelected(r)}>
                {m.refunds.markDone}
              </Button>
            </div>
          ) : null,
      },
    ],
    [m, lang, view],
  );

  const totals = list.data?.totals ?? [];
  return (
    <>
      <PageHeader title={m.refunds.title} subtitle={m.refunds.subtitle} />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Segmented
          value={view}
          onChange={(v) => setS({ view: v, offset: '0' })}
          options={[
            { value: 'pending', label: m.refunds.pending },
            { value: 'done', label: m.refunds.done },
            { value: 'wallet', label: m.refunds.wallet },
          ]}
        />
        {totals.map((t) => (
          <span key={t.currency} className="text-sm font-semibold text-text-muted">
            {f(m.refunds.totals, { count: t.count, amount: t.amount.formatted ?? '' })}
          </span>
        ))}
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      <Card padded={false} className={list.isPlaceholderData ? 'opacity-60' : undefined}>
        <DataTable columns={columns} data={list.data?.items} loading={list.isLoading} empty={view === 'pending' ? m.refunds.queueEmpty : undefined} rowKey={(r) => r.id} />
        <Pager total={list.data?.total ?? 0} limit={LIMIT} offset={Number(s.offset) || 0} onChange={(o) => setS({ offset: String(o) })} />
      </Card>
      {selected && <CompleteDialog refund={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

export default function RefundsPage() {
  return (
    <Suspense>
      <RefundsTable />
    </Suspense>
  );
}
