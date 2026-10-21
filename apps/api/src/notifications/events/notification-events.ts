import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { tr } from '../../common/i18n';
import { formatMoney } from '../../common/money';
import { DB, type Db, type Executor, iso, one, rows } from '../../db/db';
import { WaitlistService } from '../../matches/waitlist.service';
import { type NotificationDraft, NotificationsService } from '../notifications.service';
import { formatTime, formatWhen, type TemplateParams, type TextLocale } from '../templates';
import type { OutboxEvent } from './stream-consumer';

interface MatchCtx {
  id: string;
  title: unknown;
  sport_name: unknown;
  format: string;
  starts_at: string;
  timezone: string;
  venue_name: string;
  venue_address: unknown;
  venue_lat: number;
  venue_lng: number;
}

export async function loadMatchCtx(ex: Executor, matchId: string): Promise<MatchCtx | undefined> {
  return one<MatchCtx>(
    ex,
    sql`SELECT m.id, m.title, s.name AS sport_name, m.format, m.starts_at, v.timezone,
               v.name AS venue_name, v.address AS venue_address,
               ST_Y(v.location::geometry) AS venue_lat, ST_X(v.location::geometry) AS venue_lng
        FROM matches m
        JOIN sports s ON s.id = m.sport_id
        JOIN pitches p ON p.id = m.pitch_id
        JOIN venues v ON v.id = p.venue_id
        WHERE m.id = ${matchId}`,
  );
}

/** Match haqidagi matn parametrlari — foydalanuvchi tilida, venue vaqt zonasida. */
export function matchParams(m: MatchCtx, locale: TextLocale): TemplateParams {
  const startsAt = new Date(iso(m.starts_at)!);
  return {
    match: tr(m.title, locale) || `${tr(m.sport_name, locale)} ${m.format}`,
    when: formatWhen(startsAt, m.timezone, locale),
    time: formatTime(startsAt, m.timezone),
    venue: m.venue_name,
    address: tr(m.venue_address, locale) || m.venue_name,
  };
}

export const mapUrl = (m: MatchCtx) => `https://maps.google.com/?q=${m.venue_lat},${m.venue_lng}`;

interface HighlightCtx {
  id: string;
  match_id: string;
  created_by: string;
  title: string | null;
}

/** Faqat hozir ham ko'rinadigan klip (event navbatda turganda o'chirilgan / rad etilgan bo'lishi mumkin). */
async function loadHighlight(ex: Executor, highlightId: string): Promise<HighlightCtx | undefined> {
  return one<HighlightCtx>(
    ex,
    sql`SELECT h.id, h.match_id, h.created_by, h.title
        FROM highlights h JOIN media_assets ma ON ma.id = h.media_asset_id
        WHERE h.id = ${highlightId} AND h.deleted_at IS NULL AND h.published_at IS NOT NULL
          AND h.moderation_status <> 'rejected' AND ma.status = 'ready'`,
  );
}

/** Teg + joriy `media_appearance` consent'i (yuklashdan keyin qaytarib olingan bo'lishi mumkin). */
const consentedTag = sql`JOIN user_current_consents c ON c.user_id = t.user_id AND c.purpose = 'media_appearance' AND c.granted`;

function highlightParams(m: MatchCtx, h: HighlightCtx, locale: TextLocale): TemplateParams {
  const clip = h.title?.trim();
  return { ...matchParams(m, locale), ...(clip ? { clip: clip.length > 60 ? `${clip.slice(0, 59)}…` : clip } : {}) };
}

const highlightData = (h: HighlightCtx) => ({ url: `/highlight/${h.id}`, highlight_id: h.id, match_id: h.match_id });

/**
 * Outbox event -> foydalanuvchiga xabar. Idempotent: `dedupe_key` = event id (+ qabul qiluvchi),
 * shuning uchun event qayta yetkazilsa (at-least-once) yangi xabar yaratilmaydi.
 */
