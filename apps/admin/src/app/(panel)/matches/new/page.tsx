'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { AdminMatchCreate, SkillLevel } from '@matchup/contracts';
import { IconAlert, IconChevronLeft } from '@/components/icons';
import { useToast } from '@/components/toast';
import { Button, Card, ErrorBox, Field, PageHeader, Segmented } from '@/components/ui';
import { api, ApiError, idempotencyKey, unwrap } from '@/lib/api';
import { somToTiyin, todayIn, zonedToIso } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useAllVenues, useReference } from '@/lib/queries';
import { sportColors } from '@/lib/tokens';

const LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced', 'pro'];
const DURATIONS = [60, 90, 120];

const groupSom = (v: string) => {
  const digits = v.replace(/[^\d]/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function NewMatchForm() {
  const { m, f } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const ref = useReference();
  const venues = useAllVenues(true);

  const [venueId, setVenueId] = useState('');
  const [pitchId, setPitchId] = useState('');
  const [sport, setSport] = useState('');
  const [date, setDate] = useState(todayIn(undefined, 1));
  const [time, setTime] = useState('19:00');
  const [duration, setDuration] = useState(90);
  const [perSide, setPerSide] = useState(7);
  const [minPlayers, setMinPlayers] = useState(10);
  const [maxPlayers, setMaxPlayers] = useState(14);
  const [price, setPrice] = useState('45 000');
  const [lease, setLease] = useState('400 000');
  const [hostFee, setHostFee] = useState('150 000');
  const [levelMin, setLevelMin] = useState<SkillLevel | ''>('');
  const [levelMax, setLevelMax] = useState<SkillLevel | ''>('');
  const [gender, setGender] = useState<'any' | 'male' | 'female' | 'mixed'>('any');
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('public');
  const [titleUz, setTitleUz] = useState('');
  const [titleRu, setTitleRu] = useState('');
  const [touched, setTouched] = useState(false);

  // ?pitch=<id> — venue sahifasidan "Shu maydonda match"
  useEffect(() => {
    const p = params.get('pitch');
    if (!p || !venues.data || pitchId) return;
    const v = venues.data.items.find((x) => x.pitches.some((pp) => pp.id === p));
    if (v) {
      setVenueId(v.id);
      setPitchId(p);
    }
  }, [params, venues.data, pitchId]);

  const venue = venues.data?.items.find((v) => v.id === venueId);
  const pitches = venue?.pitches.filter((p) => p.is_active) ?? [];
  const pitch = pitches.find((p) => p.id === pitchId);
  const tz = venue?.timezone ?? 'Asia/Tashkent';
  const city = ref.data?.cities.find((c) => c.id === venue?.city.id);

  // Pitch tanlanganda: sport va jamoa hajmi standartlari
  useEffect(() => {
    if (!pitch) return;
    const s = pitch.sports.includes(sport) ? sport : (pitch.sports[0] ?? '');
    setSport(s);
    const def = ref.data?.sports.find((x) => x.code === s)?.default_players_per_side ?? 5;
    const n = Math.min(def, pitch.max_players_per_side ?? def);
    setPerSide(n);
    setMaxPlayers(n * 2);
    setMinPlayers(Math.max(2, Math.ceil(n * 2 * 0.7)));
  }, [pitchId]);

  const priceT = somToTiyin(price);
  const leaseT = somToTiyin(lease);
  const hostT = somToTiyin(hostFee || '0');
  const moneyOk = priceT !== null && leaseT !== null && hostT !== null;
  const minMaxOk = minPlayers <= maxPlayers;
  const fmtSom = (t: number) => `${groupSom(String(Math.round(t / 100)))} ${m.common.som}`;
  const economics = moneyOk ? f(m.matchForm.economics, { revenue: fmtSom(priceT * maxPlayers), margin: fmtSom(priceT * maxPlayers - leaseT - hostT) }) : null;

  const create = useMutation({
    mutationFn: async (publish: boolean) => {
      const body: AdminMatchCreate = {
        pitch_id: pitchId,
        sport,
        starts_at: zonedToIso(date, time, tz),
        duration_min: duration,
        format: `${perSide}v${perSide}`,
        players_per_side: perSide,
        min_players: minPlayers,
        max_players: maxPlayers,
        price: { amount: priceT!, currency: city?.currency ?? 'UZS' },
        lease_cost: { amount: leaseT!, currency: city?.currency ?? 'UZS' },
        host_fee: { amount: hostT ?? 0, currency: city?.currency ?? 'UZS' },
        level: { min: levelMin || undefined, max: levelMax || undefined },
        gender_policy: gender,
        visibility,
        cancellation_policy_code: ref.data?.cancellation_policies.find((x) => x.is_default)?.code ?? 'standard',
        title: { ...(titleUz.trim() ? { 'uz-Latn': titleUz.trim() } : {}), ...(titleRu.trim() ? { ru: titleRu.trim() } : {}) },
      };
      const created = await unwrap(api.POST('/v1/admin/matches', { params: { header: { 'Idempotency-Key': idempotencyKey() } }, body }));
      if (publish) await unwrap(api.POST('/v1/admin/matches/{matchId}/publish', { params: { path: { matchId: created.id } } }));
      return created;
    },
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['matches'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(m.matchForm.created);
      router.push(`/matches/${created.id}`);
    },
  });

  const overlap = create.error instanceof ApiError && create.error.code === 'LEASE_OVERLAP';
  const canSubmit = !!pitchId && !!sport && moneyOk && minMaxOk && !!date && !!time;

  function submit(e: Pick<FormEvent, 'preventDefault'>, publish: boolean) {
    e.preventDefault();
    setTouched(true);
    if (canSubmit) create.mutate(publish);
  }

  const sc = sportColors(sport);
  return (
    <form onSubmit={(e) => submit(e, true)}>
      <PageHeader
        back={
          <Link href="/matches" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text">
            <IconChevronLeft /> {m.nav.matches}
          </Link>
        }
        title={m.matchForm.title}
        subtitle={m.matchForm.subtitle}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Section title={m.matchForm.where}>
            <Field label={m.common.venue}>
              <select
                className="field"
                value={venueId}
                onChange={(e) => {
                  setVenueId(e.target.value);
                  setPitchId('');
                }}
                required
              >
                <option value="">{m.matchForm.pickVenue}</option>
                {venues.data?.items.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.city.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={m.common.pitch} error={venue && !pitches.length ? m.matchForm.noPitches : undefined}>
              <select className="field" value={pitchId} onChange={(e) => setPitchId(e.target.value)} disabled={!venue} required>
                <option value="">{m.matchForm.pickPitch}</option>
                {pitches.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {m.surface[p.surface]} · {p.sports.map((s) => m.sports[s] ?? s).join(', ')}
                  </option>
                ))}
              </select>
            </Field>
            {pitch && pitch.sports.length > 1 && (
              <Field label={m.common.sport} className="sm:col-span-2">
                <Segmented value={sport} onChange={setSport} options={pitch.sports.map((s) => ({ value: s, label: m.sports[s] ?? s }))} />
              </Field>
            )}
          </Section>

          <Section title={m.matchForm.when}>
            <Field label={m.matchForm.date} hint={f(m.matchForm.tzHint, { tz })}>
              <input type="date" className="field" value={date} min={todayIn(tz)} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label={m.matchForm.time}>
              <input type="time" className="field" value={time} step={900} onChange={(e) => setTime(e.target.value)} required />
            </Field>
            <Field label={m.matchForm.duration} className="sm:col-span-2">
              <Segmented value={String(duration)} onChange={(v) => setDuration(Number(v))} options={DURATIONS.map((d) => ({ value: String(d), label: f(m.matchForm.minutes, { n: d }) }))} />
            </Field>
            {overlap && (
              <div className="flex gap-2 rounded-md bg-danger-soft px-4 py-3 text-sm font-medium text-danger sm:col-span-2" role="alert">
                <IconAlert className="mt-0.5 shrink-0" />
                {m.matchForm.leaseOverlap}
              </div>
            )}
          </Section>

          <Section title={m.matchForm.format}>
            <Field label={m.matchForm.playersPerSide} hint={`${perSide}v${perSide}`}>
              <input
                type="number"
                className="field"
                min={1}
                max={pitch?.max_players_per_side ?? 15}
                value={perSide}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setPerSide(n);
                  setMaxPlayers(n * 2);
                  setMinPlayers(Math.max(2, Math.ceil(n * 2 * 0.7)));
                }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={m.matchForm.minPlayers}>
                <input type="number" className="field" min={2} max={40} value={minPlayers} onChange={(e) => setMinPlayers(Number(e.target.value))} />
              </Field>
              <Field label={m.matchForm.maxPlayers}>
                <input type="number" className="field" min={2} max={40} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
              </Field>
            </div>
            {!minMaxOk && <p className="text-sm font-medium text-danger sm:col-span-2">{m.matchForm.minMax}</p>}
            <Field label={m.matchForm.levelMin}>
              <select className="field" value={levelMin} onChange={(e) => setLevelMin(e.target.value as SkillLevel | '')}>
                <option value="">{m.matchForm.anyLevel}</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {m.level[l]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={m.matchForm.levelMax}>
              <select className="field" value={levelMax} onChange={(e) => setLevelMax(e.target.value as SkillLevel | '')}>
                <option value="">{m.matchForm.anyLevel}</option>
                {LEVELS.filter((l) => !levelMin || LEVELS.indexOf(l) >= LEVELS.indexOf(levelMin)).map((l) => (
                  <option key={l} value={l}>
                    {m.level[l]}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title={m.matchForm.money}>
            {(
              [
                [m.matchForm.price, price, setPrice, priceT],
                [m.matchForm.leaseCost, lease, setLease, leaseT],
                [m.matchForm.hostFee, hostFee, setHostFee, hostT],
              ] as const
            ).map(([label, value, set, parsed]) => (
              <Field key={label} label={label} error={touched && parsed === null ? m.matchForm.invalidMoney : undefined}>
                <div className="relative">
                  <input className="field pr-14 text-right tabular-nums" inputMode="numeric" value={value} onChange={(e) => set(groupSom(e.target.value))} />
                  <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-text-muted">{m.common.som}</span>
                </div>
              </Field>
            ))}
            {economics && <p className="self-end pb-2 text-sm text-text-muted">{economics}</p>}
          </Section>

          <Section title={m.matchForm.extra}>
            <Field label={m.matchForm.titleUz}>
              <input className="field" value={titleUz} maxLength={120} placeholder={venue ? `${perSide}v${perSide} ${venue.name}` : ''} onChange={(e) => setTitleUz(e.target.value)} />
            </Field>
            <Field label={m.matchForm.titleRu}>
              <input className="field" value={titleRu} maxLength={120} onChange={(e) => setTitleRu(e.target.value)} />
            </Field>
            <Field label={m.matchForm.gender}>
              <select className="field" value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}>
                <option value="any">{m.matchForm.genderAny}</option>
                <option value="male">{m.matchForm.genderMale}</option>
                <option value="female">{m.matchForm.genderFemale}</option>
                <option value="mixed">{m.matchForm.genderMixed}</option>
              </select>
            </Field>
            <Field label={m.matchForm.visibility}>
              <select className="field" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
                <option value="public">{m.matchForm.visPublic}</option>
                <option value="unlisted">{m.matchForm.visUnlisted}</option>
                <option value="private">{m.matchForm.visPrivate}</option>
              </select>
            </Field>
          </Section>
        </div>

        {/* Ko'rinish: sport rangidagi karta (player ilovasidagi kabi) + amallar */}
        <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <div className="overflow-hidden rounded-xl p-5 text-on-sport shadow-card" style={{ background: `linear-gradient(160deg, ${sc.base}, ${sc.deep})` }}>
            <div className="flex justify-between text-xs font-semibold" style={{ color: sc.muted }}>
              <span>{sport ? m.sports[sport] : '—'}</span>
              <span>
                {perSide}v{perSide}
              </span>
            </div>
            <div className="display mt-3 text-6xl leading-none">{time || '--:--'}</div>
            <div className="mt-2 text-sm" style={{ color: sc.muted }}>
              {date} · {f(m.matchForm.minutes, { n: duration })}
            </div>
            <div className="mt-4 text-sm font-semibold">{venue ? `${venue.name} · ${pitch?.name ?? '…'}` : m.matchForm.pickVenue}</div>
            <div className="display mt-4 text-2xl">{priceT !== null ? fmtSom(priceT) : '—'}</div>
          </div>
          {create.error && !overlap ? <ErrorBox error={create.error} /> : null}
          <Button type="submit" className="w-full" loading={create.isPending && create.variables === true} disabled={create.isPending}>
            {m.matchForm.createAndPublish}
          </Button>
          <Button type="button" variant="secondary" className="w-full" loading={create.isPending && create.variables === false} disabled={create.isPending} onClick={(e) => submit(e, false)}>
            {m.matchForm.saveDraft}
          </Button>
        </aside>
      </div>
    </form>
  );
}

export default function NewMatchPage() {
  return (
    <Suspense>
      <NewMatchForm />
    </Suspense>
  );
}
