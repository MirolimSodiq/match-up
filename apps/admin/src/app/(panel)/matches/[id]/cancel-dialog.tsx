'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdminCancelMatch, AdminMatchDetail } from '@matchup/contracts';
import { useToast } from '@/components/toast';
import { Button, cx, ErrorBox, Field, Modal } from '@/components/ui';
import { api, idempotencyKey, unwrap } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Reason = AdminCancelMatch['reason'];
const REASONS: Reason[] = ['weather', 'venue_issue', 'no_host', 'min_players_not_reached', 'other'];

/** Bekor qilish: refund yo'nalishi (kartaga -> navbat / hamyonga -> darhol) va hamyon bonusi. */
export function CancelDialog({ match, open, onClose }: { match: AdminMatchDetail; open: boolean; onClose: () => void }) {
  const { m, f } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState<Reason>('weather');
  const [destination, setDestination] = useState<'original_method' | 'wallet'>('original_method');
  const [bonus, setBonus] = useState(0);

  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/admin/matches/{matchId}/cancel', {
          params: { path: { matchId: match.id }, header: { 'Idempotency-Key': idempotencyKey() } },
          body: { reason, refund_destination: destination, wallet_bonus_pct: destination === 'wallet' ? bonus : 0 },
        }),
      ),
    onSuccess: (r) => {
      toast(f(m.matchDetail.cancelled, { n: r.refunds_queued ?? 0 }));
      void qc.invalidateQueries();
      onClose();
    },
  });

  const paid = match.bookings.filter((b) => b.status === 'confirmed');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.matchDetail.cancelTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.close}
          </Button>
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {m.matchDetail.confirmCancel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">{m.matchDetail.cancelText}</p>
      <p className="mt-2 text-sm font-semibold">
        {paid.length} × {m.bookingStatus.confirmed} · {match.revenue.net.formatted}
      </p>
      <div className="mt-4 space-y-4">
        <Field label={m.matchDetail.reason}>
          <select className="field" value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {m.cancelReason[r]}
              </option>
            ))}
          </select>
        </Field>
        <fieldset>
          <legend className="label">{m.matchDetail.destination}</legend>
          <div className="space-y-2">
            {(['original_method', 'wallet'] as const).map((d) => (
              <label key={d} className={cx('flex cursor-pointer gap-3 rounded-md border p-3 text-sm', destination === d ? 'border-primary bg-surface-muted' : 'border-border')}>
                <input type="radio" name="dest" className="mt-0.5 accent-primary" checked={destination === d} onChange={() => setDestination(d)} />
                <span>
                  <span className="block font-semibold">{m.refundDestination[d]}</span>
                  <span className="text-text-muted">{d === 'wallet' ? m.matchDetail.destWallet : m.matchDetail.destOriginal}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {destination === 'wallet' && (
          <Field label={m.matchDetail.bonus} hint={m.matchDetail.bonusHint}>
            <input type="number" className="field w-32" min={0} max={100} value={bonus} onChange={(e) => setBonus(Math.max(0, Math.min(100, Number(e.target.value))))} />
          </Field>
        )}
        {cancel.error ? <ErrorBox error={cancel.error} /> : null}
      </div>
    </Modal>
  );
}
