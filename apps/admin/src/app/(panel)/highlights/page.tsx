'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import type { AdminHighlight, HighlightRejectReason } from '@matchup/contracts';
import { IconCheck, IconPlay, IconSearch, IconX } from '@/components/icons';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, Pager, Segmented, Spinner, SportChip, StatusBadge } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { debounce, useUrlState } from '@/lib/use-url-state';

const LIMIT = 24;
type Status = 'pending' | 'approved' | 'rejected';
const STATUSES: Status[] = ['pending', 'approved', 'rejected'];
const REASONS: HighlightRejectReason[] = ['inappropriate', 'violence', 'privacy', 'not_match', 'low_quality', 'other'];

const duration = (ms: number | null) => {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Tasdiqlash / rad etish — ro'yxat va ko'rish oynasidan. */
function useModerate(onDone?: () => void) {
  const { m } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: 'approved' | 'rejected'; reason?: HighlightRejectReason; note?: string }) =>
      unwrap(
        api.POST('/v1/admin/highlights/{highlightId}/moderate', {
          params: { path: { highlightId: v.id } },
          body: { status: v.status, ...(v.reason ? { reason: v.reason } : {}), ...(v.note ? { note: v.note } : {}) },
        }),
      ),
    onSuccess: (h) => {
      void qc.invalidateQueries({ queryKey: ['highlights'] });
      toast(h.moderation.status === 'approved' ? m.highlights.approved : m.highlights.rejected);
      onDone?.();
    },
  });
}

