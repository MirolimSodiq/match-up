import { describe, expect, it } from 'vitest';
import {
  applyMarkerResults,
  busyPositions,
  kickoffAt,
  MARKER_TTL_MS,
  matchClock,
  maxFileSize,
  minutesAvailable,
  pruneMarkers,
  type QueuedMarker,
  RECORDING_LIMITS,
  RESERVE_BYTES,
  undoAction,
  visibleMarkers,
} from './core';

const GiB = 1024 ** 3;

function marker(over: Partial<QueuedMarker> = {}): QueuedMarker {
  return {
    client_marker_id: 'k1',
    matchId: 'm1',
    userId: 'u1',
    kind: 'highlight',
    occurred_at: '2026-10-21T18:10:00.000Z',
    side: 'left',
    state: 'pending',
    created_at: 1,
    ...over,
  };
}

describe('disk', () => {
  it("joy: zaxiradan keyin daqiqalar (HEVC ~180 MB/daq)", () => {
    expect(minutesAvailable(RESERVE_BYTES, 'hevc')).toBe(0);
    expect(minutesAvailable(20 * GiB, 'hevc')).toBe(102);
    expect(minutesAvailable(20 * GiB, 'avc')).toBe(51);
  });

  it('maxFileSize: zaxira va server chegarasi', () => {
    expect(maxFileSize(GiB)).toBe(0);
    expect(maxFileSize(10 * GiB)).toBe(10 * GiB - RESERVE_BYTES);
    expect(maxFileSize(200 * GiB)).toBe(RECORDING_LIMITS.maxBytes);
  });
});

describe('pozitsiyalar', () => {
  it("boshqa telefon yozayotgan pozitsiya band; o'zimizniki va tugaganlari — yo'q", () => {
    const cameras = [
      { client_camera_id: 'a', position: 'left', status: 'recording' },
      { client_camera_id: 'b', position: 'right', status: 'uploading' },
      { client_camera_id: 'c', position: 'wide', status: 'recording' },
    ] as never;
    expect([...busyPositions({ cameras }, new Set(['c']))]).toEqual(['left']);
    expect(busyPositions(undefined, new Set()).size).toBe(0);
  });
});

describe('belgilar', () => {
  it("natija: qabul/takror -> synced (klip id bilan), rad -> rejected; bekor qilinayotganga tegilmaydi", () => {
    const out = applyMarkerResults(
      [marker(), marker({ client_marker_id: 'k2' }), marker({ client_marker_id: 'k3', state: 'deleting' })],
      [
        { client_marker_id: 'k1', status: 'accepted', marker: { highlight_id: 'h1' } },
        { client_marker_id: 'k2', status: 'rejected', reason: 'OUT_OF_WINDOW' },
        { client_marker_id: 'k3', status: 'duplicate' },
      ],
      50,
    );
    expect(out.map((m) => [m.state, m.highlight_id ?? m.reason])).toEqual([
      ['synced', 'h1'],
      ['rejected', 'OUT_OF_WINDOW'],
      ['deleting', undefined],
    ]);
  });

  it("bekor qilish: yuborilmagan/rad etilgan — lokal, serverdagi — DELETE", () => {
    expect(undoAction({ state: 'pending' })).toBe('drop');
    expect(undoAction({ state: 'rejected' })).toBe('drop');
    expect(undoAction({ state: 'synced' })).toBe('delete');
    expect(undoAction({ state: 'deleting' })).toBe('none');
  });

  it("ko'rinadigan belgilar (yangisi tepada) va kick-off — eng birinchisi", () => {
    const list = [
      marker({ client_marker_id: 'a', occurred_at: '2026-10-21T18:05:00.000Z', kind: 'kickoff', side: null, state: 'synced' }),
      marker({ client_marker_id: 'b', occurred_at: '2026-10-21T18:20:00.000Z' }),
      marker({ client_marker_id: 'c', occurred_at: '2026-10-21T18:00:00.000Z', kind: 'kickoff', side: null, state: 'deleting' }),
      marker({ client_marker_id: 'd', matchId: 'other' }),
    ];
    expect(visibleMarkers(list, 'm1').map((m) => m.client_marker_id)).toEqual(['b', 'a']);
    expect(kickoffAt(list, 'm1')).toBe('2026-10-21T18:05:00.000Z');
    expect(matchClock(Date.parse('2026-10-21T18:39:07.000Z'), kickoffAt(list, 'm1'))).toBe('34:07');
    expect(matchClock(0, undefined)).toBeUndefined();
  });

  it('jurnal: yuborilganlar 3 kundan keyin tozalanadi, navbatdagilar — hech qachon', () => {
    const now = 10 * MARKER_TTL_MS;
    const out = pruneMarkers([marker(), marker({ client_marker_id: 'old', state: 'synced', synced_at: now - MARKER_TTL_MS - 1 }), marker({ client_marker_id: 'new', state: 'synced', synced_at: now - 1 })], now);
    expect(out.map((m) => m.client_marker_id)).toEqual(['k1', 'new']);
  });
});
