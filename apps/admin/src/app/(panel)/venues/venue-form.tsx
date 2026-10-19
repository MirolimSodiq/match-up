'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { AdminPitch, AdminVenue, AdminVenueCreate, Surface } from '@matchup/contracts';
import { IconExternal } from '@/components/icons';
import { useToast } from '@/components/toast';
import { Button, Card, Checkbox, ChipSelect, ErrorBox, Field, Modal } from '@/components/ui';
import { api, ApiError, unwrap } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useReference } from '@/lib/queries';
import { sportColors } from '@/lib/tokens';

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

/** "41.2995, 69.2401" yoki "41.2995 69.2401" -> { lat, lng } */
function parseCoords(v: string): { lat: number; lng: number } | null {
  const m = v.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export function VenueForm({ venue }: { venue?: AdminVenue }) {
  const { m } = useI18n();
  const ref = useReference();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState(venue?.name ?? '');
  const [slug, setSlug] = useState(venue?.slug ?? '');
  const [cityId, setCityId] = useState<number | ''>(venue?.city.id ?? '');
  const [addrUz, setAddrUz] = useState(venue?.address['uz-Latn'] ?? '');
  const [addrRu, setAddrRu] = useState(venue?.address.ru ?? '');
  const [descUz, setDescUz] = useState(venue?.description['uz-Latn'] ?? '');
  const [descRu, setDescRu] = useState(venue?.description.ru ?? '');
  const [lat, setLat] = useState(venue ? String(venue.location.lat) : '');
  const [lng, setLng] = useState(venue ? String(venue.location.lng) : '');
  const [partnerName, setPartnerName] = useState(venue?.partner_name ?? '');
  const [partnerPhone, setPartnerPhone] = useState(venue?.partner_phone ?? '');
  const [contract, setContract] = useState(venue?.contract_ref ?? '');
  const [amenities, setAmenities] = useState<string[]>(venue?.amenities.map((a) => a.code) ?? []);
  const [active, setActive] = useState(venue?.is_active ?? true);

  const city = ref.data?.cities.find((c) => c.id === cityId);
  const latN = num(lat);
  const lngN = num(lng);
  const coordsOk = latN !== null && lngN !== null && Math.abs(latN) <= 90 && Math.abs(lngN) <= 180;

  const save = useMutation({
    mutationFn: async () => {
      const tr = (uz: string, ru: string) => ({ ...(uz.trim() ? { 'uz-Latn': uz.trim() } : {}), ...(ru.trim() ? { ru: ru.trim() } : {}) });
      const body: AdminVenueCreate = {
        city_id: cityId as number,
        name: name.trim(),
        address: tr(addrUz, addrRu),
        description: tr(descUz, descRu),
        location: { lat: latN!, lng: lngN! },
        partner_name: partnerName.trim() || null,
        partner_phone: partnerPhone.replace(/[\s()-]/g, '') || null,
        contract_ref: contract.trim() || null,
        amenities,
        is_active: active,
        ...(slug.trim() && slug.trim() !== venue?.slug ? { slug: slug.trim() } : {}),
      };
      if (venue) return unwrap(api.PATCH('/v1/admin/venues/{venueId}', { params: { path: { venueId: venue.id } }, body }));
      return unwrap(api.POST('/v1/admin/venues', { body }));
    },
    onSuccess: (v) => {
      void qc.invalidateQueries({ queryKey: ['venues'] });
      qc.setQueryData(['venue', v.id], v);
      toast(venue ? m.venues.saved : m.venues.created);
      if (!venue) router.push(`/venues/${v.id}`);
    },
  });

  const err = save.error instanceof ApiError ? save.error : null;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (cityId && name.trim().length >= 2 && coordsOk) save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card title={m.venues.name}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={m.venues.name}>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
          </Field>
          <Field label={m.common.city}>
            <select className="field" value={cityId} onChange={(e) => setCityId(e.target.value ? Number(e.target.value) : '')} required>
              <option value="" />
              {ref.data?.cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={m.venues.slug} hint={m.venues.slugHint} error={err?.code === 'ALREADY_EXISTS' ? m.errors.ALREADY_EXISTS : err?.fieldError('slug')}>
            <input className="field font-mono" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} />
          </Field>
          <Field label={m.venues.timezone}>
            <input className="field" value={venue?.timezone ?? city?.timezone ?? ''} readOnly disabled />
          </Field>
          <Field label={m.venues.addressUz}>
            <input className="field" value={addrUz} onChange={(e) => setAddrUz(e.target.value)} maxLength={500} />
          </Field>
          <Field label={m.venues.addressRu}>
            <input className="field" value={addrRu} onChange={(e) => setAddrRu(e.target.value)} maxLength={500} />
          </Field>
          <Field label={m.venues.descriptionUz}>
            <textarea className="field min-h-20" value={descUz} onChange={(e) => setDescUz(e.target.value)} maxLength={500} />
          </Field>
          <Field label={m.venues.descriptionRu}>
            <textarea className="field min-h-20" value={descRu} onChange={(e) => setDescRu(e.target.value)} maxLength={500} />
          </Field>
        </div>
      </Card>

      <Card
        title={m.venues.location}
        actions={
          coordsOk ? (
            <a href={`https://www.google.com/maps?q=${latN},${lngN}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-sport-football">
              {m.venues.openMap} <IconExternal />
            </a>
          ) : null
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={m.venues.pasteCoords} hint={m.venues.mapHint}>
            <input
              className="field"
              placeholder="41.2995, 69.2401"
              onChange={(e) => {
                const c = parseCoords(e.target.value);
                if (c) {
                  setLat(String(c.lat));
                  setLng(String(c.lng));
                }
              }}
            />
          </Field>
          <Field label={m.venues.lat} error={lat && !coordsOk ? '−90…90' : undefined}>
            <input className="field tabular-nums" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} required />
          </Field>
          <Field label={m.venues.lng} error={lng && !coordsOk ? '−180…180' : undefined}>
            <input className="field tabular-nums" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} required />
          </Field>
        </div>
      </Card>

      <Card title={m.venues.amenities}>
        <ChipSelect value={amenities} onChange={setAmenities} options={(ref.data?.amenities ?? []).map((a) => ({ value: a.code, label: a.name }))} />
      </Card>

      <Card title={m.venues.partner}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={m.venues.partnerName}>
            <input className="field" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} maxLength={200} />
          </Field>
          <Field label={m.venues.partnerPhone} error={err?.fieldError('partner_phone')}>
            <input className="field" inputMode="tel" placeholder="+998 71 200 00 00" value={partnerPhone} onChange={(e) => setPartnerPhone(e.target.value)} />
          </Field>
          <Field label={m.venues.contractRef}>
            <input className="field" value={contract} onChange={(e) => setContract(e.target.value)} maxLength={100} />
          </Field>
        </div>
        <div className="mt-4">
          <Checkbox checked={active} onChange={setActive} label={m.venues.isActive} />
        </div>
      </Card>

      {save.error && err?.code !== 'ALREADY_EXISTS' ? <ErrorBox error={save.error} /> : null}
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} disabled={!cityId || name.trim().length < 2 || !coordsOk}>
          {venue ? m.common.save : m.common.create}
        </Button>
      </div>
    </form>
  );
}

/** Pitch yaratish / tahrirlash (pitch_sports bilan). */
export function PitchDialog({ venueId, pitch, open, onClose }: { venueId: string; pitch?: AdminPitch; open: boolean; onClose: () => void }) {
  const { m } = useI18n();
  const ref = useReference();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(pitch?.name ?? '');
  const [surface, setSurface] = useState<Surface>(pitch?.surface ?? 'artificial_turf');
  const [indoor, setIndoor] = useState(pitch?.is_indoor ?? false);
  const [length, setLength] = useState(pitch?.length_m != null ? String(pitch.length_m) : '');
  const [width, setWidth] = useState(pitch?.width_m != null ? String(pitch.width_m) : '');
  const [perSide, setPerSide] = useState(pitch?.max_players_per_side != null ? String(pitch.max_players_per_side) : '');
  const [sports, setSports] = useState<string[]>(pitch?.sports ?? ['football']);
  const [active, setActive] = useState(pitch?.is_active ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        surface,
        is_indoor: indoor,
        length_m: num(length),
        width_m: num(width),
        max_players_per_side: perSide ? Number(perSide) : null,
        sports,
        is_active: active,
      };
      return pitch
        ? unwrap(api.PATCH('/v1/admin/pitches/{pitchId}', { params: { path: { pitchId: pitch.id } }, body }))
        : unwrap(api.POST('/v1/admin/venues/{venueId}/pitches', { params: { path: { venueId } }, body }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['venue', venueId] });
      void qc.invalidateQueries({ queryKey: ['venues'] });
      toast(m.venues.pitchSaved);
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={pitch ? m.venues.editPitch : m.venues.addPitch}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button loading={save.isPending} disabled={!name.trim() || !sports.length} onClick={() => save.mutate()}>
            {m.common.save}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={m.venues.name}>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Pitch A" autoFocus />
        </Field>
        <Field label={m.venues.surface}>
          <select className="field" value={surface} onChange={(e) => setSurface(e.target.value as Surface)}>
            {(ref.data?.surfaces ?? []).map((s) => (
              <option key={s} value={s}>
                {m.surface[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`${m.venues.length}, m`}>
          <input className="field" inputMode="decimal" value={length} onChange={(e) => setLength(e.target.value)} />
        </Field>
        <Field label={`${m.venues.width}, m`}>
          <input className="field" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} />
        </Field>
        <Field label={m.venues.maxPerSide}>
          <input className="field" type="number" min={1} max={15} value={perSide} onChange={(e) => setPerSide(e.target.value)} />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-2">
          <Checkbox checked={indoor} onChange={setIndoor} label={m.venues.indoor} />
          <Checkbox checked={active} onChange={setActive} label={m.venues.isActive} />
        </div>
        <Field label={m.venues.sports} className="sm:col-span-2" error={save.error instanceof ApiError ? save.error.fieldError('sports') : undefined}>
          <ChipSelect value={sports} onChange={setSports} options={(ref.data?.sports ?? []).map((s) => ({ value: s.code, label: s.name, color: sportColors(s.code).base }))} />
        </Field>
      </div>
      {save.error ? (
        <div className="mt-4">
          <ErrorBox error={save.error} />
        </div>
      ) : null}
    </Modal>
  );
}
