import { CHUNK_SIZE, DEFAULT_HALF_SIZE, MAX_HALF_SIZE, MIN_HALF_SIZE } from '../constants.ts';
import { makeProjector, wrapLng } from './project.ts';

/** One square piece of the real world that we turn into a Nukkad. */
export interface AreaRef {
  /** Cache key, e.g. `a_12921_77695_600`. */
  id: string;
  /** Centre, snapped to a ~100 m grid so nearby picks share one cached pack. */
  lat: number;
  lng: number;
  /** Half the side of the square in metres. */
  halfSize: number;
}

export interface GeoBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Web-Mercator tiles (our elevation source) stop near the poles. */
export const MAX_LAT = 84;

const ID_PATTERN = /^a_(-?\d{1,5})_(-?\d{1,6})_(\d{3})$/;

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= MAX_LAT &&
    Math.abs(lng) <= 180
  );
}

/** Rounds a radius to a whole number of chunks and keeps it inside the allowed range. */
export function clampHalfSize(halfSize: number): number {
  const snapped = Math.round(halfSize / CHUNK_SIZE) * CHUNK_SIZE;
  return Math.min(MAX_HALF_SIZE, Math.max(MIN_HALF_SIZE, snapped));
}

export function areaRefFor(lat: number, lng: number, halfSize: number = DEFAULT_HALF_SIZE): AreaRef {
  const latK = Math.round(lat * 1000);
  let lngK = Math.round(wrapLng(lng) * 1000);
  if (lngK >= 180000) lngK -= 360000;
  const half = clampHalfSize(halfSize);
  return { id: `a_${latK}_${lngK}_${half}`, lat: latK / 1000, lng: lngK / 1000, halfSize: half };
}

/** Parses an area id. Returns null for anything that is not exactly an id we would produce. */
export function parseAreaId(id: string): AreaRef | null {
  const match = ID_PATTERN.exec(id);
  if (!match) return null;
  const lat = Number(match[1]) / 1000;
  const lng = Number(match[2]) / 1000;
  if (!isValidLatLng(lat, lng)) return null;
  const ref = areaRefFor(lat, lng, Number(match[3]));
  return ref.id === id ? ref : null;
}

/** The lat/lng box of an area, optionally grown by a margin in metres. */
export function areaGeoBox(ref: AreaRef, marginM = 0): GeoBox {
  const projector = makeProjector(ref.lat, ref.lng);
  const reach = ref.halfSize + marginM;
  const [north, west] = projector.toGeo(-reach, -reach);
  const [south, east] = projector.toGeo(reach, reach);
  return { south, west, north, east };
}
