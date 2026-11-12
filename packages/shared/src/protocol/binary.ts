/**
 * The fast lane: tiny binary messages sent 15 times a second (PLAN §6.2).
 *
 * Your state (client → server), 13 bytes:
 *   type u8 · seq u16 · x i16 · y i16 · z i16 · yaw u16 · speed u8 · flags u8
 * Snapshot (server → everyone), 6 bytes + 11 per player:
 *   type u8 · serverTime u32 · count u8 · then per player: slot u8 · x · y · z · yaw · speed · flags
 *
 * x and z are stored in 2 cm steps (±655 m), y in 5 cm steps, yaw in 1/65536 of a turn,
 * speed in 0.1 m/s. All numbers little-endian.
 */
export const MSG_STATE = 1;
export const MSG_SNAPSHOT = 2;
export const STATE_BYTES = 13;
export const SNAPSHOT_HEADER_BYTES = 6;
export const SNAPSHOT_PLAYER_BYTES = 11;

/**
 * Flags bits. Bit 3 (away) is set only by the server. Bits 4–7: the vehicle code while riding
 * (FLAG_RIDING set), otherwise the emote (EMOTES index, 0 = none).
 */
/** What a player can do to hang out; the index travels in flags bits 4–7 when not riding. */
export const EMOTES = ['none', 'wave', 'dance', 'sit', 'talk'] as const;
export type Emote = (typeof EMOTES)[number];
export const FLAG_GROUNDED = 1;
export const FLAG_RIDING = 2;
export const FLAG_TALKING = 4;
export const FLAG_AWAY = 8;
export const CLIENT_FLAGS_MASK = 0xff & ~FLAG_AWAY;

const XZ_STEP = 0.02;
const Y_STEP = 0.05;
const TURN = Math.PI * 2;

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  /** Facing angle in radians. */
  yaw: number;
  /** Metres per second along the ground. */
  speed: number;
  flags: number;
}

export interface StateMessage extends PlayerState {
  seq: number;
}

export interface SnapshotEntry extends PlayerState {
  slot: number;
}

export interface Snapshot {
  serverTime: number;
  players: SnapshotEntry[];
}

const clampInt = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(value)));
const wrapYaw = (yaw: number): number => ((yaw % TURN) + TURN) % TURN;

function writeState(view: DataView, offset: number, s: PlayerState): void {
  view.setInt16(offset, clampInt(s.x / XZ_STEP, -32768, 32767), true);
  view.setInt16(offset + 2, clampInt(s.y / Y_STEP, -32768, 32767), true);
  view.setInt16(offset + 4, clampInt(s.z / XZ_STEP, -32768, 32767), true);
  view.setUint16(offset + 6, clampInt((wrapYaw(s.yaw) / TURN) * 65536, 0, 65535), true);
  view.setUint8(offset + 8, clampInt(s.speed * 10, 0, 255));
  view.setUint8(offset + 9, s.flags & 0xff);
}

function readState(view: DataView, offset: number): PlayerState {
  return {
    x: view.getInt16(offset, true) * XZ_STEP,
    y: view.getInt16(offset + 2, true) * Y_STEP,
    z: view.getInt16(offset + 4, true) * XZ_STEP,
    yaw: (view.getUint16(offset + 6, true) / 65536) * TURN,
    speed: view.getUint8(offset + 8) / 10,
    flags: view.getUint8(offset + 9),
  };
}

export function encodeState(s: StateMessage): ArrayBuffer {
  const buffer = new ArrayBuffer(STATE_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, MSG_STATE);
  view.setUint16(1, s.seq & 0xffff, true);
  writeState(view, 3, s);
  return buffer;
}

/** Returns null for anything that is not exactly a state message. */
export function decodeState(data: ArrayBuffer | Uint8Array): StateMessage | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength !== STATE_BYTES || bytes[0] !== MSG_STATE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { seq: view.getUint16(1, true), ...readState(view, 3) };
}

export function encodeSnapshot(snapshot: Snapshot): ArrayBuffer {
  const count = Math.min(255, snapshot.players.length);
  const buffer = new ArrayBuffer(SNAPSHOT_HEADER_BYTES + count * SNAPSHOT_PLAYER_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, MSG_SNAPSHOT);
  view.setUint32(1, snapshot.serverTime >>> 0, true);
  view.setUint8(5, count);
  for (let i = 0; i < count; i++) {
    const offset = SNAPSHOT_HEADER_BYTES + i * SNAPSHOT_PLAYER_BYTES;
    view.setUint8(offset, snapshot.players[i].slot);
    writeState(view, offset + 1, snapshot.players[i]);
  }
  return buffer;
}

export function decodeSnapshot(data: ArrayBuffer | Uint8Array): Snapshot | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < SNAPSHOT_HEADER_BYTES || bytes[0] !== MSG_SNAPSHOT) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint8(5);
  if (bytes.byteLength !== SNAPSHOT_HEADER_BYTES + count * SNAPSHOT_PLAYER_BYTES) return null;
  const players: SnapshotEntry[] = [];
  for (let i = 0; i < count; i++) {
    const offset = SNAPSHOT_HEADER_BYTES + i * SNAPSHOT_PLAYER_BYTES;
    players.push({ slot: view.getUint8(offset), ...readState(view, offset + 1) });
  }
  return { serverTime: view.getUint32(1, true), players };
}
