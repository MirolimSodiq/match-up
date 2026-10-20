import { Logger } from '@nestjs/common';
import { type PushMessage, type PushReceipt, PushError, type PushSender, type PushTicket } from './push-sender';

/** Expo Push API: https://docs.expo.dev/push-notifications/sending-notifications/ */
const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 1000;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export const isExpoPushToken = (token: string) => /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);

export class ExpoPushSender implements PushSender {
  readonly provider = 'expo' as const;
  private readonly log = new Logger('ExpoPush');

  constructor(
    private readonly baseUrl: string,
    private readonly accessToken?: string,
    private readonly timeoutMs = 10_000,
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Expo push HTTP ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text) as { data?: T; errors?: { code: string; message: string }[] };
    if (json.errors?.length) throw new Error(`Expo push: ${json.errors.map((e) => `${e.code} ${e.message}`).join('; ')}`);
    return json.data as T;
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const out: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += SEND_CHUNK) {
      const chunk = messages.slice(i, i + SEND_CHUNK);
      const tickets = await this.post<ExpoTicket[]>('/send', chunk.map((m) => ({ ...m, sound: m.sound === undefined ? 'default' : m.sound })));
      if (!Array.isArray(tickets) || tickets.length !== chunk.length) {
        throw new Error(`Expo push: kutilmagan javob (${chunk.length} xabar, ${Array.isArray(tickets) ? tickets.length : '?'} ticket)`);
      }
      for (const t of tickets) {
        out.push(
          t.status === 'ok'
            ? { ok: true, id: t.id ?? null }
            : { ok: false, error: t.details?.error ?? PushError.UNKNOWN, message: t.message },
        );
      }
    }
    return out;
  }

  async receipts(ids: string[]): Promise<Map<string, PushReceipt>> {
    const out = new Map<string, PushReceipt>();
    for (let i = 0; i < ids.length; i += RECEIPT_CHUNK) {
      const data = await this.post<Record<string, ExpoTicket>>('/getReceipts', { ids: ids.slice(i, i + RECEIPT_CHUNK) });
      for (const [id, r] of Object.entries(data ?? {})) {
        out.set(id, r.status === 'ok' ? { ok: true } : { ok: false, error: r.details?.error ?? PushError.UNKNOWN, message: r.message });
      }
    }
    this.log.debug(`receipts: ${out.size}/${ids.length}`);
    return out;
  }
}
