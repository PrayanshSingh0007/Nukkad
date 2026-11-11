import type { AreaKind, BuildingKind, LineKind } from '@nukkad/shared';
import type { OsmTags } from './osmTypes.ts';

/** Tag tables: how OpenStreetMap tags become the few kinds of things Nukkad draws (PLAN §5.1). */

/** Understands "12", "12.5 m", "12,5", "40 ft". Returns metres, or null. */
export function parseMetres(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(-?\d+(?:[.,]\d+)?)\s*(m|metres?|meters?|ft|feet|')?\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? 'm').toLowerCase();
  return unit === 'ft' || unit === 'feet' || unit === "'" ? amount * 0.3048 : amount;
}

const BUILDING_KINDS: Record<string, BuildingKind> = {};
function addBuildingKinds(kind: BuildingKind, values: string): void {
  for (const value of values.split(' ')) BUILDING_KINDS[value] = kind;
}
addBuildingKinds('house', 'house detached semidetached_house terrace residential bungalow cabin farm static_caravan houseboat');
addBuildingKinds('apartments', 'apartments dormitory hotel');
addBuildingKinds('commercial', 'commercial office');
addBuildingKinds('retail', 'retail kiosk supermarket shop');
addBuildingKinds('industrial', 'industrial warehouse factory manufacture hangar');
addBuildingKinds(
  'civic',
  'school college university hospital civic public government kindergarten train_station transportation fire_station sports_hall stadium grandstand',
);
addBuildingKinds('religious', 'church mosque temple cathedral chapel synagogue shrine religious monastery');
addBuildingKinds('shed', 'shed garage garages hut greenhouse toilets service barn cowshed sty stable container tent');
addBuildingKinds('roof', 'roof carport');

export function buildingKind(tags: OsmTags): BuildingKind {
  const value = tags.building ?? tags['building:part'] ?? 'yes';
  const kind = BUILDING_KINDS[value];
  if (kind) return kind;
  return tags.amenity === 'place_of_worship' ? 'religious' : 'generic';
}

/** True for things that are below ground or indoors and must not be drawn on the surface. */
function isHidden(tags: OsmTags): boolean {
  const tunnel = tags.tunnel;
  if (tunnel && tunnel !== 'no' && tunnel !== 'building_passage') return true;
  return tags.location === 'underground' || tags.indoor === 'yes';
}

const ROADS: Record<string, [LineKind, number]> = {
  motorway: ['motorway', 15],
  motorway_link: ['motorway', 7],
  trunk: ['trunk', 13],
  trunk_link: ['trunk', 7],
  primary: ['primary', 11],
  primary_link: ['primary', 6.5],
  secondary: ['secondary', 9],
  secondary_link: ['secondary', 6],
  tertiary: ['tertiary', 7.5],
  tertiary_link: ['tertiary', 5.5],
  residential: ['residential', 6],
  unclassified: ['residential', 6],
  road: ['residential', 6],
  busway: ['residential', 6],
  living_street: ['living', 5],
  service: ['service', 3.5],
  track: ['track', 3],
  pedestrian: ['pedestrian', 5],
  footway: ['footway', 1.8],
  path: ['footway', 1.8],
  bridleway: ['footway', 1.8],
  steps: ['steps', 1.8],
  cycleway: ['cycleway', 2],
  construction: ['construction', 5],
};

const CAR_ROADS = new Set<LineKind>(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living']);

const RAILS: Record<string, number> = { rail: 3.2, light_rail: 3, subway: 3, tram: 2.6, monorail: 2.6, narrow_gauge: 2.6 };

const WATERWAYS: Record<string, [LineKind, number]> = {
  river: ['river', 12],
  canal: ['river', 8],
  stream: ['stream', 2.5],
  drain: ['stream', 2],
  ditch: ['stream', 1.5],
};

export interface LineClass {
  kind: LineKind;
  width: number;
}

/** Roads, paths, rails and small waterways → kind + total width in metres. Null = not drawn. */
export function classifyLine(tags: OsmTags): LineClass | null {
  if (isHidden(tags)) return null;
  const taggedWidth = parseMetres(tags.width);
  const hasWidth = taggedWidth !== null && taggedWidth >= 1 && taggedWidth <= 40;

  const road = tags.highway ? ROADS[tags.highway] : undefined;
  if (road) {
    const [kind, tableWidth] = road;
    if (hasWidth) return { kind, width: taggedWidth };
    const lanes = Number(tags.lanes);
    if (CAR_ROADS.has(kind) && Number.isFinite(lanes) && lanes >= 1 && lanes <= 12) {
      return { kind, width: Math.max(3, lanes * 3.2) };
    }
    const driveway = kind === 'service' && (tags.service === 'driveway' || tags.service === 'parking_aisle');
    return { kind, width: driveway ? 3 : tableWidth };
  }

  const railWidth = tags.railway ? RAILS[tags.railway] : undefined;
  if (railWidth) {
    // Metro lines without a bridge tag are almost always underground.
    if (tags.railway === 'subway' && !tags.bridge && tags.tunnel !== 'no') return null;
    return { kind: 'rail', width: railWidth };
  }

  const waterway = tags.waterway ? WATERWAYS[tags.waterway] : undefined;
  if (waterway) return { kind: waterway[0], width: hasWidth ? taggedWidth : waterway[1] };
  return null;
}

const NATURAL: Record<string, AreaKind> = {
  water: 'water',
  wood: 'forest',
  scrub: 'scrub',
  grassland: 'grass',
  heath: 'grass',
  sand: 'sand',
  beach: 'sand',
  bare_rock: 'rock',
  scree: 'rock',
  shingle: 'rock',
  wetland: 'wetland',
};

const LANDUSE: Record<string, AreaKind> = {
  reservoir: 'water',
  basin: 'water',
  forest: 'forest',
  grass: 'grass',
  meadow: 'grass',
  village_green: 'park',
  recreation_ground: 'park',
  farmland: 'farmland',
  orchard: 'farmland',
  vineyard: 'farmland',
  allotments: 'farmland',
  farmyard: 'farmland',
  plant_nursery: 'farmland',
  cemetery: 'cemetery',
  construction: 'dirt',
  brownfield: 'dirt',
  landfill: 'dirt',
  quarry: 'dirt',
  residential: 'residential',
  commercial: 'commercial',
  retail: 'commercial',
  industrial: 'industrial',
  railway: 'industrial',
};

const LEISURE: Record<string, AreaKind> = {
  swimming_pool: 'pool',
  park: 'park',
  garden: 'park',
  dog_park: 'park',
  nature_reserve: 'grass',
  golf_course: 'grass',
  common: 'grass',
  pitch: 'pitch',
  track: 'pitch',
  playground: 'playground',
};

/** Closed shapes on the ground → ground kind. Null = not drawn. */
export function classifyArea(tags: OsmTags): AreaKind | null {
  if (isHidden(tags)) return null;
  if (tags.waterway === 'riverbank' || tags.waterway === 'dock') return 'water';
  const natural = tags.natural ? NATURAL[tags.natural] : undefined;
  if (natural) return natural;
  const leisure = tags.leisure ? LEISURE[tags.leisure] : undefined;
  if (leisure) return leisure;
  if (tags.amenity === 'parking') return 'parking';
  if (tags.amenity === 'grave_yard') return 'cemetery';
  if (tags.highway && tags.area === 'yes') return 'plaza';
  const landuse = tags.landuse ? LANDUSE[tags.landuse] : undefined;
  return landuse ?? null;
}
