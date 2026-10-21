import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { SIGNING_KEYS, type SigningKeys } from '../config/keys';
import { AppError } from '../common/errors';
import type { Locale } from '../common/i18n';
import { verifyCompact } from '../common/jwt';
import { money } from '../common/money';
import { emit } from '../common/outbox';
import { DB, type Db, iso, one, pgError, PG, rows, type Tx } from '../db/db';
import { MATCH_JOINS, MATCH_SUMMARY_COLUMNS, type MatchSummaryRow, toMatchSummary } from '../matches/matches.service';

interface AssignmentRow {
  id: string;
  match_id: string;
  host_user_id: string;
  status: string;
  fee_amount: number;
  currency: string;
  offer_expires_at: string;
  expired: boolean;
}

export interface CheckinEventInput {
  client_event_id: string;
  action: 'check_in' | 'undo' | 'no_show';
  method: 'qr' | 'manual';
  qr_payload?: string;
  participant_id?: string;
  occurred_at: string;
  location?: { lat: number; lng: number };
}

const ACTIVE = sql`('accepted', 'arrived')`;

@Injectable()
export class HostService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(SIGNING_KEYS) private readonly keys: SigningKeys,
  ) {}

  private async requireHost(userId: string) {
    const h = await one(this.db, sql`SELECT 1 FROM host_profiles WHERE user_id = ${userId} AND status = 'active'`);
    if (!h) throw new AppError('FORBIDDEN');
  }

  /** Host shu match'ga tayinlanganmi (accepted/arrived; complete uchun — completed ham). */
  private async requireAssigned(userId: string, matchId: string, ex: Db | Tx = this.db, statuses = ACTIVE) {
    const a = await one<{ id: string; status: string }>(
      ex,
      sql`SELECT id, status FROM host_assignments
          WHERE match_id = ${matchId} AND host_user_id = ${userId} AND status IN ${statuses}`,
    );
    if (!a) throw new AppError('FORBIDDEN');
    return a;
  }

  private async summary(matchId: string, locale: Locale) {
    const m = await one<MatchSummaryRow>(this.db, sql`SELECT ${MATCH_SUMMARY_COLUMNS} FROM matches m ${MATCH_JOINS} WHERE m.id = ${matchId}`);
    if (!m) throw new AppError('NOT_FOUND');
    return toMatchSummary(m, locale);
  }

  async offers(userId: string, locale: Locale) {
    await this.requireHost(userId);
    const list = await rows<AssignmentRow & { distance_m: number }>(
      this.db,
      sql`SELECT ha.*, ha.offer_expires_at < now() AS expired, ST_Distance(hp.base_location, m.location) AS distance_m
          FROM host_assignments ha
          JOIN host_profiles hp ON hp.user_id = ha.host_user_id
          JOIN matches m ON m.id = ha.match_id
          WHERE ha.host_user_id = ${userId} AND ha.status = 'offered' AND ha.offer_expires_at > now()
          ORDER BY m.starts_at`,
    );
    return Promise.all(
      list.map(async (a) => ({
        assignment_id: a.id,
        offer_expires_at: iso(a.offer_expires_at),
        fee: money(a.fee_amount, a.currency, locale),
        distance_m: a.distance_m === null ? null : Math.round(Number(a.distance_m)),
        kit_required: true,
        match: await this.summary(a.match_id, locale),
      })),
    );
  }

  private async hostMatch(assignmentId: string, locale: Locale) {
    const a = await one<AssignmentRow & { checked_in: number; partner_phone: string | null }>(
      this.db,
      sql`SELECT ha.*, false AS expired,
                 (SELECT count(*)::int FROM match_participants mp WHERE mp.match_id = ha.match_id AND mp.status = 'checked_in') AS checked_in,
                 v.partner_phone
          FROM host_assignments ha
          JOIN matches m ON m.id = ha.match_id JOIN pitches p ON p.id = m.pitch_id JOIN venues v ON v.id = p.venue_id
          WHERE ha.id = ${assignmentId}`,
    );
    return {
      assignment_id: a!.id,
      assignment_status: a!.status,
      fee: money(a!.fee_amount, a!.currency, locale),
      match: await this.summary(a!.match_id, locale),
      checked_in_count: a!.checked_in,
      venue_contact: a!.partner_phone,
    };
  }

  /** Birinchi accept yutadi: partial unique index (match_id) faol statuslar uchun. */
  async accept(userId: string, assignmentId: string, locale: Locale) {
    await this.requireHost(userId);
    try {
      await this.db.transaction(async (tx) => {
        const a = await one<AssignmentRow>(
          tx,
          sql`SELECT ha.*, ha.offer_expires_at < now() AS expired FROM host_assignments ha
              WHERE ha.id = ${assignmentId} AND ha.host_user_id = ${userId} FOR UPDATE`,
        );
        if (!a) throw new AppError('NOT_FOUND');
        if (a.status === 'accepted') return;
        if (a.status !== 'offered') throw new AppError(a.status === 'expired' ? 'OFFER_EXPIRED' : 'OFFER_TAKEN');
        if (a.expired) throw new AppError('OFFER_EXPIRED');

        const conflict = await one(
          tx,
          sql`SELECT 1 FROM host_assignments ha
              JOIN matches om ON om.id = ha.match_id
              JOIN matches m ON m.id = ${a.match_id}
              WHERE ha.host_user_id = ${userId} AND ha.status IN ${ACTIVE} AND ha.match_id <> m.id
                AND tstzrange(om.starts_at - interval '1 hour', om.ends_at + interval '1 hour') && tstzrange(m.starts_at, m.ends_at)`,
        );
        if (conflict) throw new AppError('SCHEDULE_CONFLICT');

        await tx.execute(sql`UPDATE host_assignments SET status = 'accepted', responded_at = now() WHERE id = ${a.id}`);
        await tx.execute(
          sql`UPDATE host_assignments SET status = 'expired' WHERE match_id = ${a.match_id} AND status = 'offered' AND id <> ${a.id}`,
        );
        await emit(tx, 'match', a.match_id, 'HostAssigned', { host_user_id: userId, assignment_id: a.id });
      });
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) throw new AppError('OFFER_TAKEN');
      throw err;
    }
    return this.hostMatch(assignmentId, locale);
  }

  async decline(userId: string, assignmentId: string, reason?: string) {
    await this.requireHost(userId);
    const r = await this.db.execute(
      sql`UPDATE host_assignments SET status = 'declined', responded_at = now(), decline_reason = ${reason ?? null}
          WHERE id = ${assignmentId} AND host_user_id = ${userId} AND status = 'offered'`,
    );
    if (!r.rowCount) throw new AppError('INVALID_STATE');
  }

  async matches(userId: string, scope: 'today' | 'upcoming' | 'past', locale: Locale) {
    await this.requireHost(userId);
    const cond =
      scope === 'past'
        ? sql`(ha.status = 'completed' OR m.ends_at <= now())`
        : scope === 'today'
          ? sql`ha.status IN ('accepted', 'arrived') AND (m.starts_at AT TIME ZONE m_tz.tz)::date = (now() AT TIME ZONE m_tz.tz)::date`
          : sql`ha.status IN ('accepted', 'arrived') AND m.ends_at > now()`;
    const list = await rows<{ id: string }>(
      this.db,
      sql`SELECT ha.id FROM host_assignments ha
          JOIN matches m ON m.id = ha.match_id
          JOIN LATERAL (SELECT v.timezone AS tz FROM pitches p JOIN venues v ON v.id = p.venue_id WHERE p.id = m.pitch_id) m_tz ON true
          WHERE ha.host_user_id = ${userId} AND ha.status IN ('accepted', 'arrived', 'completed') AND ${cond}
          ORDER BY m.starts_at ${scope === 'past' ? sql`DESC` : sql`ASC`}
          LIMIT 50`,
    );
    return Promise.all(list.map((a) => this.hostMatch(a.id, locale)));
  }

  async roster(userId: string, matchId: string, locale: Locale) {
    await this.requireAssigned(userId, matchId, this.db, sql`('accepted', 'arrived', 'completed')`);
    const sides = await rows<{ side_no: number; label: string; bib_color: string | null }>(
      this.db,
      sql`SELECT side_no, label, bib_color FROM match_sides WHERE match_id = ${matchId} ORDER BY side_no`,
    );
    const participants = await rows<{
      id: string;
      name: string;
      is_guest: boolean;
      level: string | null;
      side_no: number | null;
      bib_number: number | null;
      status: string;
      checked_in_at: string | null;
    }>(
      this.db,
      sql`SELECT mp.id, coalesce(u.display_name, mp.guest_name) AS name, mp.user_id IS NULL AS is_guest,
                 psp.self_level AS level, mp.side_no, mp.bib_number, mp.status, mp.checked_in_at
          FROM match_participants mp
          JOIN matches m ON m.id = mp.match_id
          LEFT JOIN users u ON u.id = mp.user_id
          LEFT JOIN player_sport_profiles psp ON psp.user_id = mp.user_id AND psp.sport_id = m.sport_id
          WHERE mp.match_id = ${matchId} AND mp.status IN ('confirmed', 'checked_in', 'no_show')
          ORDER BY mp.created_at`,
    );
    const version = await one<{ v: number }>(
      this.db,
      sql`SELECT (SELECT count(*)::int FROM checkin_events WHERE match_id = ${matchId})
               + (SELECT count(*)::int FROM match_participants WHERE match_id = ${matchId}) AS v`,
    );
    return {
      match: await this.summary(matchId, locale),
      roster_version: version!.v,
      qr_public_key: this.keys.ticket.publicKeyRaw,
      sides,
      participants: participants.map((p) => ({
        participant_id: p.id,
        display_name: p.name,
        avatar_url: null,
        is_guest: p.is_guest,
        level: p.level,
        side_no: p.side_no,
        bib_number: p.bib_number,
        status: p.status,
        checked_in_at: iso(p.checked_in_at),
      })),
    };
  }

  async arrive(userId: string, matchId: string, loc: { lat: number; lng: number }) {
    const a = await this.requireAssigned(userId, matchId);
    const d = await one<{ distance_m: number }>(
      this.db,
      sql`SELECT ST_Distance(v.location, ST_SetSRID(ST_MakePoint(${loc.lng}, ${loc.lat}), 4326)::geography) AS distance_m
          FROM matches m JOIN pitches p ON p.id = m.pitch_id JOIN venues v ON v.id = p.venue_id WHERE m.id = ${matchId}`,
    );
    const distance = Math.round(Number(d!.distance_m));
    if (distance > this.env.GEOFENCE_METERS) throw new AppError('OUTSIDE_GEOFENCE', { distance_m: distance });
    const r = await one<{ arrived_at: string }>(
      this.db,
      sql`UPDATE host_assignments
             SET status = 'arrived', arrived_at = coalesce(arrived_at, now()),
                 arrival_location = ST_SetSRID(ST_MakePoint(${loc.lng}, ${loc.lat}), 4326)::geography,
                 arrival_distance_m = ${distance}
           WHERE id = ${a.id}
           RETURNING arrived_at`,
    );
    await emit(this.db, 'match', matchId, 'HostArrived', { host_user_id: userId, distance_m: distance });
    return { arrived_at: iso(r!.arrived_at), distance_m: distance };
  }

  /** Offline sync: har event alohida tranzaksiyada, client_event_id bo'yicha idempotent. */
  async checkins(userId: string, matchId: string, events: CheckinEventInput[]) {
    const assignment = await this.requireAssigned(userId, matchId);
    const results = [];
    for (const e of events) {
      results.push(await this.applyCheckin(userId, matchId, assignment.id, e));
    }
    const version = await one<{ v: number }>(
      this.db,
      sql`SELECT (SELECT count(*)::int FROM checkin_events WHERE match_id = ${matchId})
               + (SELECT count(*)::int FROM match_participants WHERE match_id = ${matchId}) AS v`,
    );
    return { results, roster_version: version!.v };
  }

  private async applyCheckin(userId: string, matchId: string, assignmentId: string, e: CheckinEventInput) {
    const dup = await one<{ participant_id: string }>(
      this.db,
      sql`SELECT participant_id FROM checkin_events WHERE client_event_id = ${e.client_event_id}`,
    );
    if (dup) return { client_event_id: e.client_event_id, status: 'duplicate', reason: null, participant_id: dup.participant_id };

    let participantId = e.participant_id;
    if (e.method === 'qr') {
      const t = e.qr_payload ? verifyCompact<{ p: string; m: string; e: number }>('mu1', e.qr_payload, this.keys.ticket.publicKey) : undefined;
      if (!t) return { client_event_id: e.client_event_id, status: 'rejected', reason: 'INVALID_SIGNATURE', participant_id: null };
      if (t.m !== matchId) return { client_event_id: e.client_event_id, status: 'rejected', reason: 'NOT_ON_ROSTER', participant_id: null };
      if (t.e * 1000 < Date.now()) return { client_event_id: e.client_event_id, status: 'rejected', reason: 'TICKET_EXPIRED', participant_id: null };
      participantId = t.p;
    }
    if (!participantId) return { client_event_id: e.client_event_id, status: 'rejected', reason: 'PARTICIPANT_REQUIRED', participant_id: null };

    try {
      return await this.db.transaction(async (tx) => {
        const p = await one<{ id: string; status: string }>(
          tx,
          sql`SELECT id, status FROM match_participants
              WHERE id = ${participantId} AND match_id = ${matchId} AND status IN ('confirmed', 'checked_in', 'no_show')
              FOR UPDATE`,
        );
        if (!p) return { client_event_id: e.client_event_id, status: 'rejected', reason: 'NOT_ON_ROSTER', participant_id: null };

        if (e.action === 'check_in') {
          await tx.execute(
            sql`UPDATE match_participants SET status = 'checked_in', checked_in_at = coalesce(checked_in_at, ${e.occurred_at}::timestamptz),
                       checked_in_by = ${userId} WHERE id = ${p.id}`,
          );
        } else if (e.action === 'undo') {
          await tx.execute(sql`UPDATE match_participants SET status = 'confirmed', checked_in_at = NULL, checked_in_by = NULL WHERE id = ${p.id}`);
        } else {
          await tx.execute(sql`UPDATE match_participants SET status = 'no_show' WHERE id = ${p.id}`);
        }
        const loc = e.location
          ? sql`ST_SetSRID(ST_MakePoint(${e.location.lng}, ${e.location.lat}), 4326)::geography`
          : sql`NULL`;
        await tx.execute(
          sql`INSERT INTO checkin_events (match_id, participant_id, host_assignment_id, actor_user_id, action, method,
                                          client_event_id, occurred_at, device_location)
              VALUES (${matchId}, ${p.id}, ${assignmentId}, ${userId}, ${e.action}, ${e.method}, ${e.client_event_id},
                      ${e.occurred_at}::timestamptz, ${loc})`,
        );
        if (e.action === 'check_in') await emit(tx, 'match', matchId, 'PlayerCheckedIn', { participant_id: p.id });
        return { client_event_id: e.client_event_id, status: 'accepted', reason: null, participant_id: p.id };
      });
    } catch (err) {
      if (pgError(err)?.code === PG.UNIQUE_VIOLATION) {
        return { client_event_id: e.client_event_id, status: 'duplicate', reason: null, participant_id: participantId };
      }
      throw err;
    }
  }

  async updateParticipant(
    userId: string,
    matchId: string,
    participantId: string,
    body: { side_no?: number; status?: 'checked_in' | 'no_show'; bib_number?: number | null },
  ) {
    await this.requireAssigned(userId, matchId);
    try {
      const r = await one<{ id: string }>(
        this.db,
        sql`UPDATE match_participants
               SET side_no = coalesce(${body.side_no ?? null}::smallint, side_no),
                   bib_number = CASE WHEN ${body.bib_number !== undefined}::boolean THEN ${body.bib_number ?? null}::smallint ELSE bib_number END,
                   status = coalesce(${body.status ?? null}::participant_status, status),
                   checked_in_at = CASE WHEN ${body.status ?? null} = 'checked_in' THEN coalesce(checked_in_at, now()) ELSE checked_in_at END,
                   checked_in_by = CASE WHEN ${body.status ?? null} = 'checked_in' THEN ${userId}::uuid ELSE checked_in_by END
             WHERE id = ${participantId} AND match_id = ${matchId} AND status IN ('confirmed', 'checked_in', 'no_show')
             RETURNING id`,
      );
      if (!r) throw new AppError('NOT_FOUND');
    } catch (err) {
      if (pgError(err)?.code === PG.FOREIGN_KEY_VIOLATION) throw new AppError('VALIDATION_FAILED', {}, [{ field: 'side_no', code: 'invalid', message: 'side_no mavjud emas' }]);
      if (pgError(err)?.constraint === 'match_participants_bib_unique') throw new AppError('BIB_TAKEN', { bib_number: body.bib_number ?? 0 });
      throw err;
    }
    return (await this.roster(userId, matchId, 'uz-Latn')).participants.find((p) => p.participant_id === participantId);
  }

  /** O'yinni yakunlash: hisob, no-show, statistika, booking'lar completed. */
  async complete(
    userId: string,
    matchId: string,
    body: { scores: { side_no: number; score: number }[]; mvp_participant_id?: string | null; incidents?: unknown[] },
    locale: Locale,
  ) {
    const a = await this.requireAssigned(userId, matchId);
    await this.db.transaction(async (tx) => {
      const m = await one<{ status: string; started: boolean; sport_id: number }>(
        tx,
        sql`SELECT status, starts_at <= now() AS started, sport_id FROM matches WHERE id = ${matchId} FOR UPDATE`,
      );
      if (!m || !['open', 'full', 'in_progress'].includes(m.status) || !m.started) throw new AppError('INVALID_STATE');
      for (const s of body.scores) {
        await tx.execute(sql`UPDATE match_sides SET score = ${s.score} WHERE match_id = ${matchId} AND side_no = ${s.side_no}`);
      }
      // Check-in qilinmagan confirmed o'yinchilar — no-show
      await tx.execute(sql`UPDATE match_participants SET status = 'no_show' WHERE match_id = ${matchId} AND status = 'confirmed'`);
      await tx.execute(
        sql`INSERT INTO player_sport_profiles (user_id, sport_id, games_played, no_show_count)
            SELECT mp.user_id, ${m.sport_id}, (mp.status = 'checked_in')::int, (mp.status = 'no_show')::int
            FROM match_participants mp
            WHERE mp.match_id = ${matchId} AND mp.user_id IS NOT NULL AND mp.status IN ('checked_in', 'no_show')
            ON CONFLICT (user_id, sport_id) DO UPDATE
              SET games_played = player_sport_profiles.games_played + EXCLUDED.games_played,
                  no_show_count = player_sport_profiles.no_show_count + EXCLUDED.no_show_count,
                  updated_at = now()`,
      );
      await tx.execute(sql`UPDATE bookings SET status = 'completed' WHERE match_id = ${matchId} AND status = 'confirmed'`);
      await tx.execute(sql`UPDATE matches SET status = 'completed', completed_at = now() WHERE id = ${matchId}`);
      await tx.execute(sql`UPDATE host_assignments SET status = 'completed', completed_at = now() WHERE id = ${a.id}`);
      await tx.execute(sql`UPDATE host_profiles SET completed_matches = completed_matches + 1 WHERE user_id = ${userId}`);
      await emit(tx, 'match', matchId, 'MatchCompleted', {
        scores: body.scores,
        mvp_participant_id: body.mvp_participant_id ?? null,
        incidents: body.incidents ?? [],
      });
    });
    return this.hostMatch(a.id, locale);
  }
}

