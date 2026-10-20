import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  REALTIME_PATH,
  type RealtimeBooking,
  type RealtimeCommands,
  type RealtimeEvents,
  type RealtimeRoom,
  type RealtimeSlots,
  type SubscribeAck,
} from '@matchup/contracts';
import { API_URL, refreshOnce } from '@/api/client';
import { tokens } from '@/auth/tokens';

/**
 * Socket.IO klienti (bitta ulanish butun ilova uchun). Xonalar ref-count bilan: ekran ochilganda
 * obuna, yopilganda bekor; hech kim obuna bo'lmasa ulanish yopiladi. Qayta ulanishda xonalarga
 * avtomatik qayta obuna bo'linadi va ack'dagi `state` bilan ekran sinxronlanadi.
 * Polling'ni to'ldiradi, o'rnini bosmaydi: WS uzilsa ham REST so'rovlari ishlayveradi.
 */
type Client = Socket<RealtimeEvents, RealtimeCommands>;
type RoomState = RealtimeSlots | RealtimeBooking;

let socket: Client | null = null;
const rooms = new Map<RealtimeRoom, { count: number; joined: boolean; onState: Set<(s: RoomState) => void> }>();
const statusListeners = new Set<() => void>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let authRetry: ReturnType<typeof setTimeout> | undefined;

const notify = () => statusListeners.forEach((fn) => fn());

async function join(s: Client, room: RealtimeRoom) {
  const entry = rooms.get(room);
  if (!entry) return;
  let ack: SubscribeAck;
  try {
    ack = await s.timeout(5000).emitWithAck('subscribe', { room });
  } catch {
    return; // timeout — keyingi qayta ulanishda yana urinadi
  }
  if (!ack.ok) {
    if (__DEV__) console.warn(`[ws] ${room}: ${ack.code}`);
    return;
  }
  entry.joined = true;
  if (ack.state) entry.onState.forEach((fn) => fn(ack.state!));
  notify();
}

function ensureSocket(): Client {
  if (socket) return socket;
  const s: Client = io(API_URL, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    autoConnect: false,
    reconnectionDelayMax: 10_000,
    // Har (qayta) ulanishda eng so'nggi access token; token'siz — faqat ochiq xonalar
    auth: (cb) => cb(tokens.access ? { token: tokens.access } : {}),
  });
  s.on('connect', () => {
    for (const room of rooms.keys()) void join(s, room);
  });
  s.on('disconnect', () => {
    rooms.forEach((r) => (r.joined = false));
    notify();
  });
  s.on('connect_error', (err) => {
    if (err.message !== 'UNAUTHORIZED') return; // tarmoq xatolari — socket.io o'zi qayta ulanadi
    // Middleware rad etdi (access token eskirgan): yangilab qo'lda qayta ulanamiz
    clearTimeout(authRetry);
    authRetry = setTimeout(() => {
      void refreshOnce()
        .catch(() => null)
        .finally(() => {
          if (rooms.size) s.connect();
        });
    }, 500);
  });
  socket = s;
  return s;
}

/** Login/logout'dan keyin: yangi token bilan qayta ulanish (xonalar saqlanadi). */
export function reconnectRealtime() {
  if (!socket) return;
  socket.disconnect();
  if (rooms.size) socket.connect();
}

function subscribe(room: RealtimeRoom, onState?: (s: RoomState) => void): () => void {
  const s = ensureSocket();
  clearTimeout(idleTimer);
  let entry = rooms.get(room);
  const first = !entry;
  if (!entry) rooms.set(room, (entry = { count: 0, joined: false, onState: new Set() }));
  entry.count++;
  if (onState) entry.onState.add(onState);
  if (!s.connected) s.connect();
  else if (first) void join(s, room);
  else if (entry.joined) notify();

  return () => {
    const e = rooms.get(room);
    if (!e) return;
    if (onState) e.onState.delete(onState);
    if (--e.count > 0) return;
    rooms.delete(room);
    if (s.connected) s.emit('unsubscribe', { room }, () => undefined);
    notify();
    // Ekranlar orasida o'tishda ulanish uzilib-ulanmasin
    if (!rooms.size) idleTimer = setTimeout(() => !rooms.size && s.disconnect(), 5000);
  };
}

const roomId = (room: RealtimeRoom) => room.slice(room.indexOf(':') + 1);

/**
 * Xonaga obuna + event handler. `live` — xonaga muvaffaqiyatli qo'shildi (UI'da "Jonli" belgisi).
 * Handler faqat shu xonaga tegishli payload'larni oladi (match_id / booking_id bo'yicha filtr).
 */
export function useRealtimeRoom<E extends keyof RealtimeEvents>(
  room: RealtimeRoom | null,
  event: E,
  handler: RealtimeEvents[E],
  onState?: (s: RoomState) => void,
): { live: boolean } {
  const handlerRef = useRef(handler);
  const stateRef = useRef(onState);
  handlerRef.current = handler;
  stateRef.current = onState;
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!room) return;
    const s = ensureSocket();
    const id = roomId(room);
    const kind = room.slice(0, room.indexOf(':'));
    const listener = (payload: Parameters<RealtimeEvents[E]>[0]) => {
      const p = payload as { match_id?: string; booking_id?: string };
      if (kind === 'match' && p.match_id !== id) return;
      if (kind === 'booking' && p.booking_id !== id) return;
      (handlerRef.current as (x: typeof payload) => void)(payload);
    };
    s.on(event, listener as never);
    const update = () => setLive(!!(s.connected && rooms.get(room)?.joined));
    statusListeners.add(update);
    const unsubscribe = subscribe(room, (st) => stateRef.current?.(st));
    update();
    return () => {
      s.off(event, listener as never);
      statusListeners.delete(update);
      unsubscribe();
      setLive(false);
    };
  }, [room, event]);

  return { live };
}
