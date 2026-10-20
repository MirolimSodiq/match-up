import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '../common/http';
import { DB, type Db, type Executor, iso, one, rows } from '../db/db';
import { type PushMessage, PushError, type PushProvider, PUSH_SENDERS, type PushSender, type PushTicket } from './push/push-sender';
import { type NotificationType, render, TEMPLATES, type TemplateParams, type TextLocale, textLocale } from './templates';

export interface NotificationDraft {
  userId: string;
  type: NotificationType;
  /** Idempotentlik: bir xil kalit bilan xabar ikkinchi marta yaratilmaydi. */
  dedupeKey: string;
  /** Matn parametrlari foydalanuvchi tilida formatlanadi (sana, summa). */
  params: (locale: TextLocale) => TemplateParams;
  /** Ilova uchun: `url` — deep link (expo-router yo'li) va id'lar. */
  data: Record<string, unknown>;
  /** Push qurilmaga qancha vaqt ichida yetib borishi mantiqli (masalan, 10 daqiqalik taklif). */
  ttlSec?: number;
}

interface StoredPayload {
  title: string;
  body: string;
  data: Record<string, unknown>;
  ttl?: number;
}

interface ClaimedRow {
  id: string;
  user_id: string;
  type: NotificationType;
  payload: StoredPayload;
  attempts: number;
}

interface DeviceRow {
  id: string;
  user_id: string;
  provider: PushProvider;
  push_token: string;
}

