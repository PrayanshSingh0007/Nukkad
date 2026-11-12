import { ELEVATION_ATTRIBUTION, OSM_ATTRIBUTION, PACK_VERSION, UNITS_PER_METRE, makeProjector } from '@nukkad/shared';
import type { AreaKind, AreaPack, AreaRef, PackArea, PackLine, PackPoints, PackTerrain, PointKind } from '@nukkad/shared';
import { clipLineToSquare, clipRingToSquare } from '../geom/clip.ts';
import { cleanRing, orientRing, pointInRing, signedArea } from '../geom/polygon.ts';
import type { OsmLatLon, OsmRelation, OsmTags, OsmWay, OverpassResponse } from './osmTypes.ts';
import { draftBuilding, finishBuildings, quantizeRing } from './packBuildings.ts';
import type { BuildingDraft } from './packBuildings.ts';
import { assembleRings, isClosed } from './rings.ts';
import { cleanPlaceName } from '@nukkad/shared';
import { buildCompounds } from './compounds.ts';
import { buildPlaces, knownPlace } from './places.ts';
import type { Campus, KnownPlace, NamedComplex, PointPlace } from './places.ts';
import { classifyArea, classifyLine } from './tags.ts';

export interface BuildPackInput {
  ref: AreaRef;
  osm: OverpassResponse;
  terrain: PackTerrain;
  timeZone: string;
}

const MIN_AREA_M2 = 8;
const TREE_ROW_STEP_M = 8;
const NOT_ROADS = new Set(['rail', 'river', 'stream']);

const isBuilding = (value: string | undefined): boolean => value !== undefined && value !== 'no';
const notNull = (point: OsmLatLon | null): point is OsmLatLon => point !== null;

