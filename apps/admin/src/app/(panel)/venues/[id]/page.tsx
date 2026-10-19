'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { AdminPitch } from '@matchup/contracts';
import { IconChevronLeft, IconEdit, IconPlus } from '@/components/icons';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner, SportChip } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PitchDialog, VenueForm } from '../venue-form';

export default function VenueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { m, f } = useI18n();
  const [dialog, setDialog] = useState<{ pitch?: AdminPitch } | null>(null);
  const q = useQuery({ queryKey: ['venue', id], queryFn: () => unwrap(api.GET('/v1/admin/venues/{venueId}', { params: { path: { venueId: id } } })) });

  if (q.isLoading) return <div className="py-20 text-center"><Spinner /></div>;
  if (!q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data;

  return (
    <>
      <PageHeader
        back={
          <Link href="/venues" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text">
            <IconChevronLeft /> {m.venues.title}
          </Link>
        }
        title={v.name}
        subtitle={`${v.city.name} · ${f(m.venues.upcoming, { n: v.upcoming_matches })}`}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <VenueForm key={v.updated_at} venue={v} />
        <div className="xl:sticky xl:top-8 xl:self-start">
          <Card
            title={m.venues.pitches}
            actions={
              <Button size="sm" icon={<IconPlus />} onClick={() => setDialog({})}>
                {m.venues.addPitch}
              </Button>
            }
          >
            {!v.pitches.length && <p className="text-sm text-text-muted">{m.venues.noPitches}</p>}
            <ul className="space-y-3">
              {v.pitches.map((p) => (
                <li key={p.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold">
                        {p.name} {!p.is_active && <Badge>{m.common.inactive}</Badge>}
                      </div>
                      <div className="text-sm text-text-muted">
                        {m.surface[p.surface]}
                        {p.is_indoor ? ` · ${m.venues.indoor}` : ''}
                        {p.length_m && p.width_m ? ` · ${p.length_m}×${p.width_m} m` : ''}
                        {p.max_players_per_side ? ` · ${p.max_players_per_side}v${p.max_players_per_side}` : ''}
                      </div>
                    </div>
                    <button type="button" className="rounded-full p-1.5 text-text-muted hover:bg-surface-muted" onClick={() => setDialog({ pitch: p })} aria-label={m.venues.editPitch}>
                      <IconEdit />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {p.sports.map((s) => (
                      <SportChip key={s} sport={s} />
                    ))}
                    <span className="ml-auto text-xs text-text-muted">{f(m.venues.upcoming, { n: p.upcoming_matches })}</span>
                  </div>
                  {p.is_active && (
                    <Link href={`/matches/new?pitch=${p.id}`} className="mt-3 inline-flex text-sm font-semibold text-sport-football hover:underline">
                      + {m.venues.newMatchHere}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      {dialog && <PitchDialog key={dialog.pitch?.id ?? 'new'} venueId={v.id} pitch={dialog.pitch} open onClose={() => setDialog(null)} />}
    </>
  );
}
