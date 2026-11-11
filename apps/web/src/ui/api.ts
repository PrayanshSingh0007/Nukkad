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