function RejectDialog({ highlight, onClose, onDone }: { highlight: AdminHighlight; onClose: () => void; onDone: () => void }) {
  const { m } = useI18n();
  const [reason, setReason] = useState<HighlightRejectReason>('inappropriate');
  const [note, setNote] = useState('');
  const moderate = useModerate(onDone);
  return (
    <Modal
      open
      onClose={onClose}
      title={m.highlights.rejectTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button variant="danger" icon={<IconX />} loading={moderate.isPending} onClick={() => moderate.mutate({ id: highlight.id, status: 'rejected', reason, note: note.trim() })}>
            {m.highlights.reject}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">{m.highlights.rejectText}</p>
      <div className="mt-4 space-y-4">
        <Field label={m.highlights.reason}>
          <select className="field" value={reason} onChange={(e) => setReason(e.target.value as HighlightRejectReason)}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {m.rejectReason[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`${m.highlights.note} (${m.common.optional})`}>
          <textarea className="field min-h-20" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {moderate.error ? <ErrorBox error={moderate.error} /> : null}
      </div>
    </Modal>
  );
}

/** Holatga mos amallar: kutayotgan — ikkalasi, tasdiqlangan — rad etish, rad etilgan — tasdiqlash. */
function Actions({ h, onReject, onDone, size = 'sm' }: { h: AdminHighlight; onReject: () => void; onDone?: () => void; size?: 'sm' | 'md' }) {
  const { m } = useI18n();
  const moderate = useModerate(onDone);
  const status = h.moderation.status;
  return (
    <div className="flex flex-wrap gap-2">
      {status !== 'approved' && (
        <Button size={size} variant="success" icon={<IconCheck />} loading={moderate.isPending} onClick={() => moderate.mutate({ id: h.id, status: 'approved' })}>
          {m.highlights.approve}
        </Button>
      )}
      {status !== 'rejected' && (
        <Button size={size} variant="secondary" icon={<IconX />} onClick={onReject}>
          {m.highlights.reject}
        </Button>
      )}
      {moderate.error ? <ErrorBox error={moderate.error} /> : null}
    </div>
  );
}

function Decision({ h }: { h: AdminHighlight }) {
  const { m, f, lang } = useI18n();
  const d = h.moderation;
  return (
    <div className="space-y-1 text-xs text-text-muted">
      <StatusBadge status={d.status} label={m.moderationStatus[d.status] ?? d.status} />
      {d.reason && <div className="font-semibold text-danger">{m.rejectReason[d.reason] ?? d.reason}</div>}
      {d.note && <div className="line-clamp-2" title={d.note}>{d.note}</div>}
      {d.moderated_by && <div>{f(m.highlights.decidedBy, { name: d.moderated_by.display_name ?? '—', date: formatDateTime(d.moderated_at, lang) })}</div>}
    </div>
  );
}

function PreviewDialog({ highlight: h, onClose, onReject }: { highlight: AdminHighlight; onClose: () => void; onReject: () => void }) {
  const { m, lang } = useI18n();
  return (
    <Modal open wide onClose={onClose} title={h.title || m.highlights.untitled} footer={<Actions h={h} onReject={onReject} onDone={onClose} size="md" />}>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,260px)_1fr]">
        <div>
          {h.media.mp4_url ? (
            <video key={h.id} className="aspect-[9/16] w-full rounded-lg bg-black" src={h.media.mp4_url} poster={h.media.thumbnail_url ?? undefined} controls autoPlay muted playsInline />
          ) : h.media.thumbnail_url ? (
            <img className="w-full rounded-lg" src={h.media.thumbnail_url} alt="" />
          ) : null}
          <p className="mt-2 text-xs text-text-muted">{h.media.mp4_url ? m.highlights.previewNote : m.highlights.noPreview}</p>
        </div>
        <div className="space-y-4 text-sm">
          <Decision h={h} />
          <div>
            <Link href={`/matches/${h.match.id}`} className="font-mono text-xs font-semibold hover:underline">
              {h.match.public_code}
            </Link>
            <div className="text-text-muted">
              {h.match.venue_name} · {formatDateTime(h.match.starts_at, lang, h.match.timezone)}
            </div>
          </div>
          <div>
            <div className="label">{m.highlights.uploadedBy}</div>
            {h.creator.display_name} <span className="tabular-nums text-text-muted">{h.creator.phone}</span>
          </div>
          <div>
            <div className="label">{m.highlights.tags}</div>
            {h.tags.length ? (
              <div className="flex flex-wrap gap-1">
                {h.tags.map((t) => (
                  <Badge key={t.user_id}>{t.display_name}</Badge>
                ))}
              </div>
            ) : (
              <span className="text-text-muted">{m.highlights.noTags}</span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function HighlightCard({ h, onOpen, onReject }: { h: AdminHighlight; onOpen: () => void; onReject: () => void }) {
  const { m, f, lang } = useI18n();
  const dur = duration(h.duration_ms);
  return (
    <Card padded={false} className="flex flex-col overflow-hidden">
      <button type="button" onClick={onOpen} className="group relative block aspect-video w-full bg-surface-sunken" aria-label={m.highlights.preview}>
        {h.media.thumbnail_url && (
          <img src={h.media.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
          <span className="rounded-full bg-surface/90 p-3 text-text opacity-80 shadow-card group-hover:opacity-100">
            <IconPlay />
          </span>
        </span>
        {dur && <span className="absolute right-2 bottom-2 rounded-pill bg-black/70 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">{dur}</span>}
      </button>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="line-clamp-1 font-semibold">{h.title || <span className="text-text-muted">{m.highlights.untitled}</span>}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <SportChip sport={h.match.sport} />
            <Link href={`/matches/${h.match.id}`} className="font-mono font-semibold hover:underline">
              {h.match.public_code}
            </Link>
            <span>{formatDateTime(h.published_at, lang)}</span>
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {m.highlights.uploadedBy}: {h.creator.display_name} · {m.highlights.tags}: {h.tags.length} · {f(m.highlights.likes, { n: h.likes_count })}
          </div>
        </div>
        {h.moderation.status !== 'pending' && <Decision h={h} />}
        <div className="mt-auto">
          <Actions h={h} onReject={onReject} />
        </div>
      </div>
    </Card>
  );
}

function ModerationQueue() {
  const { m } = useI18n();
  const [s, setS] = useUrlState({ status: 'pending', q: '', offset: '0' });
  const [search, setSearch] = useState(s.q);
  const [open, setOpen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminHighlight | null>(null);
  const pushQ = useMemo(() => debounce((q: string) => setS({ q, offset: '0' }), 350), [setS]);

  const status = (STATUSES.includes(s.status as Status) ? s.status : 'pending') as Status;
  const query = { status, limit: LIMIT, offset: Number(s.offset) || 0, ...(s.q ? { q: s.q } : {}) };
  const list = useQuery({
    queryKey: ['highlights', query],
    queryFn: () => unwrap(api.GET('/v1/admin/highlights', { params: { query } })),
    placeholderData: keepPreviousData,
  });
  const counts = list.data?.counts;
  // Ko'rish oynasi ro'yxatdagi eng yangi holatni ko'rsatadi (qaror qabul qilingach ham)
  const preview = list.data?.items.find((h) => h.id === open);

  return (
    <>
      <PageHeader title={m.highlights.title} subtitle={m.highlights.subtitle} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={status}
          onChange={(v) => {
            setOpen(null);
            setS({ status: v, offset: '0' });
          }}
          options={STATUSES.map((st) => ({ value: st, label: `${m.moderationStatus[st]}${counts ? ` · ${counts[st]}` : ''}` }))}
        />
        <label className="relative min-w-64 flex-1">
          <IconSearch className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
          <input
            className="field pl-9"
            placeholder={m.highlights.searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              pushQ(e.target.value.trim());
            }}
          />
        </label>
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      {list.isLoading ? (
        <div className="py-20 text-center text-text-muted">
          <Spinner />
        </div>
      ) : list.data && list.data.items.length === 0 ? (
        <Card>
          <Empty>{status === 'pending' && !s.q ? m.highlights.queueEmpty : m.common.empty}</Empty>
        </Card>
      ) : (
        <div className={list.isPlaceholderData ? 'opacity-60' : undefined}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {list.data?.items.map((h) => (
              <HighlightCard key={h.id} h={h} onOpen={() => setOpen(h.id)} onReject={() => setRejecting(h)} />
            ))}
          </div>
          {(list.data?.total ?? 0) > LIMIT && (
            <Card padded={false} className="mt-4">
              <Pager total={list.data!.total} limit={LIMIT} offset={Number(s.offset) || 0} onChange={(o) => setS({ offset: String(o) })} />
            </Card>
          )}
        </div>
      )}
      {preview && <PreviewDialog highlight={preview} onClose={() => setOpen(null)} onReject={() => setRejecting(preview)} />}
      {rejecting && (
        <RejectDialog
          highlight={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            // Qaror qabul qilindi — ko'rish oynasi ham yopiladi, moderator navbatdagi klipga o'tadi
            setRejecting(null);
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

export default function HighlightsPage() {
  return (
    <Suspense>
      <ModerationQueue />
    </Suspense>
  );
}
