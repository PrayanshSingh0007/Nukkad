/**
 * The Area Pack: our own small file describing one place.
 * The server builds it once from OpenStreetMap + elevation data and caches it;
 * every player downloads the same pack, so everyone builds the same world.
 *
 * Coordinates are whole decimetres in the local flat world (x = east, z = south),
 * stored as flat arrays: [x0, z0, x1, z1, …].
 */

export type BuildingKind =
  | 'house'
  | 'apartments'
  | 'commercial'
  | 'retail'
  | 'industrial'
  | 'civic'
  | 'religious'
  | 'shed'
  | 'roof'
  | 'generic';

export interface PackBuilding {
  /** OpenStreetMap id — used as the seed for colours and guesses. */
  id: number;
  kind: BuildingKind;
  /** Height of the top above the building's ground level, in metres. */
  h: number;
  /** Height of the underside when the shape floats (carports, upper building parts). */
  minH?: number;
  /** Number of floors, used to draw window rows. */
  floors: number;
  /** 1 when the height came from our rules instead of map tags. */
  guessed?: 1;
  /** Outer outline; positive signed area in (x, z). */
  ring: number[];
  /** Courtyards. */
  holes?: number[][];
}

export type LineKind =
  | 'motorway'
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'living'
  | 'service'
  | 'track'
  | 'pedestrian'
  | 'footway'
  | 'steps'
  | 'cycleway'
  | 'construction'
  | 'rail'
  | 'river'
  | 'stream';

export interface PackLine {
  id: number;
  kind: LineKind;
  /** Total width in metres. */
  w: number;
  pts: number[];
}

export type AreaKind =
  | 'water'
  | 'pool'
  | 'forest'
  | 'park'
  | 'grass'
  | 'scrub'
  | 'pitch'
  | 'playground'
  | 'sand'
  | 'rock'
  | 'wetland'
  | 'farmland'
  | 'cemetery'
  | 'parking'
  | 'plaza'
  | 'dirt'
  | 'residential'
  | 'commercial'
  | 'industrial';

export interface PackArea {
  id: number;
  kind: AreaKind;
  ring: number[];
  holes?: number[][];
}

export type PointKind = 'tree' | 'lamp' | 'bench';

/** Single things that really are on the map, per kind, as flat [x0, z0, x1, z1, …] lists. */
export type PackPoints = Record<PointKind, number[]>;

export interface PackTerrain {
  /** Samples per side (121 for a 1.2 km area). */
  size: number;
  /** Metres between samples. */
  cell: number;
  /** Real elevation (metres above sea level) of height 0. */
  base: number;
  /** 1 when elevation data was missing and the ground is simply flat. */
  flat?: 1;
  /** Heights in whole centimetres above `base`, row by row from north to south. */
  heights: number[];
}

export interface PackStats {
  buildings: number;
  heightsGuessed: number;
  roadKm: number;
  areas: number;
  mappedTrees: number;
  mappedLamps: number;
}

export interface AreaPack {
  /** Pack format version. */
  v: number;
  id: string;
  lat: number;
  lng: number;
  halfSize: number;
  /** IANA time zone of the place, e.g. "Asia/Kolkata" (for the day-night cycle). */
  timeZone: string;
  /** Credit lines that must be shown wherever this world is shown. */
  attribution: string[];
  terrain: PackTerrain;
  buildings: PackBuilding[];
  lines: PackLine[];
  areas: PackArea[];
  points: PackPoints;
  stats: PackStats;
}
