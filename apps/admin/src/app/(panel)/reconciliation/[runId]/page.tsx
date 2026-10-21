'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import type { ReconciliationItem } from '@matchup/contracts';
import { IconAlert, IconChevronLeft } from '@/components/icons';
import { Card, DataTable, ErrorBox, MoneyText, PageHeader, Spinner, Stat, StatusBadge } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { DiffKinds, Period } from '../parts';

/** Bir tomon (bizda yoki providerda): summa + holat. */
function Side({ side }: { side: ReconciliationItem['local'] }) {
  const { m } = useI18n();
  if (!side.amount && !side.status) return <span className="text-text-muted">—</span>;
  return (
    <div>
      <MoneyText money={side.amount} className="font-semibold" />
      {side.status && <div className="text-xs text-text-muted">{m.paymentStatus[side.status] ?? side.status}</div>}
    </div>
  );
}

export default function ReconciliationRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { m, f, lang } = useI18n();

  const q = useQuery({
    queryKey: ['reconciliation', runId],
    queryFn: () => unwrap(api.GET('/v1/admin/finance/reconciliation/{runId}', { params: { path: { runId } } })),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 5_000 : false),
  });

  const columns = useMemo<ColumnDef<ReconciliationItem, unknown>[]>(
    () => [
      { id: 'kind', header: m.reconciliation.kind, cell: ({ row: { original: i } }) => <StatusBadge status={i.kind} label={m.reconKind[i.kind] ?? i.kind} /> },
      {
        id: 'payment',
        header: m.reconciliation.payment,
        cell: ({ row: { original: i } }) => (
          <div className="font-mono text-xs">
            <div className="font-semibold">{i.provider_transaction_id ?? '—'}</div>
            {i.payment_id && <div className="text-text-muted">{i.payment_id}</div>}
          </div>
        ),
      },
      { id: 'local', header: m.reconciliation.local, cell: ({ row: { original: i } }) => <Side side={i.local} /> },
      { id: 'provider', header: m.reconciliation.provider, cell: ({ row: { original: i } }) => <Side side={i.provider} /> },
      {
        id: 'details',
        header: m.reconciliation.rawState,
        cell: ({ row: { original: i } }) =>
          Object.keys(i.details ?? {}).length ? (
            <code className="block max-w-xs truncate text-xs text-text-muted" title={JSON.stringify(i.details)}>
              {JSON.stringify(i.details)}
            </code>
          ) : null,
      },
      { id: 'at', header: m.common.date, cell: ({ row: { original: i } }) => <span className="whitespace-nowrap">{formatDateTime(i.created_at, lang)}</span> },
    ],
    [m, lang],
  );

  if (q.isLoading) return <div className="py-20 text-center text-text-muted"><Spinner /></div>;
  const run = q.data;
  if (!run) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;

  return (
    <>
      <PageHeader
        back={
          <Link href="/reconciliation" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text">
            <IconChevronLeft /> {m.nav.reconciliation}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            {m.provider[run.provider] ?? run.provider} <Period run={run} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.status} label={m.reconStatus[run.status] ?? run.status} />
            <span>
              {m.reconTrigger[run.trigger] ?? run.trigger}
              {run.triggered_by ? ` · ${f(m.reconciliation.by, { name: run.triggered_by.display_name ?? '—' })}` : ''} · {formatDateTime(run.started_at, lang)}
            </span>
          </span>
        }
      />

      {run.status === 'failed' && (
        <div className="mb-4 flex items-center gap-3 rounded-md border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          <IconAlert />
          {f(m.reconciliation.failedText, { error: run.error ?? '—' })}
        </div>
      )}
      {run.status === 'running' && <p className="mb-4 text-sm text-text-muted">{m.reconciliation.runningText}</p>}

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={m.reconciliation.local} value={run.counts.local} />
        <Stat label={m.reconciliation.provider} value={run.counts.provider} />
        <Stat label={m.reconciliation.matched} value={run.counts.matched} />
        <Stat label={m.reconciliation.diffs} value={run.counts.diffs} hint={<DiffKinds run={run} />} />
      </div>

      <Card title={m.reconciliation.diffs} padded={false}>
        <DataTable columns={columns} data={run.items} empty={m.reconciliation.itemsEmpty} rowKey={(i) => i.id} />
      </Card>
    </>
  );
}
