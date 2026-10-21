'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import type { ReconciliationRun } from '@matchup/contracts';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Checkbox, DataTable, ErrorBox, Field, Modal, PageHeader, Pager, StatusBadge } from '@/components/ui';
import { api, idempotencyKey, unwrap } from '@/lib/api';
import { dayRange, formatDateTime, todayIn } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useUrlState } from '@/lib/use-url-state';
import { DiffKinds, Period } from './parts';

const LIMIT = 50;
const PROVIDERS = ['payme', 'click', 'uzum'] as const;
const STATUSES = ['completed', 'failed', 'running'] as const;
type Provider = (typeof PROVIDERS)[number];

/** Qo'lda solishtirish: sinxron, natija (har provider uchun run) darhol qaytadi. */
function RunDialog({ onClose }: { onClose: () => void }) {
  const { m, f } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const yesterday = todayIn(undefined, -1);
  const [provider, setProvider] = useState<Provider | ''>('payme');
  const [from, setFrom] = useState(yesterday);
  const [to, setTo] = useState(yesterday);
  const [key] = useState(idempotencyKey);
  const run = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/admin/finance/reconciliation', {
          params: { header: { 'Idempotency-Key': key } },
          body: { ...dayRange(from, to), ...(provider ? { provider } : {}) },
        }),
      ),
    onSuccess: ({ items }) => {
      void qc.invalidateQueries({ queryKey: ['reconciliation'] });
      toast(f(m.reconciliation.finishedOk, { n: items.reduce((n, r) => n + r.counts.diffs, 0) }));
      onClose();
      if (items.length === 1) router.push(`/reconciliation/${items[0]!.id}`);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={m.reconciliation.runTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button loading={run.isPending} disabled={!from || !to || from > to} onClick={() => run.mutate()}>
            {m.reconciliation.run}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">{m.reconciliation.runText}</p>
      <div className="mt-4 space-y-4">
        <Field label={m.payments.provider}>
          <select className="field" value={provider} onChange={(e) => setProvider(e.target.value as Provider | '')}>
            <option value="">{m.reconciliation.allProviders}</option>
            {PROVIDERS.map((x) => (
              <option key={x} value={x}>
                {m.provider[x]}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={m.common.from}>
            <input type="date" className="field" value={from} max={yesterday} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={m.common.to}>
            <input type="date" className="field" value={to} max={todayIn()} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {run.error ? <ErrorBox error={run.error} /> : null}
      </div>
    </Modal>
  );
}

function RunsTable() {
  const { m, lang } = useI18n();
  const router = useRouter();
  const [s, setS] = useUrlState({ provider: '', status: '', diffs: '', from: '', to: '', offset: '0' });
  const [runOpen, setRunOpen] = useState(false);

  const range = s.from && s.to ? dayRange(s.from, s.to) : s.from ? { date_from: dayRange(s.from, s.from).date_from } : s.to ? { date_to: dayRange(s.to, s.to).date_to } : {};
  const query = {
    limit: LIMIT,
    offset: Number(s.offset) || 0,
    ...range,
    ...(s.provider ? { provider: s.provider } : {}),
    ...(s.status ? { status: s.status } : {}),
    ...(s.diffs ? { has_diffs: true } : {}),
  };
  const list = useQuery({
    queryKey: ['reconciliation', query],
    queryFn: () => unwrap(api.GET('/v1/admin/finance/reconciliation', { params: { query } })),
    placeholderData: keepPreviousData,
    // Kechki job ishlayotgan bo'lsa — tugashini kutamiz
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === 'running') ? 5_000 : false),
  });

  const columns = useMemo<ColumnDef<ReconciliationRun, unknown>[]>(
    () => [
      { id: 'period', header: m.reconciliation.period, cell: ({ row: { original: r } }) => <Period run={r} /> },
      { id: 'provider', header: m.payments.provider, cell: ({ row: { original: r } }) => <span className="font-semibold">{m.provider[r.provider] ?? r.provider}</span> },
      {
        id: 'status',
        header: m.common.status,
        cell: ({ row: { original: r } }) => (
          <div>
            <StatusBadge status={r.status} label={m.reconStatus[r.status] ?? r.status} />
            {r.error && <div className="mt-1 max-w-56 truncate text-xs text-danger" title={r.error}>{r.error}</div>}
          </div>
        ),
      },
      {
        id: 'counts',
        header: m.reconciliation.counts,
        cell: ({ row: { original: r } }) => (
          <span className="tabular-nums">
            {r.counts.local} / {r.counts.provider} / <span className="text-success">{r.counts.matched}</span>
          </span>
        ),
      },
      {
        id: 'diffs',
        header: m.reconciliation.diffs,
        cell: ({ row: { original: r } }) =>
          r.status === 'completed' && r.counts.diffs === 0 ? <Badge tone="success">{m.reconciliation.noDiffs}</Badge> : <DiffKinds run={r} />,
      },
      {
        id: 'trigger',
        header: m.reconciliation.trigger,
        cell: ({ row: { original: r } }) => (
          <div>
            <div>{m.reconTrigger[r.trigger] ?? r.trigger}</div>
            {r.triggered_by && <div className="text-xs text-text-muted">{r.triggered_by.display_name ?? '—'}</div>}
          </div>
        ),
      },
      { id: 'at', header: m.reconciliation.started, cell: ({ row: { original: r } }) => <span className="whitespace-nowrap">{formatDateTime(r.started_at, lang)}</span> },
    ],
    [m, lang],
  );

  return (
    <>
      <PageHeader title={m.reconciliation.title} subtitle={m.reconciliation.subtitle} actions={<Button onClick={() => setRunOpen(true)}>{m.reconciliation.run}</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
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
        <select className="field w-44" value={s.status} onChange={(e) => setS({ status: e.target.value, offset: '0' })} aria-label={m.common.status}>
          <option value="">
            {m.common.status}: {m.common.all}
          </option>
          {STATUSES.map((x) => (
            <option key={x} value={x}>
              {m.reconStatus[x]}
            </option>
          ))}
        </select>
        <input type="date" className="field w-40" value={s.from} onChange={(e) => setS({ from: e.target.value, offset: '0' })} aria-label={m.common.from} />
        <span className="text-text-muted">—</span>
        <input type="date" className="field w-40" value={s.to} onChange={(e) => setS({ to: e.target.value, offset: '0' })} aria-label={m.common.to} />
        <Checkbox checked={!!s.diffs} onChange={(v) => setS({ diffs: v ? '1' : '', offset: '0' })} label={m.reconciliation.onlyDiffs} />
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      <Card padded={false} className={list.isPlaceholderData ? 'opacity-60' : undefined}>
        <DataTable columns={columns} data={list.data?.items} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/reconciliation/${r.id}`)} />
        <Pager total={list.data?.total ?? 0} limit={LIMIT} offset={Number(s.offset) || 0} onChange={(o) => setS({ offset: String(o) })} />
      </Card>
      {runOpen && <RunDialog onClose={() => setRunOpen(false)} />}
    </>
  );
}

export default function ReconciliationPage() {
  return (
    <Suspense>
      <RunsTable />
    </Suspense>
  );
}
