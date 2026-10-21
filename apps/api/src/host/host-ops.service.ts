import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { audit } from '../admin/audit';
import { ENV, type Env } from '../config/env';
import { tr } from '../common/i18n';
import { OpsAlerts } from '../common/ops-alerts';
import { DB, type Db, iso, rows } from '../db/db';
import { pgUuidArray } from '../notifications/notifications.service';
import { formatTime } from '../notifications/templates';

interface NoShowRow {
  assignment_id: string;
  match_id: string;
  public_code: string;
  title: unknown;
  sport_name: unknown;
  format: string;
  starts_at: string;
  minutes_left: number;
  venue_name: string;
  timezone: string;
  host_name: string;
}

/**
 * Host no-show: kick-off − HOST_NO_SHOW_ALERT_MIN da tayinlangan host hali `arrived` emas -> ops guruhiga
 * ogohlantirish (har tayinlov uchun bir marta). Avtomatik hech narsa o'zgarmaydi — admin host bilan bog'lanadi
 * yoki boshqa host topadi. Job to'xtab qolgan bo'lsa ham o'yin tugaguncha ogohlantiradi.
 */
@Injectable()
export class HostNoShowAlerts {
  private readonly log = new Logger('HostNoShow');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly ops: OpsAlerts,
  ) {}

  async run(): Promise<{ alerted: number; failed: number }> {
    // Avval belgilanadi (parallel instance ikkinchi marta yubormaydi), xato bo'lsa — qaytariladi
    const due = await rows<NoShowRow>(
      this.db,
      sql`UPDATE host_assignments ha SET no_show_alerted_at = now()
          FROM matches m
          JOIN sports s ON s.id = m.sport_id
          JOIN pitches p ON p.id = m.pitch_id
          JOIN venues v ON v.id = p.venue_id
          CROSS JOIN users u
          WHERE ha.match_id = m.id AND u.id = ha.host_user_id AND ha.status = 'accepted' AND ha.no_show_alerted_at IS NULL
            AND m.status IN ('open', 'full', 'in_progress')
            AND m.starts_at <= now() + make_interval(mins => ${this.env.HOST_NO_SHOW_ALERT_MIN}) AND m.ends_at > now()
          RETURNING ha.id AS assignment_id, m.id AS match_id, m.public_code, m.title, s.name AS sport_name, m.format,
                    m.starts_at, ceil(extract(epoch FROM m.starts_at - now()) / 60)::int AS minutes_left,
                    v.name AS venue_name, v.timezone, u.display_name AS host_name`,
    );
    let alerted = 0;
    let failed = 0;
    for (const a of due) {
      try {
        const delivered = await this.ops.send(this.text(a));
        await audit(this.db, null, 'host.no_show_alert', 'match', a.match_id, {
          assignment_id: a.assignment_id,
          minutes_left: a.minutes_left,
          delivered,
        });
        alerted++;
      } catch (err) {
        failed++;
        this.log.error(`ogohlantirish yuborilmadi (${a.public_code}): ${(err as Error).message}`);
        await this.db.execute(sql`UPDATE host_assignments SET no_show_alerted_at = NULL WHERE id = ${a.assignment_id}`);
      }
    }
    return { alerted, failed };
  }

  private text(a: NoShowRow): string {
    const title = tr(a.title, 'uz-Latn') || `${tr(a.sport_name, 'uz-Latn')} ${a.format}`;
    const when =
      a.minutes_left > 0 ? `${a.minutes_left} daqiqa qoldi` : `o'yin ${-a.minutes_left} daqiqa oldin boshlangan`;
    const link = this.ops.adminLink(`/matches/${a.match_id}`);
    return [
      '⚠️ Host hali yetib kelmadi',
      `${a.public_code} · ${title}`,
      `${a.venue_name}, ${formatTime(new Date(iso(a.starts_at)!), a.timezone)} (${when})`,
      `Host: ${a.host_name}`,
      ...(link ? [link] : []),
    ].join('\n');
  }
}

