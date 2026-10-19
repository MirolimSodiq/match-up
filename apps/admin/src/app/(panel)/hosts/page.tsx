'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Suspense, useMemo, useState } from 'react';
import type { AdminHost } from '@matchup/contracts';
import { IconEdit, IconPlus, IconSearch } from '@/components/icons';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Checkbox, ChipSelect, DataTable, ErrorBox, Field, Modal, MoneyText, PageHeader, Pager, Segmented, SportChip, StatusBadge } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatPct } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useReference } from '@/lib/queries';
import { sportColors } from '@/lib/tokens';
import { debounce, useUrlState } from '@/lib/use-url-state';

const LIMIT = 25;

/** Host qo'shish (telefon bo'yicha) yoki profilini tahrirlash. */
function HostDialog({ host, onClose }: { host?: AdminHost; onClose: () => void }) {
  const { m } = useI18n();
  const ref = useReference();
  const toast = useToast();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('+998 ');
  const [name, setName] = useState('');
  const [cityId, setCityId] = useState<number | ''>(host?.city.id ?? ref.data?.cities[0]?.id ?? '');
  const [lat, setLat] = useState(host?.base_location ? String(host.base_location.lat) : '');
  const [lng, setLng] = useState(host?.base_location ? String(host.base_location.lng) : '');
  const [travel, setTravel] = useState(host?.max_travel_km ?? 10);
  const [kit, setKit] = useState(host?.has_kit ?? false);
  const [kitNotes, setKitNotes] = useState(host?.kit_notes ?? '');
  const [sports, setSports] = useState<string[]>(host?.sports ?? ['football']);
  const [approve, setApprove] = useState(false);

  const loc = lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;
  const save = useMutation({
    mutationFn: () => {
      const profile = { city_id: cityId as number, base_location: loc, max_travel_km: travel, has_kit: kit, kit_notes: kitNotes.trim() || null, sports };
      return host
        ? unwrap(api.PATCH('/v1/admin/hosts/{userId}', { params: { path: { userId: host.user_id } }, body: profile }))
        : unwrap(
            api.POST('/v1/admin/hosts', {
              body: { ...profile, phone: phone.replace(/\s/g, ''), approve, max_travel_km: travel, has_kit: kit, ...(name.trim() ? { display_name: name.trim() } : {}) },
            }),
          );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hosts'] });
      toast(host ? m.venues.saved : m.hosts.created);
      onClose();
    },
  });

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={host ? m.hosts.edit : m.hosts.create}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button loading={save.isPending} disabled={!cityId || !sports.length || (!host && phone.replace(/\D/g, '').length < 9)} onClick={() => save.mutate()}>
            {host ? m.common.save : m.common.add}
          </Button>
        </>
      }
    >
      {!host && <p className="mb-4 text-sm text-text-muted">{m.hosts.createText}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {!host && (
          <>
            <Field label={m.common.phone}>
              <input className="field" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
            </Field>
            <Field label={m.hosts.displayName}>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </Field>
          </>
        )}
        <Field label={m.hosts.homeCity}>
          <select className="field" value={cityId} onChange={(e) => setCityId(Number(e.target.value))}>
            {ref.data?.cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={m.hosts.travel}>
          <input type="number" className="field" min={1} max={100} value={travel} onChange={(e) => setTravel(Number(e.target.value))} />
        </Field>
        <Field label={`${m.hosts.baseLocation} — lat`}>
          <input className="field tabular-nums" inputMode="decimal" placeholder="41.2995" value={lat} onChange={(e) => setLat(e.target.value)} />
        </Field>
        <Field label="lng">
          <input className="field tabular-nums" inputMode="decimal" placeholder="69.2401" value={lng} onChange={(e) => setLng(e.target.value)} />
        </Field>
        <Field label={m.hosts.sports} className="sm:col-span-2">
          <ChipSelect value={sports} onChange={setSports} options={(ref.data?.sports ?? []).map((s) => ({ value: s.code, label: s.name, color: sportColors(s.code).base }))} />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <Checkbox checked={kit} onChange={setKit} label={m.hosts.hasKit} />
          {kit && <input className="field" placeholder={m.hosts.kitNotes} value={kitNotes} onChange={(e) => setKitNotes(e.target.value)} maxLength={500} />}
          {!host && <Checkbox checked={approve} onChange={setApprove} label={m.hosts.approveNow} />}
        </div>
      </div>
      {save.error ? (
        <div className="mt-4">
          <ErrorBox error={save.error} />
        </div>
      ) : null}
    </Modal>
  );
}

