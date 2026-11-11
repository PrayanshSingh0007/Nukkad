import { randomBytes, randomInt } from 'node:crypto';
import { CLIENT_FLAGS_MASK, FLAG_AWAY, MAX_PLAYERS } from '@nukkad/shared';
import type { AvatarLook, PlayerInfo, PlayerState, RoomInfo, SnapshotEntry } from '@nukkad/shared';

/**
 * Rooms and who is in them. The server is the only authority on membership (PLAN §6.5).
 * Pure logic with an injectable clock, so every rule is unit-tested without sockets.
 * Nothing here is written to disk: names and looks live only while you are connected.
 */
export const AWAY_AFTER_MS = 10_000; // silent this long → others see you as "reconnecting…"
export const FREE_AFTER_MS = 60_000; // gone this long → your slot is free again
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // an empty room's link keeps working this long
const MAX_SPEED = 25; // m/s — faster than any walk or scooter ride
const MOVE_SLACK_M = 3;
const AREA_LIMIT_M = 640; // area half size (600) + margin

export interface Member {
  slot: number;
  name: string;
  look: AvatarLook;
  token: string;
  state: PlayerState | null;
  lastStateAt: number;
  /** When the last update that passed the checks arrived. */
  acceptedAt: number;
  connected: boolean;
  disconnectedAt: number;
  /** States rejected by the sanity checks (shown in logs/stress reports). */
  rejected: number;
}

export interface Room {
  info: RoomInfo;
  createdAt: number;
  emptySince: number | null;
  members: (Member | null)[];
}

export type JoinResult = { ok: true; member: Member; rejoined: boolean } | { ok: false; code: 'room_not_found' | 'room_full' };

const ROOM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newRoomId(): string {
  let id = '';
  for (let i = 0; i < 12; i++) id += ROOM_CHARS[randomInt(ROOM_CHARS.length)];
  return id;
}

const newToken = (): string => randomBytes(18).toString('base64url'); // 24 characters

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  create(lat: number, lng: number): RoomInfo {
    let id = newRoomId();
    while (this.rooms.has(id)) id = newRoomId();
    const info = { id, lat, lng };
    this.rooms.set(id, { info, createdAt: this.now(), emptySince: this.now(), members: new Array(MAX_PLAYERS).fill(null) });
    return info;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Joins a room. A valid token from the last 60 s gets its old slot back (reconnect). */
  join(roomId: string, name: string, look: AvatarLook, token?: string): JoinResult {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, code: 'room_not_found' };
    const time = this.now();
    if (token) {
      const member = room.members.find((m) => m?.token === token);
      if (member) {
        Object.assign(member, { name, look, connected: true, lastStateAt: time });
        room.emptySince = null;
        return { ok: true, member, rejoined: true };
      }
    }
    const slot = room.members.indexOf(null);
    if (slot < 0) return { ok: false, code: 'room_full' };
    const member: Member = { slot, name, look, token: newToken(), state: null, lastStateAt: time, acceptedAt: time, connected: true, disconnectedAt: 0, rejected: 0 };
    room.members[slot] = member;
    room.emptySince = null;
    return { ok: true, member, rejoined: false };
  }

  /** The connection dropped. The slot is kept for a while so the player can come back. */
  disconnect(roomId: string, slot: number): void {
    const member = this.rooms.get(roomId)?.members[slot];
    if (member) {
      member.connected = false;
      member.disconnectedAt = this.now();
    }
  }

  /** The player left on purpose: free the slot now. */
  leave(roomId: string, slot: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.members[slot] = null;
    if (room.members.every((m) => m === null)) room.emptySince = this.now();
  }

  setLook(roomId: string, slot: number, look: AvatarLook): void {
    const member = this.rooms.get(roomId)?.members[slot];
    if (member) member.look = look;
  }

  /**
   * Sanity-checks a position update (PLAN §6.4): inside the area and no faster than a
   * scooter. Rejected updates are ignored; the player keeps their last good position.
   */
  applyState(roomId: string, slot: number, state: PlayerState): boolean {
    const member = this.rooms.get(roomId)?.members[slot];
    if (!member) return false;
    const time = this.now();
    const inside = Math.abs(state.x) <= AREA_LIMIT_M && Math.abs(state.z) <= AREA_LIMIT_M && state.y > -100 && state.y < 1600;
    let plausible = inside;
    if (inside && member.state) {
      const seconds = Math.max(0, time - member.acceptedAt) / 1000;
      const moved = Math.hypot(state.x - member.state.x, state.z - member.state.z);
      plausible = moved <= MAX_SPEED * seconds + MOVE_SLACK_M;
    }
    member.lastStateAt = time; // a rejected update still proves the player is there
    if (!plausible) {
      member.rejected++;
      return false;
    }
    member.state = { ...state, flags: state.flags & CLIENT_FLAGS_MASK };
    member.acceptedAt = time;
    return true;
  }

  /** Everyone with a known position, with the "away" flag set by the server. */
  snapshot(roomId: string): SnapshotEntry[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const time = this.now();
    const out: SnapshotEntry[] = [];
    for (const member of room.members) {
      if (!member?.state) continue;
      const away = !member.connected || time - member.lastStateAt > AWAY_AFTER_MS;
      out.push({ slot: member.slot, ...member.state, flags: member.state.flags | (away ? FLAG_AWAY : 0) });
    }
    return out;
  }

  players(roomId: string): PlayerInfo[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return room.members.filter((m): m is Member => m !== null).map((m) => ({ slot: m.slot, name: m.name, look: m.look }));
  }

  /**
   * Housekeeping, run every few seconds: frees slots of players gone for 60 s and
   * deletes rooms that have been empty for 24 h. Returns the slots freed per room.
   */
  sweep(): { roomId: string; slot: number }[] {
    const time = this.now();
    const freed: { roomId: string; slot: number }[] = [];
    for (const [id, room] of this.rooms) {
      for (const member of room.members) {
        if (member && !member.connected && time - member.disconnectedAt > FREE_AFTER_MS) {
          this.leave(id, member.slot);
          freed.push({ roomId: id, slot: member.slot });
        }
      }
      if (room.emptySince !== null && time - room.emptySince > ROOM_TTL_MS) this.rooms.delete(id);
    }
    return freed;
  }
}
