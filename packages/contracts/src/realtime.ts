/**
 * WebSocket (Socket.IO v4) kontrakti — REST emas, shuning uchun OpenAPI'dan generatsiya qilinmaydi
 * (`api/openapi.yaml` dagi "Realtime" tegi bilan bir xil saqlang).
 *
 *   io(API_URL, { path: REALTIME_PATH, transports: ['websocket'], auth: { token } })
 *   socket.emit('subscribe', { room: `match:${id}` }, (ack: SubscribeAck) => ...)
 */
import type { components } from './schema';

type Schemas = components['schemas'];

export const REALTIME_PATH = '/ws';

export type RealtimeRoom = `match:${string}` | `booking:${string}` | `host:${string}`;

/** `match:{id}` -> `slots.updated` */
export interface RealtimeSlots {
  match_id: string;
  available: number;
  /** hold + confirmed */
  taken: number;
  max: number;
  status: Schemas['MatchStatus'];
}

/** `booking:{id}` (faqat egasi) -> `booking.updated` */
export interface RealtimeBooking {
  booking_id: string;
  match_id: string;
  status: Schemas['BookingStatus'];
}

/** `host:{userId}` -> `offer.created` */
export interface RealtimeOffer {
  assignment_id: string;
  match_id: string;
  offer_expires_at: string;
}

/** `host:{userId}` -> `offer.closed` (boshqa host qabul qildi) */
export interface RealtimeOfferClosed {
  assignment_id: string;
  match_id: string;
  reason: 'taken';
}

/** Server -> mijoz event'lari. */
export interface RealtimeEvents {
  'slots.updated': (p: RealtimeSlots) => void;
  'booking.updated': (p: RealtimeBooking) => void;
  'offer.created': (p: RealtimeOffer) => void;
  'offer.closed': (p: RealtimeOfferClosed) => void;
}

export type SubscribeAck =
  | { ok: true; room: string; state?: RealtimeSlots | RealtimeBooking }
  | { ok: false; room?: string; code: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'RATE_LIMITED' };

/** Mijoz -> server event'lari (ack bilan). */
export interface RealtimeCommands {
  subscribe: (p: { room: RealtimeRoom }, ack: (r: SubscribeAck) => void) => void;
  unsubscribe: (p: { room: RealtimeRoom }, ack: (r: { ok: boolean }) => void) => void;
}
