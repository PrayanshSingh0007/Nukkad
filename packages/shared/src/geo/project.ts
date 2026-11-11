const EARTH_RADIUS_M = 6378137;
const DEG = Math.PI / 180;

/** Converts between lat/lng and the local flat world: x = east, z = south, in metres. */
export interface Projector {
  toLocal(lat: number, lng: number): [x: number, z: number];
  toGeo(x: number, z: number): [lat: number, lng: number];
}

/** Brings a longitude back into [-180, 180). */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * A simple "flat earth near this point" projection. Over a 1.2 km square the
 * error is a few millimetres, which is far below anything we draw.
 */
export function makeProjector(lat0: number, lng0: number): Projector {
  const metresPerDegLat = EARTH_RADIUS_M * DEG;
  const metresPerDegLng = metresPerDegLat * Math.cos(lat0 * DEG);
  return {
    toLocal: (lat, lng) => [wrapLng(lng - lng0) * metresPerDegLng, -(lat - lat0) * metresPerDegLat],
    toGeo: (x, z) => [lat0 - z / metresPerDegLat, wrapLng(lng0 + x / metresPerDegLng)],
  };
}

/** Fractional Web-Mercator tile coordinates (the grid used by map and elevation tiles). */
export function tileXY(lat: number, lng: number, zoom: number): [x: number, y: number] {
  const n = 2 ** zoom;
  const latRad = lat * DEG;
  const x = ((lng + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [x, y];
}