const MAX_ATTEMPTS = 5;
/** Tez yo'l (yaratilgandan keyin darhol yuborish) uchun imkon: retry job bu vaqtgacha tegmaydi. */
const FAST_PATH_GRACE = sql`interval '1 minute'`;
/** Bu xatolar vaqtinchalik — xabar navbatda qoladi. */
const TRANSIENT = new Set<string>([PushError.RATE_EXCEEDED]);

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');
  private readonly senders: Map<PushProvider, PushSender>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PUSH_SENDERS) senders: PushSender[],
  ) {
    this.senders = new Map(senders.map((s) => [s.provider, s]));
  }

  // -------------------------------------------------------------------------
  // Navbatga qo'yish
  // -------------------------------------------------------------------------
  /**
   * `notifications` ga yozadi (ON CONFLICT dedupe_key -> o'tkazib yuboriladi). Chaqiruvchining
   * tranzaksiyasida ishlashi mumkin; yuborish — commit'dan keyin `deliver(ids)`.
   * Marketing xabarlari faqat `marketing_push` consent'i bor foydalanuvchilarga yoziladi.
   */
  async enqueue(ex: Executor, drafts: NotificationDraft[]): Promise<string[]> {
    if (!drafts.length) return [];
    const userIds = [...new Set(drafts.map((d) => d.userId))];
    const users = await rows<{ id: string; locale: string; marketing: boolean }>(
      ex,
      sql`SELECT u.id, u.locale,
                 coalesce((SELECT c.granted FROM user_current_consents c
                           WHERE c.user_id = u.id AND c.purpose = 'marketing_push'), false) AS marketing
          FROM users u
          WHERE u.id = ANY(${pgUuidArray(userIds)}) AND u.deleted_at IS NULL AND u.anonymized_at IS NULL`,
    );
    const byId = new Map(users.map((u) => [u.id, u]));

    const values = [];
    for (const d of drafts) {
      const u = byId.get(d.userId);
      if (!u) continue;
      const tpl = TEMPLATES[d.type];
      if (tpl.category === 'marketing' && !u.marketing) continue;
      const locale = textLocale(u.locale);
      const { title, body } = render(d.type, locale, d.params(locale));
      const payload: StoredPayload = { title, body, data: d.data, ...(d.ttlSec ? { ttl: d.ttlSec } : {}) };
      values.push(
        sql`(${d.userId}, ${d.type}, 'push', 'queued', ${locale}, ${JSON.stringify(payload)}::jsonb, ${tpl.category},
             ${d.dedupeKey}, now() + ${FAST_PATH_GRACE})`,
      );
    }
    if (!values.length) return [];
    const inserted = await rows<{ id: string }>(
      ex,
      sql`INSERT INTO notifications (user_id, type, channel, status, locale, payload, category, dedupe_key, next_attempt_at)
          VALUES ${sql.join(values, sql`, `)}
          ON CONFLICT (dedupe_key) DO NOTHING
          RETURNING id`,
    );
    return inserted.map((r) => r.id);
  }

  /** Tranzaksiyasiz qisqa yo'l: yozish + darhol yuborish. */
  async notify(drafts: NotificationDraft[]): Promise<string[]> {
    const ids = await this.enqueue(this.db, drafts);
    await this.deliver(ids);
    return ids;
  }

  // -------------------------------------------------------------------------
  // Yetkazish
  // -------------------------------------------------------------------------
  /** Berilgan (hali `queued`) xabarlarni yuboradi. Ikkinchi parallel chaqiruv ularni qayta olmaydi. */
  async deliver(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const claimed = await rows<ClaimedRow>(
      this.db,
      sql`UPDATE notifications
             SET attempts = attempts + 1,
                 next_attempt_at = now() + make_interval(mins => power(2, attempts)::int)
           WHERE id = ANY(${pgUuidArray(ids)}) AND status = 'queued'
           RETURNING id, user_id, type, payload, attempts`,
    );
    await this.send(claimed);
  }

  /** Retry job: muddati kelgan `queued` xabarlar (crash yoki provider xatosidan keyin). */
  async retryQueued(limit = 200): Promise<number> {
    const claimed = await rows<ClaimedRow>(
      this.db,
      sql`UPDATE notifications
             SET attempts = attempts + 1,
                 next_attempt_at = now() + make_interval(mins => power(2, attempts)::int)
           WHERE id IN (SELECT id FROM notifications
                        WHERE status = 'queued' AND channel = 'push' AND next_attempt_at <= now()
                        ORDER BY next_attempt_at LIMIT ${limit}
                        FOR UPDATE SKIP LOCKED)
           RETURNING id, user_id, type, payload, attempts`,
    );
    await this.send(claimed);
    return claimed.length;
  }

  private async send(list: ClaimedRow[]): Promise<void> {
    if (!list.length) return;
    const userIds = [...new Set(list.map((n) => n.user_id))];
    const devices = await rows<DeviceRow>(
      this.db,
      sql`SELECT id, user_id, provider, push_token FROM device_tokens
          WHERE user_id = ANY(${pgUuidArray(userIds)}) AND disabled_at IS NULL
          ORDER BY updated_at DESC`,
    );
    const unread = await rows<{ user_id: string; n: number }>(
      this.db,
      sql`SELECT user_id, count(*)::int AS n FROM notifications
          WHERE user_id = ANY(${pgUuidArray(userIds)}) AND read_at IS NULL GROUP BY user_id`,
    );
    const badge = new Map(unread.map((u) => [u.user_id, u.n]));

    // provider -> [(notification, device, message)]
    const jobs = new Map<PushProvider, { n: ClaimedRow; d: DeviceRow; m: PushMessage }[]>();
    const noDevice: ClaimedRow[] = [];
    for (const n of list) {
      const mine = devices.filter((d) => d.user_id === n.user_id);
      if (!mine.length) {
        noDevice.push(n);
        continue;
      }
      for (const d of mine) {
        const m: PushMessage = {
          to: d.push_token,
          title: n.payload.title,
          body: n.payload.body,
          data: { ...n.payload.data, type: n.type, notification_id: n.id },
          badge: badge.get(n.user_id),
          channelId: 'default',
          priority: TEMPLATES[n.type]?.priority === 'high' ? 'high' : 'default',
          ...(n.payload.ttl ? { ttl: n.payload.ttl } : {}),
        };
        const bucket = jobs.get(d.provider) ?? [];
        bucket.push({ n, d, m });
        jobs.set(d.provider, bucket);
      }
    }

    if (noDevice.length) {
      await this.db.execute(
        sql`UPDATE notifications SET status = 'failed', error = 'NO_ACTIVE_DEVICE'
            WHERE id = ANY(${pgUuidArray(noDevice.map((n) => n.id))})`,
      );
    }

    // notification id -> natijalar
    const results = new Map<string, { ok: PushTicket[]; errors: string[]; transient: boolean }>();
    const resultFor = (id: string) => {
      let r = results.get(id);
      if (!r) results.set(id, (r = { ok: [], errors: [], transient: false }));
      return r;
    };

    for (const [provider, bucket] of jobs) {
      const sender = this.senders.get(provider);
      if (!sender) {
        for (const j of bucket) {
          await this.recordDelivery(j.n.id, j.d, provider, { ok: false, error: 'NO_SENDER' });
          resultFor(j.n.id).errors.push('NO_SENDER');
        }
        continue;
      }
      let tickets: PushTicket[];
      try {
        tickets = await sender.send(bucket.map((j) => j.m));
      } catch (err) {
        const message = (err as Error).message.slice(0, 500);
        this.log.warn(`${provider} push yuborilmadi: ${message}`);
        for (const j of bucket) {
          const r = resultFor(j.n.id);
          r.errors.push(message);
          r.transient = true;
        }
        continue;
      }
      for (let i = 0; i < bucket.length; i++) {
        const j = bucket[i]!;
        const t = tickets[i] ?? { ok: false as const, error: PushError.UNKNOWN };
        await this.recordDelivery(j.n.id, j.d, provider, t);
        const r = resultFor(j.n.id);
        if (t.ok) r.ok.push(t);
        else {
          r.errors.push(t.error);
          if (TRANSIENT.has(t.error)) r.transient = true;
          if (t.error === PushError.DEVICE_NOT_REGISTERED) await this.disableDevice(j.d.id, t.error);
        }
      }
    }

    for (const n of list) {
      const r = results.get(n.id);
      if (!r) continue;
      if (r.ok.length) {
        const first = r.ok[0] as { id: string | null };
        await this.db.execute(
          sql`UPDATE notifications SET status = 'sent', sent_at = now(), provider_message_id = ${first.id}, error = NULL
              WHERE id = ${n.id}`,
        );
      } else if (r.transient && n.attempts < MAX_ATTEMPTS) {
        await this.db.execute(sql`UPDATE notifications SET error = ${r.errors[0] ?? null} WHERE id = ${n.id}`);
      } else {
        await this.db.execute(
          sql`UPDATE notifications SET status = 'failed', error = ${r.errors[0] ?? PushError.UNKNOWN} WHERE id = ${n.id}`,
        );
      }
    }
  }

  private async recordDelivery(notificationId: string, d: DeviceRow, provider: PushProvider, t: PushTicket) {
    await this.db.execute(
      sql`INSERT INTO push_deliveries (notification_id, device_token_id, provider, ticket_id, status, error, receipt_checked_at)
          VALUES (${notificationId}, ${d.id}, ${provider}, ${t.ok ? t.id : null}, ${t.ok ? 'sent' : 'failed'},
                  ${t.ok ? null : t.error}, ${t.ok && t.id ? null : sql`now()`})`,
    );
  }

  private async disableDevice(deviceId: string, reason: string) {
    await this.db.execute(
      sql`UPDATE device_tokens SET disabled_at = now(), disabled_reason = ${reason}, updated_at = now()
          WHERE id = ${deviceId} AND disabled_at IS NULL`,
    );
  }

  // -------------------------------------------------------------------------
  // Receipt'lar (Expo: ticket'dan ~15 daqiqa keyin, 24 soat saqlanadi)
  // -------------------------------------------------------------------------
  async checkReceipts(minAgeSec = 900, limit = 1000): Promise<{ checked: number; failed: number }> {
    const pending = await rows<{ id: string; notification_id: string; device_token_id: string; provider: PushProvider; ticket_id: string; stale: boolean }>(
      this.db,
      sql`SELECT id, notification_id, device_token_id, provider, ticket_id, created_at < now() - interval '24 hours' AS stale
          FROM push_deliveries
          WHERE status = 'sent' AND ticket_id IS NOT NULL AND receipt_checked_at IS NULL
            AND created_at <= now() - make_interval(secs => ${minAgeSec})
          ORDER BY created_at LIMIT ${limit}`,
    );
    let checked = 0;
    let failed = 0;
    const touched = new Set<string>();
    for (const provider of new Set(pending.map((p) => p.provider))) {
      const sender = this.senders.get(provider);
      const group = pending.filter((p) => p.provider === provider);
      if (!sender?.receipts) continue;
      let receipts;
      try {
        receipts = await sender.receipts(group.map((p) => p.ticket_id));
      } catch (err) {
        this.log.warn(`${provider} receipt'lar olinmadi: ${(err as Error).message}`);
        continue;
      }
      for (const p of group) {
        const r = receipts.get(p.ticket_id);
        if (!r) {
          // Hali tayyor emas; 24 soatdan keyin provider ham saqlamaydi
          if (p.stale) await this.db.execute(sql`UPDATE push_deliveries SET receipt_checked_at = now() WHERE id = ${p.id}`);
          continue;
        }
        checked++;
        touched.add(p.notification_id);
        if (r.ok) {
          await this.db.execute(sql`UPDATE push_deliveries SET status = 'delivered', receipt_checked_at = now() WHERE id = ${p.id}`);
        } else {
          failed++;
          await this.db.execute(
            sql`UPDATE push_deliveries SET status = 'failed', error = ${r.error}, receipt_checked_at = now() WHERE id = ${p.id}`,
          );
          if (r.error === PushError.DEVICE_NOT_REGISTERED) await this.disableDevice(p.device_token_id, r.error);
        }
      }
    }
    if (touched.size) {
      const ids = pgUuidArray([...touched]);
      await this.db.execute(
        sql`UPDATE notifications n SET status = 'delivered'
            WHERE n.id = ANY(${ids}) AND n.status = 'sent'
              AND EXISTS (SELECT 1 FROM push_deliveries d WHERE d.notification_id = n.id AND d.status = 'delivered')`,
      );
      await this.db.execute(
        sql`UPDATE notifications n
               SET status = 'failed',
                   error = (SELECT d.error FROM push_deliveries d WHERE d.notification_id = n.id AND d.error IS NOT NULL LIMIT 1)
            WHERE n.id = ANY(${ids}) AND n.status = 'sent'
              AND NOT EXISTS (SELECT 1 FROM push_deliveries d WHERE d.notification_id = n.id AND d.status IN ('sent', 'delivered'))`,
      );
    }
    return { checked, failed };
  }

  // -------------------------------------------------------------------------
  // In-app ro'yxat
  // -------------------------------------------------------------------------
  async list(userId: string, cursor: string | undefined, limit: number) {
    const cur = decodeCursor<{ t: string; id: string }>(cursor);
    const list = await rows<{ id: string; type: string; category: string; payload: StoredPayload; created_at: string; read_at: string | null }>(
      this.db,
      sql`SELECT id, type, category, payload, created_at, read_at FROM notifications
          WHERE user_id = ${userId}
            ${cur ? sql`AND (created_at, id) < (${cur.t}::timestamptz, ${cur.id}::uuid)` : sql``}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit + 1}`,
    );
    const page = list.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((n) => ({
        id: n.id,
        type: n.type,
        category: n.category,
        title: n.payload.title,
        body: n.payload.body,
        data: n.payload.data ?? {},
        created_at: iso(n.created_at),
        read_at: iso(n.read_at),
      })),
      next_cursor: list.length > limit && last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
      unread_count: await this.unreadCount(userId),
    };
  }

  async markRead(userId: string, body: { ids?: string[]; all?: boolean }) {
    const res = await this.db.execute(
      sql`UPDATE notifications SET read_at = now()
          WHERE user_id = ${userId} AND read_at IS NULL
            ${body.all ? sql`` : sql`AND id = ANY(${pgUuidArray(body.ids ?? [])})`}`,
    );
    return { updated: res.rowCount ?? 0, unread_count: await this.unreadCount(userId) };
  }

  private async unreadCount(userId: string): Promise<number> {
    const r = await one<{ n: number }>(
      this.db,
      sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`,
    );
    return r?.n ?? 0;
  }
}

/** JS massivini Postgres uuid[] ga (drizzle massiv parametrlarini qo'llamaydi). */
export function pgUuidArray(ids: string[]) {
  return sql`string_to_array(${ids.join(',')}, ',')::uuid[]`;
}
