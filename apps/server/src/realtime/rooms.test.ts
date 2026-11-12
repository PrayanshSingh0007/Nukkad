import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, FLAG_AWAY, FLAG_GROUNDED } from '@nukkad/shared';
import { AWAY_AFTER_MS, FREE_AFTER_MS, ROOM_TTL_MS, RoomManager } from './rooms.ts';

function setup() {
  let time = 1_000_000;
  const rooms = new RoomManager(() => time);
  const room = rooms.create(12.92, 77.69);
  return { rooms, room, advance: (ms: number) => (time += ms) };
}
const at = (x: number, z: number, flags = 0) => ({ x, y: 10, z, yaw: 0, speed: 1, flags });

describe('rooms', () => {
  it('makes unguessable 12-character ids', () => {
    const { rooms, room } = setup();
    expect(room.id).toMatch(/^[a-z0-9]{12}$/);
    expect(rooms.create(0, 0).id).not.toBe(room.id);
  });

  it('caps a room at 8 players', () => {
    const { rooms, room } = setup();
    for (let i = 0; i < 8; i++) expect(rooms.join(room.id, `p${i}`, DEFAULT_LOOK).ok).toBe(true);
    expect(rooms.join(room.id, 'ninth', DEFAULT_LOOK)).toEqual({ ok: false, code: 'room_full' });
    expect(rooms.join('zzzzzzzzzzzz', 'x', DEFAULT_LOOK)).toEqual({ ok: false, code: 'room_not_found' });
  });

  it('gives your slot back after a short drop, and frees it after 60 s', () => {
    const { rooms, room, advance } = setup();
    const first = rooms.join(room.id, 'Ria', DEFAULT_LOOK);
    if (!first.ok) throw new Error('join failed');
    rooms.disconnect(room.id, first.member.slot);
    advance(5000);
    const back = rooms.join(room.id, 'Ria', DEFAULT_LOOK, first.member.token);
    expect(back).toMatchObject({ ok: true, rejoined: true });
    rooms.disconnect(room.id, first.member.slot);
    advance(FREE_AFTER_MS + 1);
    expect(rooms.sweep()).toEqual([{ roomId: room.id, slot: first.member.slot }]);
    expect(rooms.join(room.id, 'Ria', DEFAULT_LOOK, first.member.token)).toMatchObject({ ok: true, rejoined: false });
  });

  it('rejects impossible moves and positions outside the area', () => {
    const { rooms, room, advance } = setup();
    const joined = rooms.join(room.id, 'Sam', DEFAULT_LOOK);
    if (!joined.ok) throw new Error('join failed');
    const slot = joined.member.slot;
    expect(rooms.applyState(room.id, slot, at(0, 0))).toBe(true);
    advance(100);
    expect(rooms.applyState(room.id, slot, at(2, 0))).toBe(true); // 2 m in 0.1 s: fine (slack)
    advance(100);
    expect(rooms.applyState(room.id, slot, at(80, 0))).toBe(false); // 78 m in 0.1 s: no
    expect(rooms.applyState(room.id, slot, at(5000, 0))).toBe(false);
    expect(rooms.snapshot(room.id)[0].x).toBe(2);
    expect(joined.member.rejected).toBe(2);
  });

  it('marks silent players as away, and never lets a client set "away" itself', () => {
    const { rooms, room, advance } = setup();
    const joined = rooms.join(room.id, 'Sam', DEFAULT_LOOK);
    if (!joined.ok) throw new Error('join failed');
    rooms.applyState(room.id, joined.member.slot, at(0, 0, FLAG_GROUNDED | FLAG_AWAY));
    expect(rooms.snapshot(room.id)[0].flags).toBe(FLAG_GROUNDED);
    advance(AWAY_AFTER_MS + 1);
    expect(rooms.snapshot(room.id)[0].flags & FLAG_AWAY).toBe(FLAG_AWAY);
  });

  it('moves a whole room to a new place and forgets old positions', () => {
    const { rooms, room } = setup();
    const joined = rooms.join(room.id, 'Sam', DEFAULT_LOOK);
    if (!joined.ok) throw new Error('join failed');
    rooms.applyState(room.id, joined.member.slot, at(5, 5));
    expect(rooms.travel(room.id, 12.99, 77.69)).toMatchObject({ id: room.id, lat: 12.99, lng: 77.69 });
    expect(rooms.snapshot(room.id)).toEqual([]);
    expect(rooms.applyState(room.id, joined.member.slot, at(300, -200))).toBe(true); // no "too fast" at the new place
  });

  it('keeps an empty room for 24 h, then deletes it', () => {
    const { rooms, room, advance } = setup();
    const joined = rooms.join(room.id, 'Sam', DEFAULT_LOOK);
    if (!joined.ok) throw new Error('join failed');
    rooms.leave(room.id, joined.member.slot);
    advance(ROOM_TTL_MS - 1000);
    rooms.sweep();
    expect(rooms.get(room.id)).toBeDefined();
    advance(2000);
    rooms.sweep();
    expect(rooms.get(room.id)).toBeUndefined();
  });
});
