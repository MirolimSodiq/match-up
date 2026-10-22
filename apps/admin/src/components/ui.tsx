'use client';

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { sportColors } from '@/lib/tokens';
import { IconAlert, IconChevronLeft, IconChevronRight, IconX } from './icons';

const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');
export { cx };

// ---------------------------------------------------------------------------
// Tugmalar — pill (player bilan bir xil)
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-soft',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-muted',
  ghost: 'bg-transparent text-text hover:bg-surface-muted',
  danger: 'bg-danger text-text-inverse hover:opacity-90',
  success: 'bg-success text-text-inverse hover:opacity-90',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-pill font-semibold whitespace-nowrap transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-8 px-3.5 text-[13px]' : 'h-11 px-5 text-[15px]',
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Spinner small /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', small ? 'h-4 w-4' : 'h-6 w-6')} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Badge'lar
// ---------------------------------------------------------------------------
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'dark';
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-text-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-sport-football-tint text-sport-football',
  dark: 'bg-primary text-on-primary',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', TONES[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  open: 'info',
  full: 'success',
  in_progress: 'warning',
  completed: 'dark',
  cancelled: 'danger',
  pending_payment: 'warning',
  confirmed: 'success',
  expired: 'neutral',
  held: 'warning',
  checked_in: 'success',
  no_show: 'danger',
  created: 'neutral',
  pending: 'warning',
  authorized: 'info',
  succeeded: 'success',
  failed: 'danger',
  refunded: 'dark',
  paid: 'success',
  partially_refunded: 'warning',
  applicant: 'warning',
  active: 'success',
  suspended: 'danger',
  offboarded: 'neutral',
  offered: 'warning',
  accepted: 'success',
  arrived: 'success',
  declined: 'neutral',
  running: 'info',
  approved: 'success',
  rejected: 'danger',
  missing_at_provider: 'danger',
  missing_locally: 'danger',
  amount_mismatch: 'warning',
  status_mismatch: 'warning',
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{label}</Badge>;
}

/** Sport rangidagi kichik chip (player bilan bir xil rang tizimi). */
export function SportChip({ sport }: { sport: string }) {
  const { m } = useI18n();
  const c = sportColors(sport);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-semibold" style={{ background: c.tint, color: c.base }}>
      <span className="h-2 w-2 rounded-full" style={{ background: c.base }} />
      {m.sports[sport] ?? sport}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sahifa tuzilmasi
// ---------------------------------------------------------------------------
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back}
        <h1 className="display text-[34px] leading-10 text-text">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 className="text-[15px] font-bold text-text">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : undefined}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, accent }: { label: ReactNode; value: ReactNode; hint?: ReactNode; accent?: string }) {
  return (
    <div className="card relative overflow-hidden p-5">
      {accent && <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />}
      <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="display mt-2 text-[28px] leading-8 text-text">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-muted">{hint}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-text-muted">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md' }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-pill bg-surface-muted p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-pill font-semibold transition',
            size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm',
            o.value === value ? 'bg-surface text-text shadow-soft' : 'text-text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text">
      <input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Ko'p tanlovli chip'lar (sportlar, qulayliklar). */
export function ChipSelect({ options, value, onChange }: { options: { value: string; label: string; color?: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cx(
              'rounded-pill border px-3.5 py-1.5 text-sm font-semibold transition',
              on ? 'border-transparent bg-primary text-on-primary' : 'border-border-strong bg-surface text-text hover:bg-surface-muted',
            )}
            style={on && o.color ? { background: o.color } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal (native <dialog>: Esc, fokus tuzog'i)
// ---------------------------------------------------------------------------
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-xl bg-surface p-0 text-text shadow-float backdrop:bg-overlay', wide ? 'max-w-2xl' : 'max-w-lg')}
    >
      {open && (
        <div>
          <header className="flex items-center justify-between gap-3 px-6 pt-5">
            <h2 className="display text-[22px] leading-7">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-text-muted hover:bg-surface-muted" aria-label="close">
              <IconX />
            </button>
          </header>
          <div className="px-6 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Xatolar va bo'sh holatlar
// ---------------------------------------------------------------------------
export function errorText(err: unknown, m: ReturnType<typeof useI18n>['m']): string {
  if (err instanceof ApiError) {
    const field = err.errors[0];
    const base = m.errors[err.code] ?? err.detail ?? err.code;
    return field?.message && err.code === 'VALIDATION_FAILED' ? `${base}: ${field.field} — ${field.message}` : base;
  }
  return m.common.error;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { m } = useI18n();
  return (
    <div className="flex items-center gap-3 rounded-md border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
      <IconAlert />
      <span className="flex-1">{errorText(error, m)}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {m.common.retry}
        </Button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-text-muted">{children}</div>;
}

// ---------------------------------------------------------------------------
// Jadval (TanStack Table) + pagination
// ---------------------------------------------------------------------------
export function DataTable<T>({
  columns,
  data,
  loading,
  empty,
  onRowClick,
  rowKey,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  rowKey?: (row: T) => string;
}) {
  const { m } = useI18n();
  const table = useReactTable({ data: data ?? [], columns, getCoreRowModel: getCoreRowModel(), getRowId: rowKey ? (r) => rowKey(r) : undefined });
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((h) => (
                <th key={h.id} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-text-muted" style={{ width: h.getSize() === 150 ? undefined : h.getSize() }}>
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading && !data ? (
            <tr>
              <td colSpan={columns.length} className="py-10 text-center text-text-muted">
                <Spinner />
              </td>
            </tr>
          ) : table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <Empty>{empty ?? m.common.empty}</Empty>
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cx('border-b border-border last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-muted/60')}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  const { m, f } = useI18n();
  if (total <= limit && offset === 0) return null;
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3 text-sm text-text-muted">
      <span>{f(m.common.pageOf, { from: total ? offset + 1 : 0, to: Math.min(offset + limit, total), total })}</span>
      <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label={m.common.prev}>
        <IconChevronLeft />
      </Button>
      <Button size="sm" variant="secondary" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)} aria-label={m.common.next}>
        <IconChevronRight />
      </Button>
    </div>
  );
}

/** Pul — API'dagi `formatted` (locale bo'yicha serverda). */
export function MoneyText({ money, className }: { money: { amount: number; formatted?: string } | null | undefined; className?: string }) {
  if (!money) return <span className="text-text-muted">—</span>;
  return <span className={cx('whitespace-nowrap tabular-nums', className)}>{money.formatted ?? money.amount}</span>;
}

/** Joylar to'lishi: progress bar + son. */
export function SlotsBar({ confirmed, held, max, min, sport }: { confirmed: number; held: number; max: number; min?: number; sport?: string }) {
  const c = sportColors(sport);
  const pct = (n: number) => `${Math.min(100, (n / Math.max(max, 1)) * 100)}%`;
  return (
    <div className="min-w-28">
      <div className="mb-1 flex justify-between text-xs tabular-nums">
        <span className="font-semibold text-text">
          {confirmed}
          {held ? <span className="text-warning">+{held}</span> : null}/{max}
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-pill bg-surface-sunken">
        <div className="absolute inset-y-0 left-0 rounded-pill" style={{ width: pct(confirmed), background: c.base }} />
        <div className="absolute inset-y-0 rounded-pill opacity-40" style={{ left: pct(confirmed), width: pct(held), background: c.base }} />
        {min ? <div className="absolute inset-y-0 w-0.5 bg-text/40" style={{ left: pct(min) }} /> : null}
      </div>
    </div>
  );
}