function SuspendDialog({ host, onClose }: { host: AdminHost; onClose: () => void }) {
  const { m, f } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const suspend = useMutation({
    mutationFn: () => unwrap(api.POST('/v1/admin/hosts/{userId}/suspend', { params: { path: { userId: host.user_id } }, body: { reason: reason.trim() } })),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['hosts'] });
      toast(f(m.hosts.suspended, { n: r.cancelled_assignments }));
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={m.hosts.suspendTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button variant="danger" loading={suspend.isPending} disabled={reason.trim().length < 3} onClick={() => suspend.mutate()}>
            {m.hosts.suspend}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        <span className="font-semibold">{host.display_name}</span> · {host.phone}
      </p>
      <p className="mt-1 text-sm text-text-muted">{m.hosts.suspendText}</p>
      <Field label={m.hosts.reason} className="mt-4">
        <textarea className="field min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
      </Field>
      {suspend.error ? <ErrorBox error={suspend.error} /> : null}
    </Modal>
  );
}

function HostsTable() {
  const { m, f, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const ref = useReference();
  const [s, setS] = useUrlState({ status: '', city: '', q: '', offset: '0' });
  const [search, setSearch] = useState(s.q);
  const pushQ = useMemo(() => debounce((q: string) => setS({ q, offset: '0' }), 350), [setS]);
  const [dialog, setDialog] = useState<{ kind: 'create' } | { kind: 'edit' | 'suspend'; host: AdminHost } | null>(null);

  const query = { limit: LIMIT, offset: Number(s.offset) || 0, ...(s.status ? { status: s.status } : {}), ...(s.city ? { city_id: Number(s.city) } : {}), ...(s.q ? { q: s.q } : {}) };
  const list = useQuery({ queryKey: ['hosts', query], queryFn: () => unwrap(api.GET('/v1/admin/hosts', { params: { query } })), placeholderData: keepPreviousData });
  const approve = useMutation({
    mutationFn: (userId: string) => unwrap(api.POST('/v1/admin/hosts/{userId}/approve', { params: { path: { userId } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hosts'] });
      toast(m.hosts.approved);
    },
    onError: (e) => toast(e.message, 'danger'),
  });

  const columns = useMemo<ColumnDef<AdminHost, unknown>[]>(
    () => [
      {
        id: 'host',
        header: m.matches.host,
        cell: ({ row: { original: h } }) => (
          <div>
            <div className="font-semibold">{h.display_name}</div>
            <div className="text-xs tabular-nums text-text-muted">{h.phone}</div>
          </div>
        ),
      },
      {
        id: 'status',
        header: m.common.status,
        cell: ({ row: { original: h } }) => (
          <div>
            <StatusBadge status={h.status} label={m.hostStatus[h.status] ?? h.status} />
            {h.suspended_reason && <div className="mt-1 max-w-48 truncate text-xs text-text-muted" title={h.suspended_reason}>{h.suspended_reason}</div>}
            {h.verified_at && h.status === 'active' && <div className="mt-1 text-xs text-text-muted">{f(m.hosts.verified, { date: formatDate(h.verified_at, lang) })}</div>}
          </div>
        ),
      },
      {
        id: 'where',
        header: m.common.city,
        cell: ({ row: { original: h } }) => (
          <div className="text-sm">
            {h.city.name}
            <div className="text-xs text-text-muted">≤ {h.max_travel_km} km</div>
          </div>
        ),
      },
      {
        id: 'sports',
        header: m.hosts.sports,
        cell: ({ row: { original: h } }) => (
          <div className="flex flex-wrap gap-1">
            {h.sports.map((sp) => (
              <SportChip key={sp} sport={sp} />
            ))}
            {h.has_kit && <Badge>{m.hosts.kit}</Badge>}
          </div>
        ),
      },
      {
        id: 'stats',
        header: m.hosts.stats,
        cell: ({ row: { original: h } }) => (
          <div className="grid min-w-40 grid-cols-[auto_auto] gap-x-3 text-xs whitespace-nowrap tabular-nums">
            <span className="text-text-muted">{m.hosts.completed}</span>
            <span className="font-semibold">{h.stats.completed_matches}</span>
            <span className="text-text-muted">{m.hosts.upcoming}</span>
            <span className="font-semibold">{h.stats.upcoming_matches}</span>
            <span className="text-text-muted">{m.hosts.acceptance}</span>
            <span className="font-semibold">{formatPct(h.stats.acceptance_rate)}</span>
            <span className="text-text-muted">{m.hosts.noShows}</span>
            <span className={`font-semibold ${h.stats.no_show_count ? 'text-danger' : ''}`}>{h.stats.no_show_count}</span>
          </div>
        ),
      },
      { id: 'earned', header: m.hosts.earned, cell: ({ row: { original: h } }) => <MoneyText money={h.stats.earned} className="font-semibold" /> },
      {
        id: 'actions',
        header: '',
        cell: ({ row: { original: h } }) => (
          <div className="flex justify-end gap-1.5">
            {(h.status === 'applicant' || h.status === 'suspended') && (
              <Button size="sm" variant="success" loading={approve.isPending && approve.variables === h.user_id} onClick={() => approve.mutate(h.user_id)}>
                {h.status === 'suspended' ? m.hosts.reinstate : m.hosts.approve}
              </Button>
            )}
            {(h.status === 'active' || h.status === 'applicant') && (
              <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'suspend', host: h })}>
                {m.hosts.suspend}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'edit', host: h })} aria-label={m.common.edit}>
              <IconEdit />
            </Button>
          </div>
        ),
      },
    ],
    [m, f, lang, approve],
  );

  return (
    <>
      <PageHeader
        title={m.hosts.title}
        actions={
          <Button icon={<IconPlus />} onClick={() => setDialog({ kind: 'create' })}>
            {m.hosts.create}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={s.status}
          onChange={(status) => setS({ status, offset: '0' })}
          options={[
            { value: '', label: m.common.all },
            { value: 'applicant', label: m.hostStatus.applicant! },
            { value: 'active', label: m.hostStatus.active! },
            { value: 'suspended', label: m.hostStatus.suspended! },
          ]}
        />
        <select className="field w-40" value={s.city} onChange={(e) => setS({ city: e.target.value, offset: '0' })} aria-label={m.common.city}>
          <option value="">
            {m.common.city}: {m.common.all}
          </option>
          {ref.data?.cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="relative min-w-56 flex-1">
          <IconSearch className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
          <input
            className="field pl-9"
            placeholder={m.hosts.searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              pushQ(e.target.value.trim());
            }}
          />
        </label>
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      <Card padded={false} className={list.isPlaceholderData ? 'opacity-60' : undefined}>
        <DataTable columns={columns} data={list.data?.items} loading={list.isLoading} rowKey={(h) => h.user_id} />
        <Pager total={list.data?.total ?? 0} limit={LIMIT} offset={Number(s.offset) || 0} onChange={(o) => setS({ offset: String(o) })} />
      </Card>
      {dialog?.kind === 'create' && <HostDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <HostDialog host={dialog.host} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'suspend' && <SuspendDialog host={dialog.host} onClose={() => setDialog(null)} />}
    </>
  );
}

export default function HostsPage() {
  return (
    <Suspense>
      <HostsTable />
    </Suspense>
  );
}
