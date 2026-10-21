import { Inject, Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import type { AuthUser } from '../../common/http';
import { DB, type Db, one } from '../../db/db';
import { TokensService } from '../../identity/tokens.service';
import { REDIS } from '../../redis/redis.module';

/** Ilovalar ulanadigan yo'l: `io(API_URL, { path: '/ws', auth: { token } })`. */
export const WS_PATH = '/ws';
const MAX_ROOMS_PER_SOCKET = 50;
const userRoom = (userId: string) => `user:${userId.toLowerCase()}`;
const ROOM_RE = /^(match|booking|host):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface SlotsState {
  match_id: string;
  available: number;
  taken: number;
  max: number;
  status: string;
}

export interface BookingState {
  booking_id: string;
  match_id: string;
  status: string;
}

export type SubscribeAck =
  | { ok: true; room: string; state?: SlotsState | BookingState }
  | { ok: false; room?: string; code: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'RATE_LIMITED' };

interface SocketData {
  user?: AuthUser;
}

/** Handshake: `auth: { token }` yoki `Authorization: Bearer` header (query string'da token qabul qilinmaydi). */
function handshakeToken(socket: Socket): string | undefined {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token) return auth.token.replace(/^Bearer\s+/i, '');
  const header = socket.handshake.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

/**
 * Socket.IO gateway. Xonalar:
 *   match:{id}   — ochiq (token shart emas)       -> `slots.updated`
 *   booking:{id} — faqat booking egasi            -> `booking.updated`
 *   host:{userId}— faqat o'sha host                -> `offer.created`, `offer.closed`
 *   user:{userId}— token bilan ulanganda avtomatik (mijoz obuna bo'lolmaydi) — server tomonidan uzish uchun
 * Event'lar outbox consumer'dan (RealtimeEvents) chiqariladi; Redis adapter bir nechta API
 * instance'ini bog'laydi (qaysi instance chiqarsa ham, barcha ulanishlarga yetadi).
 */
@WebSocketGateway({ path: WS_PATH, serveClient: false, cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnApplicationShutdown {
  private readonly log = new Logger('Realtime');
  @WebSocketServer() server?: Server;
  private pub?: Redis;
  private sub?: Redis;

  constructor(
    private readonly tokens: TokensService,
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  afterInit(server: Server) {
    this.pub = this.redis.duplicate();
    this.sub = this.redis.duplicate();
    server.adapter(createAdapter(this.pub, this.sub, { key: 'matchup:sio' }));
    server.use((socket, next) => {
      const token = handshakeToken(socket);
      if (!token) return next();
      this.tokens
        .verifyAccess(token)
        .then(async (claims) => {
          // Access token o'chirilgan (GDPR erasure) akkauntda TTL tugaguncha yaroqli — ulanish rad etiladi
          const active = await one(this.db, sql`SELECT 1 FROM users WHERE id = ${claims.id} AND deleted_at IS NULL`);
          if (!active) throw new Error('UNAUTHORIZED');
          (socket.data as SocketData).user = { id: claims.id, roles: claims.roles };
          next();
        })
        // Yaroqsiz/eskirgan token — ulanish rad etiladi: ilova token'ni yangilab qayta ulanadi
        .catch(() => next(Object.assign(new Error('UNAUTHORIZED'), { data: { code: 'UNAUTHORIZED' } })));
    });
  }

  async handleConnection(client: Socket) {
    const user = (client.data as SocketData).user;
    if (user) await client.join(userRoom(user.id));
  }

  async onApplicationShutdown() {
    await Promise.all([this.pub?.quit().catch(() => undefined), this.sub?.quit().catch(() => undefined)]);
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<SubscribeAck> {
    const room = typeof body === 'object' && body !== null ? (body as { room?: unknown }).room : undefined;
    const m = typeof room === 'string' ? ROOM_RE.exec(room) : null;
    if (!m) return { ok: false, code: 'BAD_REQUEST' };
    const [, kind, id] = m as unknown as [string, 'match' | 'booking' | 'host', string];
    const name = `${kind}:${id.toLowerCase()}`;
    if (client.rooms.size > MAX_ROOMS_PER_SOCKET) return { ok: false, room: name, code: 'RATE_LIMITED' };
    const user = (client.data as SocketData).user;

    let state: SlotsState | BookingState | undefined;
    if (kind === 'match') {
      state = await this.matchState(id);
      if (!state || state.status === 'draft') return { ok: false, room: name, code: 'NOT_FOUND' };
    } else if (kind === 'booking') {
      if (!user) return { ok: false, room: name, code: 'UNAUTHORIZED' };
      const b = await one<BookingState & { user_id: string }>(
        this.db,
        sql`SELECT id AS booking_id, match_id, status, user_id FROM bookings WHERE id = ${id}`,
      );
      // Boshqa odamning booking'i borligini oshkor qilmaymiz
      if (!b || b.user_id !== user.id) return { ok: false, room: name, code: 'NOT_FOUND' };
      state = { booking_id: b.booking_id, match_id: b.match_id, status: b.status };
    } else {
      if (!user) return { ok: false, room: name, code: 'UNAUTHORIZED' };
      if (user.id !== id.toLowerCase() || !user.roles.includes('host')) return { ok: false, room: name, code: 'FORBIDDEN' };
    }
    await client.join(name);
    return { ok: true, room: name, ...(state ? { state } : {}) };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<{ ok: boolean }> {
    const room = typeof body === 'object' && body !== null ? (body as { room?: unknown }).room : undefined;
    // O'z socket xonasi va server boshqaradigan `user:` xonasidan chiqib bo'lmaydi
    if (typeof room === 'string' && room !== client.id && !/^user:/i.test(room)) await client.leave(room.toLowerCase());
    return { ok: true };
  }

  /** Foydalanuvchining barcha ulanishlarini uzadi (Redis adapter orqali — hamma instance'larda). */
  disconnectUser(userId: string): void {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }

  emit(room: string, event: string, payload: object): void {
    if (!this.server) {
      this.log.warn(`WS server tayyor emas: ${event} -> ${room}`);
      return;
    }
    this.server.to(room).emit(event, payload);
  }

  async matchState(matchId: string): Promise<SlotsState | undefined> {
    const r = await one<{ id: string; max_players: number; held_slots: number; confirmed_slots: number; status: string }>(
      this.db,
      sql`SELECT id, max_players, held_slots, confirmed_slots, status FROM matches WHERE id = ${matchId}`,
    );
    if (!r) return undefined;
    const taken = r.held_slots + r.confirmed_slots;
    return { match_id: r.id, available: Math.max(r.max_players - taken, 0), taken, max: r.max_players, status: r.status };
  }
}
