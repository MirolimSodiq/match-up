import { createHash } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { AppError } from '../common/errors';
import { emit } from '../common/outbox';
import { DB, type Db, type Executor, iso, one, rows } from '../db/db';
import { MediaExport } from './media-export';
import { FILE_STORAGE, type FileStorage } from './storage';

export const EXPORT_FORMAT = 'matchup.personal-data-export';
export const EXPORT_VERSION = 2;

/**
 * GDPR Art. 15/20: foydalanuvchining barcha shaxsiy ma'lumotlari bitta JSON faylda; videolar (`media`) —
 * fayl bilan birga tugaydigan imzolangan havolalar (MediaExport). Versiya 2 — `media` bo'limi qo'shildi.
 * To'lovlardan faqat summa, provider, holat va sanalar — provider_state, checkout URL va tranzaksiya
 * identifikatorlari chiqarilmaydi (karta ma'lumotlari Match Up'da umuman saqlanmaydi).
 */
@Injectable()
export class DataExportService {
  private readonly log = new Logger('DataExport');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly media: MediaExport,
  ) {}

  /** Navbatdagi eksport so'rovlari + muddati o'tgan fayllarni tozalash (BullMQ `dsr-exports`). */
  async run(limit = 20): Promise<{ exported: number; expired: number }> {
    const due = await rows<{ id: string }>(
      this.db,
      sql`SELECT id FROM data_subject_requests
          WHERE type = 'export' AND status IN ('received', 'in_progress')
          ORDER BY requested_at LIMIT ${limit}`,
    );
    let exported = 0;
    for (const { id } of due) {
      try {
        if (await this.exportOne(id)) exported++;
      } catch (err) {
        // Keyingi ishga tushishda qayta urinadi; boshqa so'rovlarni to'xtatmaydi
        this.log.error(`Eksport ${id} bajarilmadi: ${(err as Error).message}`);
      }
    }
    return { exported, expired: await this.cleanupExpired() };
  }

  /**
   * Bitta so'rov: yig'ish, faylga yozish va `completed` + DataExportReady — bitta tranzaksiyada
   * (REPEATABLE READ: barcha bo'limlar bitta snapshot'dan o'qiladi).
   */
  async exportOne(requestId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const r = await one<{ id: string; user_id: string; erased: boolean }>(
        tx,
        sql`SELECT d.id, d.user_id, u.anonymized_at IS NOT NULL AS erased
            FROM data_subject_requests d JOIN users u ON u.id = d.user_id
            WHERE d.id = ${requestId} AND d.type = 'export' AND d.status IN ('received', 'in_progress')
            FOR UPDATE OF d SKIP LOCKED`,
      );
      if (!r) return false;
      if (r.erased) {
        await tx.execute(
          sql`UPDATE data_subject_requests SET status = 'rejected', completed_at = now(), notes = 'user_erased' WHERE id = ${r.id}`,
        );
        return false;
      }
      // Fayl muddati oldindan: media havolalari aynan shu vaqtgacha imzolanadi
      const expiresAt = new Date(Date.now() + this.env.DATA_EXPORT_TTL_HOURS * 3_600_000);
      const doc = await this.build(tx, r.user_id, r.id, expiresAt);
      const body = Buffer.from(JSON.stringify(doc, null, 2));
      const key = `exports/${r.user_id}/${r.id}.json`;
      await this.storage.put(key, body);
      const done = await one<{ export_expires_at: string }>(
        tx,
        sql`UPDATE data_subject_requests
               SET status = 'completed', completed_at = now(), export_path = ${key},
                   export_sha256 = ${createHash('sha256').update(body).digest()}, export_size_bytes = ${body.length},
                   export_expires_at = ${expiresAt.toISOString()}::timestamptz
             WHERE id = ${r.id}
             RETURNING export_expires_at`,
      );
      await emit(tx, 'user', r.user_id, 'DataExportReady', {
        request_id: r.id,
        user_id: r.user_id,
        expires_at: iso(done!.export_expires_at),
      });
      return true;
    }, { isolationLevel: 'repeatable read' });
  }

  /** Yuklab olish havolasi muddati o'tgan fayllar o'chiriladi (so'rov yozuvi qoladi). */
  async cleanupExpired(limit = 200): Promise<number> {
    const expired = await rows<{ id: string; export_path: string }>(
      this.db,
      sql`SELECT id, export_path FROM data_subject_requests
          WHERE export_path IS NOT NULL AND export_expires_at <= now()
          ORDER BY export_expires_at LIMIT ${limit}`,
    );
    for (const e of expired) {
      await this.storage.remove(e.export_path);
      await this.db.execute(sql`UPDATE data_subject_requests SET export_path = NULL WHERE id = ${e.id}`);
    }
    return expired.length;
  }

  /** Faqat egasi va faqat muddat ichida. */
  async download(userId: string, requestId: string): Promise<{ stream: ReadStream; filename: string; size: number }> {
    const r = await one<{ status: string; export_path: string | null; export_size_bytes: number | null; expired: boolean; completed_at: string | null }>(
      this.db,
      sql`SELECT status, export_path, export_size_bytes, export_expires_at <= now() AS expired, completed_at
          FROM data_subject_requests WHERE id = ${requestId} AND user_id = ${userId} AND type = 'export'`,
    );
    if (!r) throw new AppError('NOT_FOUND');
    if (r.status !== 'completed') throw new AppError('EXPORT_NOT_READY');
    if (!r.export_path || r.expired) throw new AppError('EXPORT_EXPIRED');
    const date = (iso(r.completed_at) ?? new Date().toISOString()).slice(0, 10);
    return { stream: this.storage.open(r.export_path), filename: `matchup-data-${date}.json`, size: Number(r.export_size_bytes) };
  }

  // -------------------------------------------------------------------------
  // Hujjat
  // -------------------------------------------------------------------------
  private async list(ex: Executor, query: SQL, orderBy: SQL): Promise<unknown[]> {
    const r = await one<{ v: unknown[] }>(
      ex,
      sql`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY ${orderBy}), '[]'::jsonb) AS v FROM (${query}) x`,
    );
    return r?.v ?? [];
  }

  private async object(ex: Executor, query: SQL): Promise<Record<string, unknown> | null> {
    const r = await one<{ v: Record<string, unknown> | null }>(ex, sql`SELECT to_jsonb(x) AS v FROM (${query}) x`);
    return r?.v ?? null;
  }

  async build(ex: Executor, userId: string, requestId: string, expiresAt: Date): Promise<Record<string, unknown>> {
    const id = userId;
    const hostProfile = await this.object(
      ex,
      sql`SELECT h.status, c.slug AS home_city, h.max_travel_km, h.has_kit, h.kit_notes, h.rating_avg, h.rating_count,
                 h.completed_matches, h.no_show_count, h.payout_method, h.verified_at, h.suspended_at, h.created_at
          FROM host_profiles h JOIN cities c ON c.id = h.home_city_id WHERE h.user_id = ${id}`,
    );
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      generated_at: new Date().toISOString(),
      request_id: requestId,
      notes: [
        "Karta ma'lumotlari Match Up'da saqlanmaydi: to'lov Payme/Click sahifasida kiritiladi.",
        'Vaqtlar UTC (ISO 8601). Pul summalari minor units\'da (UZS: tiyin, 45 000 so\'m = 4500000).',
      ],
      profile: await this.object(
        ex,
        sql`SELECT u.id, u.phone_e164 AS phone, u.email::text AS email, u.display_name, u.first_name, u.last_name,
                   u.birth_date, u.gender, u.locale, u.country_code, c.slug AS home_city, u.data_region, u.status,
                   u.onboarded_at, u.last_seen_at, u.created_at, u.updated_at
            FROM users u LEFT JOIN cities c ON c.id = u.home_city_id WHERE u.id = ${id}`,
      ),
      roles: await this.list(ex, sql`SELECT role, granted_at FROM user_roles WHERE user_id = ${id}`, sql`x.granted_at`),
      identities: await this.list(
        ex,
        sql`SELECT provider, provider_uid, display_label AS label, created_at, last_used_at FROM auth_identities WHERE user_id = ${id}`,
        sql`x.created_at`,
      ),
      sport_profiles: await this.list(
        ex,
        sql`SELECT s.code AS sport, p.self_level, p.rating, p.games_played, p.no_show_count, p.preferred_position, p.updated_at
            FROM player_sport_profiles p JOIN sports s ON s.id = p.sport_id WHERE p.user_id = ${id}`,
        sql`x.sport`,
      ),
      consents: await this.list(
        ex,
        sql`SELECT purpose, granted, document_version, source, host(ip) AS ip, user_agent, recorded_at
            FROM consents WHERE user_id = ${id}`,
        sql`x.recorded_at`,
      ),
      bookings: await this.list(
        ex,
        sql`SELECT b.id, m.public_code AS match_code, s.code AS sport, m.starts_at, m.ends_at, v.name AS venue,
                   b.seats, b.status, b.unit_price_amount, b.discount_amount, b.wallet_applied_amount, b.total_amount,
                   b.currency, b.created_at, b.confirmed_at, b.cancelled_at, b.cancel_reason,
                   (SELECT coalesce(jsonb_agg(mp.guest_name ORDER BY mp.created_at), '[]'::jsonb)
                      FROM match_participants mp WHERE mp.booking_id = b.id AND mp.guest_name IS NOT NULL) AS guests
            FROM bookings b
            JOIN matches m ON m.id = b.match_id
            JOIN sports s ON s.id = m.sport_id
            JOIN pitches pi ON pi.id = m.pitch_id
            JOIN venues v ON v.id = pi.venue_id
            WHERE b.user_id = ${id}`,
        sql`x.created_at`,
      ),
      payments: await this.list(
        ex,
        sql`SELECT id, booking_id, provider, amount, currency, status, refunded_amount, created_at, succeeded_at, cancelled_at
            FROM payments WHERE user_id = ${id}`,
        sql`x.created_at`,
      ),
      refunds: await this.list(
        ex,
        sql`SELECT r.id, r.booking_id, r.amount, r.currency, r.destination, r.status, r.reason, r.created_at, r.completed_at
            FROM refunds r JOIN bookings b ON b.id = r.booking_id WHERE b.user_id = ${id}`,
        sql`x.created_at`,
      ),
      wallet: {
        accounts: await this.list(ex, sql`SELECT currency, balance, updated_at FROM wallet_accounts WHERE user_id = ${id}`, sql`x.currency`),
        transactions: await this.list(
          ex,
          sql`SELECT t.type, t.amount, a.currency, t.balance_after, t.booking_id, t.note, t.created_at
              FROM wallet_transactions t JOIN wallet_accounts a ON a.id = t.wallet_id WHERE a.user_id = ${id}`,
          sql`x.created_at`,
        ),
      },
      waiver_signatures: await this.list(
        ex,
        sql`SELECT wt.code AS template, wt.version, wt.locale, encode(ws.document_sha256, 'hex') AS document_sha256,
                   ws.method, ws.typed_full_name, ws.signed_at, host(ws.ip) AS ip, ws.user_agent, ws.app_version, ws.device_id,
                   ws.guardian_name, ws.guardian_phone, ws.guardian_relation, m.public_code AS match_code
            FROM waiver_signatures ws
            JOIN waiver_templates wt ON wt.id = ws.template_id
            LEFT JOIN matches m ON m.id = ws.match_id
            WHERE ws.user_id = ${id}`,
        sql`x.signed_at`,
      ),
      checkins: await this.list(
        ex,
        sql`SELECT m.public_code AS match_code, ce.action, ce.method, ce.occurred_at, ce.received_at
            FROM checkin_events ce
            JOIN match_participants mp ON mp.id = ce.participant_id
            JOIN matches m ON m.id = ce.match_id
            WHERE mp.user_id = ${id}`,
        sql`x.occurred_at`,
      ),
      notifications: await this.list(
        ex,
        sql`SELECT type, channel, status, locale, payload, scheduled_for, sent_at, read_at, created_at
            FROM notifications WHERE user_id = ${id}`,
        sql`x.created_at`,
      ),
      // Har login (refresh token family) uchun eng oxirgi holat; token hash'lari chiqarilmaydi
      sessions: await this.list(
        ex,
        sql`SELECT DISTINCT ON (family_id) platform, device_id, app_version, host(ip) AS ip, user_agent,
                   created_at AS last_refreshed_at, expires_at, revoked_at, revoked_reason
            FROM user_sessions WHERE user_id = ${id}
            ORDER BY family_id, created_at DESC`,
        sql`x.last_refreshed_at`,
      ),
      devices: await this.list(
        ex,
        sql`SELECT platform, locale, app_version, created_at, disabled_at FROM device_tokens WHERE user_id = ${id}`,
        sql`x.created_at`,
      ),
      feedback_given: await this.list(
        ex,
        sql`SELECT m.public_code AS match_code, f.target, f.rating, f.tags, f.comment, f.created_at
            FROM match_feedback f JOIN matches m ON m.id = f.match_id WHERE f.from_user_id = ${id}`,
        sql`x.created_at`,
      ),
      media: await this.media.section(ex, id, expiresAt),
      highlight_tags: await this.list(
        ex,
        sql`SELECT t.highlight_id, m.public_code AS match_code, t.created_at
            FROM highlight_tags t JOIN highlights h ON h.id = t.highlight_id JOIN matches m ON m.id = h.match_id
            WHERE t.user_id = ${id}`,
        sql`x.created_at`,
      ),
      host: hostProfile
        ? {
            profile: hostProfile,
            assignments: await this.list(
              ex,
              sql`SELECT m.public_code AS match_code, a.status, a.fee_amount, a.currency, a.offered_at, a.responded_at,
                         a.decline_reason, a.arrived_at, a.arrival_distance_m, a.completed_at
                  FROM host_assignments a JOIN matches m ON m.id = a.match_id WHERE a.host_user_id = ${id}`,
              sql`x.offered_at`,
            ),
          }
        : null,
      data_requests: await this.list(
        ex,
        sql`SELECT id, type, status, requested_at, completed_at FROM data_subject_requests WHERE user_id = ${id}`,
        sql`x.requested_at`,
      ),
    };
  }
}
