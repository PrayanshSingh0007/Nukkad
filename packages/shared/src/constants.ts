/** Version of the Area Pack format. Bump it when the layout changes: old cached packs are then ignored. */
export const PACK_VERSION = 5;

/** Half the side of an area in metres. 600 → a 1.2 km square (1 km playable + 100 m margin). */
export const DEFAULT_HALF_SIZE = 600;
export const MIN_HALF_SIZE = 150;
export const MAX_HALF_SIZE = 600;

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
