import { describe, expect, it } from 'vitest';
import { FLAG_AWAY, FLAG_GROUNDED, SNAPSHOT_HEADER_BYTES, SNAPSHOT_PLAYER_BYTES, STATE_BYTES, decodeSnapshot, decodeState, encodeSnapshot, encodeState } from './binary.ts';
import { cleanName, parseClientMessage, parseServerMessage } from './messages.ts';

const state = { seq: 513, x: -123.45, y: 17.3, z: 599.98, yaw: 1.25, speed: 4.6, flags: FLAG_GROUNDED };

describe('binary fast lane', () => {
  it('packs a state into 13 bytes and back within rounding', () => {
    const buffer = encodeState(state);
    expect(buffer.byteLength).toBe(STATE_BYTES);
    const back = decodeState(buffer)!;
    expect(back.seq).toBe(513);
    expect(back.x).toBeCloseTo(-123.45, 1);
    expect(back.y).toBeCloseTo(17.3, 1);
    expect(back.z).toBeCloseTo(599.98, 1);
    expect(back.yaw).toBeCloseTo(1.25, 3);
    expect(back.speed).toBeCloseTo(4.6, 5);
    expect(back.flags).toBe(FLAG_GROUNDED);
  });

  it('makes an 8-player snapshot of 94 bytes', () => {
    const players = Array.from({ length: 8 }, (_, slot) => ({ ...state, slot, flags: slot === 3 ? FLAG_AWAY : 0 }));
    const buffer = encodeSnapshot({ serverTime: 123456, players });
    expect(buffer.byteLength).toBe(SNAPSHOT_HEADER_BYTES + 8 * SNAPSHOT_PLAYER_BYTES);
    expect(buffer.byteLength).toBe(94);
    const back = decodeSnapshot(buffer)!;
    expect(back.serverTime).toBe(123456);
    expect(back.players.map((p) => p.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(back.players[3].flags).toBe(FLAG_AWAY);
  });

  it('rejects wrong sizes and wrong types', () => {
    expect(decodeState(new Uint8Array(12))).toBeNull();
    expect(decodeState(new Uint8Array(14))).toBeNull();
    const wrongType = new Uint8Array(encodeState(state));
    wrongType[0] = 9;
    expect(decodeState(wrongType)).toBeNull();
    const snapshot = new Uint8Array(encodeSnapshot({ serverTime: 1, players: [{ ...state, slot: 0 }] }));
    expect(decodeSnapshot(snapshot.slice(0, snapshot.length - 1))).toBeNull();
  });

  it('clamps values that do not fit instead of wrapping around', () => {
    const back = decodeState(encodeState({ ...state, x: 99999, speed: 999 }))!;
    expect(back.x).toBeCloseTo(655.34, 1);
    expect(back.speed).toBe(25.5);
  });
});

describe('slow lane validation', () => {
  it('cleans names', () => {
    expect(cleanName('  Ria   S  ')).toBe('Ria S');
    expect(cleanName('a\u0000b​c')).toBe('abc');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName('अर्जुन')).toBe('अर्जुन');
  });

  it('accepts a good join and drops unknown fields', () => {
    const join = parseClientMessage(JSON.stringify({ t: 'join', room: 'abcdefgh1234', name: ' Sam ', look: { skin: 1 }, extra: 'x', token: 'A'.repeat(24) }));
    expect(join).toEqual({ t: 'join', room: 'abcdefgh1234', name: 'Sam', look: { skin: 1, hair: 0, hairColor: 0, outfit: 0, color: 5, build: 0 }, token: 'A'.repeat(24) });
  });

  it('accepts a travel request and cleans its place name', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'travel', lat: 12.99, lng: 77.69, place: 'Mall\u0000 X' }))).toEqual({ t: 'travel', lat: 12.99, lng: 77.69, place: 'Mall X' });
    expect(parseClientMessage(JSON.stringify({ t: 'travel', lat: 120, lng: 77.69, place: 'x' }))).toBeNull();
  });

  it('rejects junk', () => {
    for (const bad of ['', 'nope', '[]', '{"t":"join","room":"short","name":"x"}', '{"t":"join","room":"abcdefgh1234","name":""}', '{"t":"teleport"}', '{"t":"ping","c":"x"}', 'x'.repeat(5000)]) {
      expect(parseClientMessage(bad)).toBeNull();
    }
    expect(parseServerMessage('{"t":"left","slot":9}')).toBeNull();
  });
});