/** OpenStreetMap answer + height grid → the Area Pack every player downloads (PLAN §5, step 3). */
export function buildPack(input: BuildPackInput): AreaPack {
  const { ref, osm, terrain, timeZone } = input;
  const half = ref.halfSize;
  const projector = makeProjector(ref.lat, ref.lng);
  const toLocal = (points: OsmLatLon[]): number[] => {
    const out: number[] = [];
    for (const point of points) out.push(...projector.toLocal(point.lat, point.lon));
    return out;
  };
  const inside = (x: number, z: number): boolean => Math.abs(x) <= half && Math.abs(z) <= half;

  const outlines: BuildingDraft[] = [];
  const parts: BuildingDraft[] = [];
  const lines: PackLine[] = [];
  const areas: PackArea[] = [];
  const points: PackPoints = { tree: [], lamp: [], bench: [] };
  let roadMetres = 0;
  /** Buildings and points the map says are a shop, school, office… (kind only, never the name). */
  const placeOfBuilding = new Map<number, KnownPlace>();
  const placePoints: PointPlace[] = [];
  const complexes: NamedComplex[] = [];
  const campuses: Campus[] = [];
  const notePlace = (id: number, tags: OsmTags): void => {
    const known = knownPlace(tags);
    if (known) placeOfBuilding.set(id, known);
  };
  /** Named housing areas ("Assetz East Point") become a sign at their gate. */
  const noteComplex = (tags: OsmTags, ring: number[]): void => {
    const name = cleanPlaceName(tags['name:en'] ?? tags.name);
    if (name && tags.landuse === 'residential') complexes.push({ name, ring });
    // A named school ground, hospital or mall site drawn as an outline (not a building).
    const known = tags.amenity || tags.shop ? knownPlace(tags) : null;
    if (known?.name && !isBuilding(tags.building)) campuses.push({ kind: known.kind, name: known.name, ring });
  };

  const addPoint = (kind: PointKind, x: number, z: number): void => {
    if (inside(x, z)) points[kind].push(Math.round(x * UNITS_PER_METRE), Math.round(z * UNITS_PER_METRE));
  };

  const addLine = (id: number, tags: OsmTags, pts: number[]): void => {
    const line = classifyLine(tags);
    if (!line) return;
    for (const piece of clipLineToSquare(pts, half)) {
      const quantized: number[] = [];
      for (let i = 0; i < piece.length; i += 2) {
        const x = Math.round(piece[i] * UNITS_PER_METRE);
        const z = Math.round(piece[i + 1] * UNITS_PER_METRE);
        const n = quantized.length;
        if (n >= 2 && quantized[n - 2] === x && quantized[n - 1] === z) continue;
        if (n >= 2 && !NOT_ROADS.has(line.kind)) {
          roadMetres += Math.hypot(x - quantized[n - 2], z - quantized[n - 1]) / UNITS_PER_METRE;
        }
        quantized.push(x, z);
      }
      if (quantized.length >= 4) {
        lines.push({ id, kind: line.kind, w: Math.round(line.width * 10) / 10, pts: quantized });
      }
    }
  };

  const addArea = (id: number, kind: AreaKind, outer: number[], holes: number[][]): void => {
    const ring = orientRing(cleanRing(clipRingToSquare(outer, half), 0.05), true);
    if (ring.length < 6 || signedArea(ring) < MIN_AREA_M2) return;
    const area: PackArea = { id, kind, ring: quantizeRing(ring) };
    if (area.ring.length < 6) return;
    const packHoles = holes
      .map((hole) => orientRing(cleanRing(clipRingToSquare(hole, half), 0.05), false))
      .filter((hole) => hole.length >= 6)
      .map(quantizeRing)
      .filter((hole) => hole.length >= 6);
    if (packHoles.length > 0) area.holes = packHoles;
    areas.push(area);
  };

  const addTreeRow = (pts: number[]): void => {
    let carried = TREE_ROW_STEP_M / 2;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const length = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
      while (carried <= length && length > 0) {
        const t = carried / length;
        addPoint('tree', pts[i] + (pts[i + 2] - pts[i]) * t, pts[i + 1] + (pts[i + 3] - pts[i + 1]) * t);
        carried += TREE_ROW_STEP_M;
      }
      carried -= length;
    }
  };

  const addWay = (way: OsmWay, tags: OsmTags): void => {
    const geometry = (way.geometry ?? []).filter(notNull);
    if (geometry.length < 2) return;
    const closed = isClosed(geometry);
    const pts = toLocal(geometry);
    const pushDraft = (list: BuildingDraft[]): void => {
      const draft = draftBuilding(way.id, tags, pts, [], half);
      if (draft) list.push(draft);
      notePlace(way.id, tags);
    };
    if (closed && isBuilding(tags.building)) return pushDraft(outlines);
    if (closed && isBuilding(tags['building:part'])) return pushDraft(parts);
    const isAreaHighway = tags.highway !== undefined && tags.area === 'yes' && closed;
    const isLineWaterway = tags.waterway !== undefined && tags.waterway !== 'riverbank' && tags.waterway !== 'dock';
    if (!isAreaHighway && (tags.highway || tags.railway || isLineWaterway)) return addLine(way.id, tags, pts);
    if (tags.natural === 'tree_row') return addTreeRow(pts);
    const kind = closed ? classifyArea(tags) : null;
    if (kind) addArea(way.id, kind, pts, []);
    if (closed) noteComplex(tags, pts);
  };

  const addRelation = (relation: OsmRelation, tags: OsmTags): void => {
    if (tags.type !== 'multipolygon') return;
    const outerPieces: OsmLatLon[][] = [];
    const innerPieces: OsmLatLon[][] = [];
    for (const member of relation.members ?? []) {
      if (member.type !== 'way' || !member.geometry) continue;
      (member.role === 'inner' ? innerPieces : outerPieces).push(member.geometry.filter(notNull));
    }
    const outers = assembleRings(outerPieces).map(toLocal);
    const inners = assembleRings(innerPieces).map(toLocal);
    const kind = isBuilding(tags.building) ? null : classifyArea(tags);
    outers.forEach((outer, index) => {
      const holes = inners.filter((inner) => pointInRing(inner[0], inner[1], outer));
      const id = index === 0 ? relation.id : relation.id * 8 + (index % 8);
      if (isBuilding(tags.building)) {
        const draft = draftBuilding(id, tags, outer, holes, half);
        if (draft) outlines.push(draft);
        notePlace(id, tags);
      } else {
        if (kind) addArea(id, kind, outer, holes);
        noteComplex(tags, outer);
      }
    });
  };

  for (const element of osm.elements) {
    const tags = element.tags;
    if (!tags) continue;
    if (element.type === 'node') {
      const [x, z] = projector.toLocal(element.lat, element.lon);
      if (tags.natural === 'tree') addPoint('tree', x, z);
      else if (tags.highway === 'street_lamp') addPoint('lamp', x, z);
      else if (tags.amenity === 'bench') addPoint('bench', x, z);
      else {
        const known = knownPlace(tags);
        if (known && inside(x, z)) placePoints.push({ ...known, x, z });
      }
    } else if (element.type === 'way') {
      addWay(element, tags);
    } else {
      addRelation(element, tags);
    }
  }

  const buildings = finishBuildings(outlines, parts);
  const compounds = buildCompounds(complexes, lines, buildings, half);
  const places = buildPlaces(buildings, placeOfBuilding, placePoints, lines, half, complexes, compounds, campuses);
  const attribution = terrain.flat ? [OSM_ATTRIBUTION] : [OSM_ATTRIBUTION, ELEVATION_ATTRIBUTION];
  return {
    v: PACK_VERSION,
    id: ref.id,
    lat: ref.lat,
    lng: ref.lng,
    halfSize: half,
    timeZone,
    attribution,
    terrain,
    buildings,
    lines,
    areas,
    points,
    places,
    compounds,
    stats: {
      places: places.length,
      realPlaces: places.filter((place) => place.real === 1).length,
      buildings: buildings.length,
      heightsGuessed: buildings.filter((building) => building.guessed === 1).length,
      roadKm: Math.round(roadMetres / 100) / 10,
      areas: areas.length,
      mappedTrees: points.tree.length / 2,
      mappedLamps: points.lamp.length / 2,
    },
  };
}
