import { sanitizeLook } from '../avatar.ts';
import type { AvatarLook } from '../avatar.ts';

/** The slow lane: rare, readable JSON messages (PLAN §6.2). Every one is validated on arrival. */

export const MAX_PLAYERS = 8;
export const TICK_HZ = 15;
export const MAX_JSON_BYTES = 2048;

/** 12 characters from a–z and 0–9 (≈ 62 bits): impossible to guess. */
export const ROOM_ID_PATTERN = /^[a-z0-9]{12}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;

export interface PlayerInfo {
  slot: number;
  name: string;
  look: AvatarLook;
}

export interface RoomInfo {
  id: string;
  lat: number;
  lng: number;
}

export type ClientMessage =
  | { t: 'join'; room: string; name: string; look: AvatarLook; token?: string }
  | { t: 'look'; look: AvatarLook }
  | { t: 'ping'; c: number }
  | { t: 'leave' };

export type ErrorCode = 'bad_message' | 'room_not_found' | 'room_full' | 'slow_down' | 'bad_name' | 'server_error';

export type ServerMessage =
  | { t: 'welcome'; slot: number; token: string; room: RoomInfo; players: PlayerInfo[] }
  | { t: 'joined'; player: PlayerInfo }
  | { t: 'left'; slot: number }
  | { t: 'look'; slot: number; look: AvatarLook }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: ErrorCode; message: string };

const MAX_NAME = 16;

/**
 * Cleans a display name: removes control and invisible characters, squeezes spaces,
 * keeps 1–16 characters. Returns null when nothing usable is left.
 */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .normalize('NFC')
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = [...cleaned];
  if (characters.length === 0) return null;
  return characters.slice(0, MAX_NAME).join('').trim();
}

function parseJson(text: string): Record<string, unknown> | null {
  if (text.length > MAX_JSON_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Server side: turns a text frame into a known message, or null. Unknown fields are dropped. */
export function parseClientMessage(text: string): ClientMessage | null {
  const m = parseJson(text);
  if (!m) return null;
  switch (m.t) {
    case 'join': {
      if (typeof m.room !== 'string' || !ROOM_ID_PATTERN.test(m.room)) return null;
      const name = cleanName(m.name);
      if (!name) return null;
      const message: ClientMessage = { t: 'join', room: m.room, name, look: sanitizeLook(m.look) };
      if (typeof m.token === 'string' && TOKEN_PATTERN.test(m.token)) message.token = m.token;
      return message;
    }
    case 'look':
      return { t: 'look', look: sanitizeLook(m.look) };
    case 'ping':
      return typeof m.c === 'number' && Number.isFinite(m.c) ? { t: 'ping', c: m.c } : null;
    case 'leave':
      return { t: 'leave' };
    default:
      return null;
  }
}

/** Client side: the server is trusted more, but its messages are still checked for shape. */
export function parseServerMessage(text: string): ServerMessage | null {
  const m = parseJson(text);
  if (!m || typeof m.t !== 'string') return null;
  const isSlot = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < MAX_PLAYERS;
  const player = (v: unknown): PlayerInfo | null => {
    const p = v as Record<string, unknown> | null;
    if (!p || !isSlot(p.slot)) return null;
    const name = cleanName(p.name);
    return name ? { slot: p.slot, name, look: sanitizeLook(p.look) } : null;
  };
  switch (m.t) {
    case 'welcome': {
      const room = m.room as Record<string, unknown> | null;
      if (!isSlot(m.slot) || typeof m.token !== 'string' || !room || typeof room.id !== 'string') return null;
      if (typeof room.lat !== 'number' || typeof room.lng !== 'number' || !Array.isArray(m.players)) return null;
      const players = m.players.map(player).filter((p): p is PlayerInfo => p !== null);
      return { t: 'welcome', slot: m.slot, token: m.token, room: { id: room.id, lat: room.lat, lng: room.lng }, players };
    }
    case 'joined': {
      const p = player(m.player);
      return p ? { t: 'joined', player: p } : null;
    }
    case 'left':
      return isSlot(m.slot) ? { t: 'left', slot: m.slot } : null;
    case 'look':
      return isSlot(m.slot) ? { t: 'look', slot: m.slot, look: sanitizeLook(m.look) } : null;
    case 'pong':
      return typeof m.c === 'number' && typeof m.s === 'number' ? { t: 'pong', c: m.c, s: m.s } : null;
    case 'error':
      return typeof m.code === 'string' && typeof m.message === 'string' ? { t: 'error', code: m.code as ErrorCode, message: m.message } : null;
    default:
      return null;
  }
}