/** Host dispatch: to'lgan yoki T-12h da minimumga yetgan match'larga offer yuborish. */
@Injectable()
export class DispatchService {
  private readonly log = new Logger('Dispatch');
  static readonly OFFER_MINUTES = 10;
  static readonly WAVE_SIZE = 3;

  constructor(@Inject(DB) private readonly db: Db) {}

  async run(): Promise<{ expired: number; offered: number }> {
    const expired = await this.db.execute(
      sql`UPDATE host_assignments SET status = 'expired' WHERE status = 'offered' AND offer_expires_at < now()`,
    );
    const needing = await rows<{ id: string; host_fee_amount: number; currency: string; round: number }>(
      this.db,
      sql`SELECT m.id, m.host_fee_amount, m.currency,
                 coalesce((SELECT max(dispatch_round) FROM host_assignments WHERE match_id = m.id), 0) + 1 AS round
          FROM matches m
          WHERE m.status IN ('open', 'full') AND m.starts_at > now()
            AND (m.status = 'full' OR (m.confirmed_slots >= m.min_players AND m.starts_at <= now() + interval '12 hours'))
            AND NOT EXISTS (SELECT 1 FROM host_assignments ha
                            WHERE ha.match_id = m.id AND ha.status IN ('offered', 'accepted', 'arrived', 'completed'))
          ORDER BY m.starts_at
          LIMIT 100`,
    );
    let offered = 0;
    for (const m of needing) {
      // db/queries/dispatch_candidates.sql
      const candidates = await rows<{ user_id: string }>(
        this.db,
        sql`SELECT hp.user_id
            FROM matches m
            JOIN host_profiles hp ON hp.status = 'active' AND hp.home_city_id = m.city_id
            JOIN host_sports hs ON hs.user_id = hp.user_id AND hs.sport_id = m.sport_id
            WHERE m.id = ${m.id}
              AND ST_DWithin(hp.base_location, m.location, hp.max_travel_km * 1000)
              AND NOT EXISTS (SELECT 1 FROM host_assignments ha JOIN matches om ON om.id = ha.match_id
                              WHERE ha.host_user_id = hp.user_id AND ha.status IN ('accepted', 'arrived')
                                AND tstzrange(om.starts_at - interval '1 hour', om.ends_at + interval '1 hour')
                                    && tstzrange(m.starts_at, m.ends_at))
              AND NOT EXISTS (SELECT 1 FROM host_assignments ha WHERE ha.match_id = m.id AND ha.host_user_id = hp.user_id)
            ORDER BY hp.has_kit DESC, ST_Distance(hp.base_location, m.location), hp.rating_avg DESC NULLS LAST
            LIMIT ${DispatchService.WAVE_SIZE}`,
      );
      if (!candidates.length) {
        this.log.warn(`Host topilmadi: match ${m.id} (round ${m.round})`);
        continue;
      }
      for (const c of candidates) {
        await this.db.execute(
          sql`INSERT INTO host_assignments (match_id, host_user_id, status, dispatch_round, fee_amount, currency, offer_expires_at)
              VALUES (${m.id}, ${c.user_id}, 'offered', ${m.round}, ${m.host_fee_amount}, ${m.currency},
                      now() + make_interval(mins => ${DispatchService.OFFER_MINUTES}))
              ON CONFLICT (match_id, host_user_id) DO NOTHING`,
        );
        await emit(this.db, 'match', m.id, 'HostOffered', { host_user_id: c.user_id, round: m.round });
        offered++;
      }
    }
    return { expired: expired.rowCount ?? 0, offered };
  }
}