@Injectable()
export class NotificationEvents {
  private readonly log = new Logger('NotificationEvents');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly waitlist: WaitlistService,
  ) {}

  async handle(e: OutboxEvent): Promise<void> {
    switch (e.type) {
      case 'BookingConfirmed':
        return this.bookingConfirmed(e);
      case 'BookingCancelled':
        return this.bookingCancelled(e);
      case 'RefundIssued':
        return this.refundIssued(e);
      case 'MatchCancelled':
        return this.matchCancelled(e);
      case 'MatchCompleted':
        return this.matchCompleted(e);
      case 'HostOffered':
        return this.hostOffered(e);
      case 'SlotsReleased':
        await this.offerWaitlist(e.aggregateId);
        return;
      case 'MatchPublished':
        return this.matchPublished(e);
      case 'HighlightReady':
        return this.highlightReady(e);
      case 'HighlightShared':
        return this.highlightShared(e);
      case 'DataExportReady':
        return this.dataExportReady(e);
      case 'UserErased':
        return this.userErased(e);
      default:
        return;
    }
  }

  private key(e: OutboxEvent, userId: string) {
    return `evt:${e.id}:${userId}`;
  }

  private async bookingConfirmed(e: OutboxEvent) {
    const bookingId = e.aggregateId;
    const b = await one<{ user_id: string; match_id: string }>(this.db, sql`SELECT user_id, match_id FROM bookings WHERE id = ${bookingId}`);
    if (!b) return;
    // Kutish ro'yxatidan joy olgan bo'lsa — yozuv yopiladi (taklif oynasi bo'shaydi)
    await this.waitlist.markConverted(this.db, b.match_id, b.user_id);
    const m = await loadMatchCtx(this.db, b.match_id);
    if (!m) return;
    await this.notifications.notify([
      {
        userId: b.user_id,
        type: 'booking.confirmed',
        dedupeKey: this.key(e, b.user_id),
        params: (l) => matchParams(m, l),
        data: { url: `/booking/${bookingId}`, booking_id: bookingId, match_id: b.match_id },
      },
    ]);
  }

  private async bookingCancelled(e: OutboxEvent) {
    // To'lanmagan checkout'dan chiqish — xabar shart emas; match bekor bo'lsa MatchCancelled xabari bor
    if (e.payload.previous_status !== 'confirmed' || e.payload.reason === 'match_cancelled') return;
    const bookingId = e.aggregateId;
    const b = await one<{ user_id: string; match_id: string }>(this.db, sql`SELECT user_id, match_id FROM bookings WHERE id = ${bookingId}`);
    const m = b && (await loadMatchCtx(this.db, b.match_id));
    if (!b || !m) return;
    await this.notifications.notify([
      {
        userId: b.user_id,
        type: 'booking.cancelled',
        dedupeKey: this.key(e, b.user_id),
        params: (l) => matchParams(m, l),
        data: { url: `/booking/${bookingId}`, booking_id: bookingId, match_id: b.match_id },
      },
    ]);
  }

  private async refundIssued(e: OutboxEvent) {
    const r = await one<{ user_id: string; booking_id: string; match_id: string; amount: number; currency: string; destination: string }>(
      this.db,
      sql`SELECT b.user_id, b.id AS booking_id, b.match_id, r.amount, r.currency, r.destination
          FROM refunds r JOIN bookings b ON b.id = r.booking_id
          WHERE r.id = ${e.aggregateId}`,
    );
    const m = r && (await loadMatchCtx(this.db, r.match_id));
    if (!r || !m) return;
    // Event'dagi summa hamyon bonusini ham o'z ichiga oladi (admin bekor qilishda)
    const amount = typeof e.payload.amount === 'number' ? e.payload.amount : r.amount;
    const destination = typeof e.payload.destination === 'string' ? e.payload.destination : r.destination;
    await this.notifications.notify([
      {
        userId: r.user_id,
        type: 'refund.issued',
        dedupeKey: this.key(e, r.user_id),
        params: (l) => ({ ...matchParams(m, l), amount: formatMoney(amount, r.currency, l), destination }),
        data: { url: `/booking/${r.booking_id}`, booking_id: r.booking_id, match_id: r.match_id, refund_id: e.aggregateId },
      },
    ]);
  }

  private async matchCancelled(e: OutboxEvent) {
    const matchId = e.aggregateId;
    const m = await loadMatchCtx(this.db, matchId);
    if (!m) return;
    // To'langan (confirmed bo'lgan) booking egalari
    const list = await rows<{ user_id: string; booking_id: string }>(
      this.db,
      sql`SELECT DISTINCT ON (user_id) user_id, id AS booking_id FROM bookings
          WHERE match_id = ${matchId} AND status = 'cancelled' AND cancel_reason = 'match_cancelled'
            AND confirmed_at IS NOT NULL
          ORDER BY user_id, created_at DESC`,
    );
    await this.notifications.notify(
      list.map((b) => ({
        userId: b.user_id,
        type: 'match.cancelled' as const,
        dedupeKey: this.key(e, b.user_id),
        params: (l: TextLocale) => matchParams(m, l),
        data: { url: `/booking/${b.booking_id}`, booking_id: b.booking_id, match_id: matchId },
      })),
    );
  }

  private async matchCompleted(e: OutboxEvent) {
    const matchId = e.aggregateId;
    const m = await loadMatchCtx(this.db, matchId);
    if (!m) return;
    const players = await rows<{ user_id: string }>(
      this.db,
      sql`SELECT DISTINCT user_id FROM match_participants
          WHERE match_id = ${matchId} AND status = 'checked_in' AND user_id IS NOT NULL`,
    );
    await this.notifications.notify(
      players.map((p) => ({
        userId: p.user_id,
        type: 'match.rate' as const,
        dedupeKey: this.key(e, p.user_id),
        params: (l: TextLocale) => matchParams(m, l),
        data: { url: `/match/${matchId}?rate=1`, match_id: matchId },
      })),
    );
  }

  private async hostOffered(e: OutboxEvent) {
    const hostId = String(e.payload.host_user_id ?? '');
    const a = await one<{ id: string; fee_amount: number; currency: string; ttl: number; status: string }>(
      this.db,
      sql`SELECT id, fee_amount, currency, status,
                 greatest(extract(epoch FROM offer_expires_at - now()), 0)::int AS ttl
          FROM host_assignments WHERE match_id = ${e.aggregateId} AND host_user_id = ${hostId}`,
    );
    // Taklif allaqachon yopilgan (boshqa host oldi / muddati o'tdi) — push kechikib bormasin
    if (!a || a.status !== 'offered' || a.ttl <= 0) return;
    const m = await loadMatchCtx(this.db, e.aggregateId);
    if (!m) return;
    await this.notifications.notify([
      {
        userId: hostId,
        type: 'host.offer',
        dedupeKey: this.key(e, hostId),
        params: (l) => ({ ...matchParams(m, l), fee: formatMoney(a.fee_amount, a.currency, l) }),
        data: { url: `/?offer=${a.id}`, assignment_id: a.id, match_id: e.aggregateId },
        ttlSec: a.ttl,
      },
    ]);
  }

  /**
   * SlotsReleased (yoki muddati o'tgan taklif) -> kutish ro'yxatidagi navbatdagilarga eksklyuziv taklif.
   * Taklif va xabar bitta tranzaksiyada yoziladi: crash bo'lsa ham taklif "xabarsiz" qolmaydi.
   */
  async offerWaitlist(matchId: string): Promise<number> {
    const m = await loadMatchCtx(this.db, matchId);
    if (!m) return 0;
    const ids = await this.db.transaction(async (tx) => {
      const offers = await this.waitlist.offerNext(tx, matchId);
      return this.notifications.enqueue(
        tx,
        offers.map((o) => ({
          userId: o.user_id,
          type: 'waitlist.offer' as const,
          dedupeKey: `waitlist:${o.id}`,
          params: (l: TextLocale) => matchParams(m, l),
          data: { url: `/match/${matchId}`, match_id: matchId, offer_expires_at: iso(o.offer_expires_at) },
          ttlSec: WaitlistService.OFFER_MINUTES * 60,
        })),
      );
    });
    await this.notifications.deliver(ids);
    if (ids.length) this.log.log(`waitlist: ${ids.length} ta taklif (match ${matchId})`);
    return ids.length;
  }

  /** GDPR eksport fayli tayyor -> egasiga push (ilovadagi "Maxfiylik" ekraniga). */
  private async dataExportReady(e: OutboxEvent) {
    const requestId = typeof e.payload.request_id === 'string' ? e.payload.request_id : '';
    if (!requestId) return;
    // Sana foydalanuvchi shahri (yo'q bo'lsa — mamlakatining birinchi shahri) vaqt zonasida
    const r = await one<{ user_id: string; expires_at: string; ttl: number; timezone: string }>(
      this.db,
      sql`SELECT d.user_id, d.export_expires_at AS expires_at,
                 extract(epoch FROM d.export_expires_at - now())::int AS ttl,
                 coalesce(hc.timezone,
                          (SELECT c.timezone FROM cities c WHERE c.country_code = u.country_code ORDER BY c.id LIMIT 1),
                          'UTC') AS timezone
          FROM data_subject_requests d
          JOIN users u ON u.id = d.user_id
          LEFT JOIN cities hc ON hc.id = u.home_city_id
          WHERE d.id = ${requestId} AND d.type = 'export' AND d.status = 'completed' AND d.export_path IS NOT NULL`,
    );
    // Fayl allaqachon o'chirilgan / muddati o'tgan — push kechikib bormasin
    if (!r || r.ttl <= 0) return;
    const expiresAt = new Date(iso(r.expires_at)!);
    await this.notifications.notify([
      {
        userId: r.user_id,
        type: 'privacy.export_ready',
        dedupeKey: this.key(e, r.user_id),
        params: (l) => ({ expires: formatWhen(expiresAt, r.timezone, l) }),
        data: { url: '/account/privacy', request_id: requestId },
        ttlSec: r.ttl,
      },
    ]);
  }

  /**
   * GDPR erasure -> in-app xabarlar tarixi o'chiriladi (matnlarda match'lar, summalar, teglar bor).
   * Yangi xabar yozilmaydi: `enqueue` anonimlashtirilgan foydalanuvchini o'tkazib yuboradi. Faqat haqiqatan
   * anonimlashtirilgan akkaunt uchun ishlaydi; qayta yetkazilsa — o'chiradigan narsa qolmagan.
   */
  private async userErased(e: OutboxEvent) {
    const userId = e.aggregateId;
    const erased = await one(this.db, sql`SELECT 1 FROM users WHERE id = ${userId} AND anonymized_at IS NOT NULL`);
    if (!erased) return;
    const removed = await this.db.transaction(async (tx) => {
      // Push tarixi device_tokens bilan birga o'chgan (ON DELETE CASCADE); bu — qolgan-qutgani uchun
      await tx.execute(
        sql`DELETE FROM push_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE user_id = ${userId})`,
      );
      return (await tx.execute(sql`DELETE FROM notifications WHERE user_id = ${userId}`)).rowCount ?? 0;
    });
    if (removed) this.log.log(`erasure: ${removed} ta xabar o'chirildi (user ${userId})`);
  }

  /** Marketing: shahar + sport bo'yicha qiziqqan o'yinchilarga yangi o'yin (faqat consent bilan). */
  private async matchPublished(e: OutboxEvent) {
    const matchId = e.aggregateId;
    const m = await loadMatchCtx(this.db, matchId);
    if (!m) return;
    const users = await rows<{ id: string }>(
      this.db,
      sql`SELECT u.id FROM matches mt
          JOIN users u ON u.home_city_id = mt.city_id
          JOIN player_sport_profiles psp ON psp.user_id = u.id AND psp.sport_id = mt.sport_id
          JOIN user_current_consents c ON c.user_id = u.id AND c.purpose = 'marketing_push' AND c.granted
          WHERE mt.id = ${matchId} AND mt.status = 'open' AND mt.visibility = 'public'
            AND u.status = 'active' AND u.deleted_at IS NULL
          LIMIT 500`,
    );
    const drafts: NotificationDraft[] = users.map((u) => ({
      userId: u.id,
      type: 'match.new',
      dedupeKey: this.key(e, u.id),
      params: (l) => matchParams(m, l),
      data: { url: `/match/${matchId}`, match_id: matchId },
    }));
    await this.notifications.notify(drafts);
  }

  /**
   * HighlightReady -> teglangan o'yinchilarga "sizni belgilashdi" (har klip uchun) va match'ning qolgan
   * ishtirokchilariga "o'yiningizdan highlight" — har match uchun bitta: host bir nechta klip yuklasa ham
   * spam bo'lmaydi, keyingilari feed'da. Teglar event payload'idan emas, bazadan joriy consent bilan olinadi.
   */
  private async highlightReady(e: OutboxEvent) {
    const h = await loadHighlight(this.db, e.aggregateId);
    const m = h && (await loadMatchCtx(this.db, h.match_id));
    if (!h || !m) return;
    const tagged = await rows<{ user_id: string }>(
      this.db,
      sql`SELECT t.user_id FROM highlight_tags t ${consentedTag}
          WHERE t.highlight_id = ${h.id} AND t.user_id <> ${h.created_by}`,
    );
    // Ko'rish huquqi bor ishtirokchilar (highlights.service VIEWER_PARTICIPANT_STATUSES bilan bir xil)
    const participants = await rows<{ user_id: string }>(
      this.db,
      sql`SELECT DISTINCT mp.user_id FROM match_participants mp
          WHERE mp.match_id = ${h.match_id} AND mp.status IN ('confirmed', 'checked_in')
            AND mp.user_id IS NOT NULL AND mp.user_id <> ${h.created_by}
            AND NOT EXISTS (SELECT 1 FROM notifications n
                            WHERE n.user_id = mp.user_id AND n.type IN ('highlight.tagged', 'highlight.ready')
                              AND n.payload->'data'->>'match_id' = ${h.match_id})`,
    );
    const taggedIds = new Set(tagged.map((t) => t.user_id));
    const draft = (userId: string, type: 'highlight.tagged' | 'highlight.ready'): NotificationDraft => ({
      userId,
      type,
      dedupeKey: this.key(e, userId),
      params: (l) => highlightParams(m, h, l),
      data: highlightData(h),
    });
    await this.notifications.notify([
      ...[...taggedIds].map((id) => draft(id, 'highlight.tagged')),
      ...participants.filter((p) => !taggedIds.has(p.user_id)).map((p) => draft(p.user_id, 'highlight.ready')),
    ]);
  }

  /**
   * HighlightShared -> klipda teglangan o'yinchilarga (ulashganning o'zidan tashqari). Har klip uchun bitta
   * xabar: keyingi ulashishlar jim, aks holda har repost push bo'lardi.
   */
  private async highlightShared(e: OutboxEvent) {
    const sharerId = typeof e.payload.user_id === 'string' ? e.payload.user_id : null;
    if (!sharerId) return;
    const h = await loadHighlight(this.db, e.aggregateId);
    const actor = await one<{ display_name: string }>(
      this.db,
      sql`SELECT display_name FROM users WHERE id = ${sharerId} AND deleted_at IS NULL AND anonymized_at IS NULL`,
    );
    const m = h && actor && (await loadMatchCtx(this.db, h.match_id));
    if (!h || !actor || !m) return;
    const tagged = await rows<{ user_id: string }>(
      this.db,
      sql`SELECT t.user_id FROM highlight_tags t ${consentedTag}
          WHERE t.highlight_id = ${h.id} AND t.user_id <> ${sharerId}
            AND NOT EXISTS (SELECT 1 FROM notifications n
                            WHERE n.user_id = t.user_id AND n.type = 'highlight.shared'
                              AND n.payload->'data'->>'highlight_id' = ${h.id})`,
    );
    await this.notifications.notify(
      tagged.map((t) => ({
        userId: t.user_id,
        type: 'highlight.shared' as const,
        dedupeKey: this.key(e, t.user_id),
        params: (l: TextLocale) => ({ ...highlightParams(m, h, l), actor: actor.display_name }),
        data: highlightData(h),
      })),
    );
  }
}
