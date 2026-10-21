'use client';

import type { ReconciliationRun } from '@matchup/contracts';
import { StatusBadge } from '@/components/ui';
import { formatDate, formatDateTime, formatTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

const KINDS = ['missing_at_provider', 'missing_locally', 'amount_mismatch', 'status_mismatch'] as const;

/** Run davri. Kechki job va qo'lda run'lar butun kunlar ([00:00, 00:00)) — kunlar bilan ko'rsatiladi. */
export function Period({ run }: { run: ReconciliationRun }) {
  const { lang } = useI18n();
  const { from, to } = run.period;
  if (formatTime(from) === '00:00' && formatTime(to) === '00:00') {
    const last = new Date(Date.parse(to) - 1).toISOString();
    const a = formatDate(from, lang);
    const b = formatDate(last, lang);
    return <span className="font-semibold whitespace-nowrap">{a === b ? a : `${a} — ${b}`}</span>;
  }
  return (
    <span className="whitespace-nowrap">
      {formatDateTime(from, lang)} — {formatDateTime(to, lang)}
    </span>
  );
}

/** Farqlar turlari bo'yicha (faqat noldan kattalari). */
export function DiffKinds({ run }: { run: ReconciliationRun }) {
  const { m } = useI18n();
  const kinds = KINDS.filter((k) => run.diffs_by_kind[k] > 0);
  if (!kinds.length) return <span className="text-text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {kinds.map((k) => (
        <StatusBadge key={k} status={k} label={`${m.reconKind[k]} · ${run.diffs_by_kind[k]}`} />
      ))}
    </div>
  );
}
