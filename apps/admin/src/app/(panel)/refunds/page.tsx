'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import type { AdminRefund } from '@matchup/contracts';
import { IconCheck, IconSearch } from '@/components/icons';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, DataTable, ErrorBox, errorText, Field, Modal, MoneyText, PageHeader, Pager, Segmented, StatusBadge } from '@/components/ui';
import { api, idempotencyKey, unwrap } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { debounce, useUrlState } from '@/lib/use-url-state';

const LIMIT = 50;
type View = 'pending' | 'manual' | 'done' | 'wallet';
const FILTERS: Record<View, { status: string; destination: string; auto_status?: string }> = {
  pending: { status: 'pending', destination: 'original_method' },
  manual: { status: 'pending', destination: 'original_method', auto_status: 'manual' },
  done: { status: 'succeeded,failed', destination: 'original_method' },
  wallet: { status: 'pending,succeeded,failed', destination: 'wallet' },
};
/** Qayta urinish ma'nosiz sabablar: provider qisman qaytarmaydi / API'si yo'q. */
const NO_RETRY = new Set(['partial', 'unsupported']);

function useRefundChanged() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['refunds'] });
    void qc.invalidateQueries({ queryKey: ['payments'] });
    void qc.invalidateQueries({ queryKey: ['match'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

/** Avto-refund holati: navbatda / provider javobi kutilmoqda / admin hal qiladi (sababi) / avtomatik qaytarildi. */
function AutoInfo({ r }: { r: AdminRefund }) {
  const { m, f, lang } = useI18n();
  const a = r.auto;
  if (r.destination !== 'original_method') return null;
  if (r.status === 'succeeded') {
    return !r.processed_by && a.attempts > 0 ? <div className="mt-1 text-xs font-semibold text-success">{m.refunds.autoDone}</div> : null;
  }
  if (r.status !== 'pending') return null;
  if (a.status === 'manual') {
    return (
      <div className="mt-1 max-w-64">
        <Badge tone="warning">{m.refundManualReason[a.manual_reason ?? ''] ?? a.manual_reason}</Badge>
        {a.manual_reason === 'partial' && <div className="mt-1 text-xs text-text-muted">{m.refunds.partialHint}</div>}
        {a.error && (
          <div className="mt-1 truncate text-xs text-text-muted" title={a.error}>
            {a.error}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mt-1 max-w-64">
      <Badge tone="info">{a.status === 'submitted' ? m.refunds.autoSubmitted : m.refunds.autoQueued}</Badge>
      {a.status === 'queued' && a.attempts > 0 && a.next_attempt_at && (
        <div className="mt-1 text-xs text-text-muted" title={a.error ?? undefined}>
          {f(m.refunds.autoNext, { n: a.attempts, at: formatDateTime(a.next_attempt_at, lang) })}
        </div>
      )}
    </div>
  );
}

/** Provider kabinetida qaytarilgan pulni "bajarildi" deb belgilash. */
function CompleteDialog({ refund, onClose }: { refund: AdminRefund; onClose: () => void }) {
  const { m, f } = useI18n();
  const toast = useToast();
  const changed = useRefundChanged();
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
      changed();
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

/** Kartaga qaytarib bo'lmaydigan refund (qisman, provider rad etgan) — o'yinchi hamyoniga. */
function ToWalletDialog({ refund, onClose }: { refund: AdminRefund; onClose: () => void }) {
  const { m, f } = useI18n();
  const toast = useToast();
  const changed = useRefundChanged();
  const [note, setNote] = useState('');
  const [key] = useState(idempotencyKey);
  const move = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/admin/refunds/{refundId}/to-wallet', {
          params: { path: { refundId: refund.id }, header: { 'Idempotency-Key': key } },
          body: note.trim() ? { note: note.trim() } : {},
        }),
      ),
    onSuccess: () => {
      changed();
      toast(m.refunds.movedToWallet);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={m.refunds.toWalletTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button loading={move.isPending} onClick={() => move.mutate()}>
            {m.refunds.toWallet}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">{f(m.refunds.toWalletText, { amount: refund.amount.formatted ?? '', player: refund.user.display_name ?? '' })}</p>
      <div className="mt-4 space-y-4">
        <Field label={`${m.refunds.note} (${m.common.optional})`}>
          <textarea className="field min-h-20" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} autoFocus />
        </Field>
        {move.error ? <ErrorBox error={move.error} /> : null}
      </div>
    </Modal>
  );
}

function RefundActions({ r, onComplete, onWallet }: { r: AdminRefund; onComplete: () => void; onWallet: () => void }) {
  const { m } = useI18n();
  const toast = useToast();
  const changed = useRefundChanged();
  const retry = useMutation({
    mutationFn: () => unwrap(api.POST('/v1/admin/refunds/{refundId}/retry', { params: { path: { refundId: r.id } } })),
    onSuccess: () => {
      changed();
      toast(m.refunds.retried);
    },
    onError: (err) => toast(errorText(err, m), 'danger'),
  });
  // Provider javobi kutilmoqda — ikki marta qaytarmaslik uchun amal yo'q
  if (r.status !== 'pending' || r.destination !== 'original_method' || r.auto.status === 'submitted') return null;
  const canRetry = r.auto.status === 'manual' && !NO_RETRY.has(r.auto.manual_reason ?? '');
  return (
    <div className="ml-auto flex w-32 flex-col gap-1.5">
      <Button size="sm" variant="success" icon={<IconCheck />} onClick={onComplete}>
        {m.refunds.markDone}
      </Button>
      <Button size="sm" variant="secondary" onClick={onWallet}>
        {m.refunds.toWallet}
      </Button>
      {canRetry && (
        <Button size="sm" variant="ghost" loading={retry.isPending} onClick={() => retry.mutate()}>
          {m.refunds.retry}
        </Button>
      )}
    </div>
  );
}

function RefundsTable() {
  const { m, f, lang } = useI18n();
  const [s, setS] = useUrlState({ view: 'pending', q: '', offset: '0' });
  const [search, setSearch] = useState(s.q);
  const pushQ = useMemo(() => debounce((q: string) => setS({ q, offset: '0' }), 350), [setS]);
  const [selected, setSelected] = useState<{ refund: AdminRefund; action: 'complete' | 'wallet' } | null>(null);
  const view = (s.view in FILTERS ? s.view : 'pending') as View;
  const query = { limit: LIMIT, offset: Number(s.offset) || 0, ...FILTERS[view], ...(s.q ? { q: s.q } : {}) };
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
            <AutoInfo r={r} />
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
        cell: ({ row: { original: r } }) => (
          <RefundActions r={r} onComplete={() => setSelected({ refund: r, action: 'complete' })} onWallet={() => setSelected({ refund: r, action: 'wallet' })} />
        ),
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
            { value: 'manual', label: m.refunds.manual },
            { value: 'done', label: m.refunds.done },
            { value: 'wallet', label: m.refunds.wallet },
          ]}
        />
        <label className="relative min-w-64 flex-1">
          <IconSearch className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
          <input
            className="field pl-9"
            placeholder={m.refunds.searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              pushQ(e.target.value.trim());
            }}
          />
        </label>
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
      {selected?.action === 'complete' && <CompleteDialog refund={selected.refund} onClose={() => setSelected(null)} />}
      {selected?.action === 'wallet' && <ToWalletDialog refund={selected.refund} onClose={() => setSelected(null)} />}
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