/** To'lov davri (dushanba–yakshanba) — O'zbekiston vaqti; boshqa mamlakatlar alohida cell'da. */
const PAYOUT_TZ = 'Asia/Tashkent';

/**
 * Haftalik host payout: oldingi hafta oxirigacha bajarilgan va hali payout'ga kirmagan tayinlovlar
 * (kechikib yakunlangan oldingi haftalar ham) -> host + valyuta bo'yicha `host_payouts` (pending), tayinlovlarga
 * `payout_id`. To'lovning o'zi — admin panelda (keyingi PR). Qayta ishga tushirish xavfsiz: bog'langan
 * tayinlovlar qayta olinmaydi, shu davrning hali to'lanmagan payout'iga qo'shiladi.
 */
@Injectable()
export class HostPayouts {
  private readonly log = new Logger('HostPayouts');

  constructor(@Inject(DB) private readonly db: Db) {}

  async run(): Promise<{ period_start: string; period_end: string; payouts: number; assignments: number }> {
    return this.db.transaction(async (tx) => {
      const [period] = await rows<{ start: string; end: string }>(
        tx,
        sql`SELECT (date_trunc('week', now() AT TIME ZONE ${PAYOUT_TZ})::date - 7)::text AS start,
                   (date_trunc('week', now() AT TIME ZONE ${PAYOUT_TZ})::date - 1)::text AS end`,
      );
      const { start, end } = period!;
      const unpaid = await rows<{ id: string; host_user_id: string; currency: string; fee_amount: number }>(
        tx,
        sql`SELECT id, host_user_id, currency, fee_amount FROM host_assignments
            WHERE status = 'completed' AND payout_id IS NULL
              AND completed_at < ((${end}::date + 1)::timestamp AT TIME ZONE ${PAYOUT_TZ})
            ORDER BY host_user_id, id
            FOR UPDATE SKIP LOCKED`,
      );
      const groups = new Map<string, { host: string; currency: string; ids: string[]; amount: number }>();
      for (const a of unpaid) {
        const key = `${a.host_user_id}:${a.currency}`;
        const g = groups.get(key) ?? { host: a.host_user_id, currency: a.currency, ids: [], amount: 0 };
        g.ids.push(a.id);
        g.amount += Number(a.fee_amount);
        groups.set(key, g);
      }

      let payouts = 0;
      let linked = 0;
      for (const g of groups.values()) {
        const [p] = await rows<{ id: string }>(
          tx,
          sql`INSERT INTO host_payouts (host_user_id, period_start, period_end, amount, currency, assignments_count)
              VALUES (${g.host}, ${start}, ${end}, ${g.amount}, ${g.currency}, ${g.ids.length})
              ON CONFLICT (host_user_id, period_start, period_end) DO UPDATE
                SET amount = host_payouts.amount + EXCLUDED.amount,
                    assignments_count = host_payouts.assignments_count + EXCLUDED.assignments_count
                WHERE host_payouts.status = 'pending' AND host_payouts.currency = EXCLUDED.currency
              RETURNING id`,
        );
        if (!p) {
          // Shu davr payout'i to'langan yoki boshqa valyutada — keyingi haftaga qoladi
          this.log.warn(`host ${g.host}: ${start}..${end} payout'iga qo'shib bo'lmadi (${g.ids.length} ta tayinlov)`);
          continue;
        }
        await tx.execute(sql`UPDATE host_assignments SET payout_id = ${p.id} WHERE id = ANY(${pgUuidArray(g.ids)})`);
        payouts++;
        linked += g.ids.length;
      }
      if (payouts) {
        await audit(tx, null, 'host.payouts', 'host_payout', null, { period_start: start, period_end: end, payouts, assignments: linked });
        this.log.log(`${start}..${end}: ${payouts} ta payout, ${linked} ta tayinlov`);
      }
      return { period_start: start, period_end: end, payouts, assignments: linked };
    });
  }
}
