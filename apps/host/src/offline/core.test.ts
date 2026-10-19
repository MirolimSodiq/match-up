import { describe, expect, it } from 'vitest';
import {
  applyEvents,
  autoSplit,
  backoffMs,
  distanceFromDetail,
  type QueuedEvent,
  resolveResults,
  type RosterEntry,
  rosterCounts,
  summarize,
  toWire,
} from './core';

const roster: RosterEntry[] = [
  { participant_id: 'a', display_name: 'Aziz', status: 'confirmed', side_no: null, checked_in_at: null, is_guest: false },
  { participant_id: 'b', display_name: 'Bek', status: 'checked_in', side_no: 1, checked_in_at: '2026-10-19T15:50:00Z', is_guest: false },
  { participant_id: 'c', display_name: 'Cho‘lpon', status: 'confirmed', side_no: null, checked_in_at: null, is_guest: true },
];

let seq = 0;
const ev = (over: Partial<QueuedEvent>): QueuedEvent => ({
  client_event_id: `e${++seq}`,
  match_id: 'm',
  user_id: 'host',
  action: 'check_in',
  method: 'manual',
  participant_id: 'a',
  occurred_at: '2026-10-19T16:00:00Z',
  state: 'pending',
  attempts: 0,
  ...over,
});

const FETCHED = 1_000;

describe('applyEvents — roster + lokal navbat', () => {
  it("navbatdagi check-in darhol 'keldi' va pending", () => {
    const v = applyEvents(roster, [ev({ participant_id: 'a' })], FETCHED);
    expect(v.find((p) => p.participant_id === 'a')).toMatchObject({ status: 'checked_in', pending: true, checked_in_at: '2026-10-19T16:00:00Z' });
    expect(rosterCounts(v)).toEqual({ checked: 2, waiting: 1, noShow: 0, total: 3 });
  });

  it('event’lar navbat tartibida: check_in -> undo -> no_show', () => {
    const v = applyEvents(roster, [ev({}), ev({ action: 'undo' }), ev({ action: 'no_show' })], FETCHED);
    expect(v[0]).toMatchObject({ status: 'no_show', pending: true, checked_in_at: null });
  });

  it("server qabul qilgan, lekin roster undan oldin olingan — hali qo'llanadi", () => {
    const v = applyEvents(roster, [ev({ state: 'accepted', synced_at: FETCHED + 1 })], FETCHED);
    expect(v[0]).toMatchObject({ status: 'checked_in', pending: false });
  });

  it('roster sinxrondan keyin olingan — server holati ishlatiladi (ikki marta qo‘llanmaydi)', () => {
    const v = applyEvents(roster, [ev({ action: 'undo', participant_id: 'b', state: 'accepted', synced_at: FETCHED - 1 })], FETCHED);
    expect(v[1]).toMatchObject({ status: 'checked_in' });
  });

  it("duplicate — accepted kabi (server allaqachon qayd etgan)", () => {
    const v = applyEvents(roster, [ev({ state: 'duplicate', synced_at: FETCHED + 5 })], FETCHED);
    expect(v[0]?.status).toBe('checked_in');
  });

  it("rad etilgan event qo'llanmaydi, sababi ko'rsatiladi; keyingi amal sababni tozalaydi", () => {
    const rejected = ev({ state: 'rejected', reason: 'NOT_ON_ROSTER', synced_at: FETCHED + 1 });
    expect(applyEvents(roster, [rejected], FETCHED)[0]).toMatchObject({ status: 'confirmed', rejectedReason: 'NOT_ON_ROSTER' });
    expect(applyEvents(roster, [rejected, ev({})], FETCHED)[0]).toMatchObject({ status: 'checked_in', rejectedReason: undefined });
  });

  it("roster'da yo'q participant e'tiborsiz (sinxronda server hal qiladi)", () => {
    expect(applyEvents(roster, [ev({ participant_id: 'zzz' })], FETCHED)).toHaveLength(3);
  });
});

describe('sinxron natijalari', () => {
  it('javobdagi statuslar yoziladi, javobda yo‘qlari pending qoladi', () => {
    const events = [ev({ client_event_id: 'x1' }), ev({ client_event_id: 'x2' }), ev({ client_event_id: 'x3' })];
    const out = resolveResults(
      events,
      [
        { client_event_id: 'x1', status: 'accepted', reason: null },
        { client_event_id: 'x2', status: 'rejected', reason: 'TICKET_EXPIRED' },
      ],
      42,
    );
    expect(out.map((e) => [e.state, e.reason, e.synced_at])).toEqual([
      ['accepted', null, 42],
      ['rejected', 'TICKET_EXPIRED', 42],
      ['pending', undefined, undefined],
    ]);
    expect(summarize([{ status: 'accepted' }, { status: 'duplicate' }, { status: 'duplicate' }, { status: 'rejected' }])).toEqual({
      accepted: 1,
      duplicate: 2,
      rejected: 1,
    });
  });

  it('API shakli: QR — qr_payload, qo‘lda — participant_id; lokal maydonlar yuborilmaydi', () => {
    expect(toWire(ev({ client_event_id: 'q', method: 'qr', qr_payload: 'mu1.a.b' }))).toEqual({
      client_event_id: 'q',
      action: 'check_in',
      method: 'qr',
      qr_payload: 'mu1.a.b',
      occurred_at: '2026-10-19T16:00:00Z',
    });
    expect(toWire(ev({ client_event_id: 'w', action: 'no_show', display_name: 'Aziz' }))).toEqual({
      client_event_id: 'w',
      action: 'no_show',
      method: 'manual',
      participant_id: 'a',
      occurred_at: '2026-10-19T16:00:00Z',
    });
  });

  it('backoff: 2 s, 5 s, 15 s, 30 s, keyin 60 s', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([2_000, 5_000, 15_000, 30_000, 60_000, 60_000]);
  });
});

describe('yordamchilar', () => {
  it('OUTSIDE_GEOFENCE detail matnidan masofa', () => {
    expect(distanceFromDetail('Siz maydondan uzoqdasiz (1234 m)')).toBe(1234);
    expect(distanceFromDetail('Вы далеко от площадки (87 м)')).toBe(87);
    expect(distanceFromDetail(undefined)).toBeUndefined();
  });

  it("autoSplit: daraja bo'yicha ilon usulida teng bo'ladi", () => {
    const players = [
      { participant_id: '1', level: 'pro' },
      { participant_id: '2', level: 'advanced' },
      { participant_id: '3', level: 'intermediate' },
      { participant_id: '4', level: 'beginner' },
      { participant_id: '5', level: null },
    ];
    const split = autoSplit(players, [1, 2]);
    expect(Object.fromEntries(split)).toEqual({ '1': 1, '2': 2, '3': 2, '5': 1, '4': 1 });
    expect(autoSplit(players, []).size).toBe(0);
  });
});
