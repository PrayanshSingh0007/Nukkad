/** Version of the Area Pack format. Bump it when the layout changes: old cached packs are then ignored. */
export const PACK_VERSION = 13;

/** Half the side of an area in metres. 600 → a 1.2 km square (the default for the API and the tests). */
export const DEFAULT_HALF_SIZE = 600;
/**
 * What the game asks for: 1800 → a 3.6 km square. Big enough that the Bellandur test area
 * reaches the real Outer Ring Road (1.6 km from its centre) for fast driving.
 */
export const GAME_HALF_SIZE = 1800;
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
