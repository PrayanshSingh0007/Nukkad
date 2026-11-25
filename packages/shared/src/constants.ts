/** Version of the Area Pack format. Bump it when the layout changes: old cached packs are then ignored. */
export const PACK_VERSION = 14;

/** Half the side of an area in metres. 600 → a 1.2 km square (the default for the API and the tests). */
export const DEFAULT_HALF_SIZE = 600;
/**
 * What the game shows: the square the owner marked on a map (2026-11-17). It runs from the
 * Outer Ring Road at Ecospace / Sakra hospital (top-left) to Sarjapur Road (bottom), about
 * 2.8 km on a side. Centre and size were worked out from landmarks; the data is OpenStreetMap.
 */
export const GAME_AREA = { lat: 12.922, lng: 77.692 } as const;
export const GAME_HALF_SIZE = 1350;
export const MIN_HALF_SIZE = 150;
export const MAX_HALF_SIZE = 1800;

/** Side of one streaming chunk in metres. */
export const CHUNK_SIZE = 150;

/** Distance between terrain height samples in metres. */
export const TERRAIN_CELL = 10;

/** Pack coordinates are whole decimetres (10 cm steps). */
export const UNITS_PER_METRE = 10;

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const ELEVATION_ATTRIBUTION = 'Elevation: Mapzen terrain tiles';

/** The built-in place used by the debug page and the tests. Change it before making the repo public. */
export const TEST_AREA = {
  label: 'Test area — Bellandur, Bengaluru',
  lat: 12.9206802,
  lng: 77.695322,
} as const;
