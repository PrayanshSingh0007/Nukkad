import type { RoomInfo } from '@nukkad/shared';

/** Small helpers for the REST API. Errors carry the server's friendly message. */
const base = (): string => import.meta.env.VITE_SERVER_URL ?? '';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base()}${path}`, init);
  } catch {
    throw new Error("Can't reach the Nukkad server. Check your internet and try again.");
  }
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(body.message ?? `Something went wrong (${response.status}).`);
  return body as T;
}

export const createRoom = (lat: number, lng: number): Promise<RoomInfo> =>
  call('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lng }) });

export const getRoom = (id: string): Promise<RoomInfo & { players: number }> => call(`/api/rooms/${id}`);

const NAME_KEY = 'nukkad.name';

/** Your display name is remembered only in this browser. */
export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // storage blocked
  }
}

export interface PlaceResult {
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

/** Real place search (OpenStreetMap). Only call this when the player presses Search/Enter. */
export const searchPlaces = async (query: string): Promise<PlaceResult[]> =>
  (await call<{ results: PlaceResult[] }>(`/api/search?q=${encodeURIComponent(query)}`)).results;

const AUTOJOIN_KEY = 'nukkad.autojoin';

/** After the room moves, the page reloads and joins again by itself (same tab only). */
export function setAutojoin(roomId: string): void {
  try {
    sessionStorage.setItem(AUTOJOIN_KEY, roomId);
  } catch {
    // storage blocked: the player presses Join once more
  }
}

export function takeAutojoin(roomId: string): boolean {
  try {
    const yes = sessionStorage.getItem(AUTOJOIN_KEY) === roomId;
    sessionStorage.removeItem(AUTOJOIN_KEY);
    return yes;
  } catch {
    return false;
  }
}
