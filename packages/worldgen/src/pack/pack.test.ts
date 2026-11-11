import { describe, expect, it } from 'vitest';
import { areaRefFor, makeProjector } from '@nukkad/shared';
import { buildHeightGrid } from '../terrain/heightGrid.ts';
import { signedArea } from '../geom/polygon.ts';
import { findSpawn } from '../chunk/spawn.ts';
import { buildPack } from './buildPack.ts';
import { buildingHeight } from './heights.ts';
import { draftBuilding, finishBuildings } from './packBuildings.ts';
import type { OsmElement, OsmLatLon } from './osmTypes.ts';
import { assembleRings } from './rings.ts';
import { buildingKind, classifyArea, classifyLine, parseMetres } from './tags.ts';

const ref = areaRefFor(12.921, 77.695);
const projector = makeProjector(ref.lat, ref.lng);
/** Local metres → the lat/lon objects OpenStreetMap would give us. */
const geo = (...xz: number[]): OsmLatLon[] => {
  const out: OsmLatLon[] = [];
  for (let i = 0; i < xz.length; i += 2) {
    const [lat, lon] = projector.toGeo(xz[i], xz[i + 1]);
    out.push({ lat, lon });
  }
  return out;
};
const packOf = (elements: OsmElement[]) =>
  buildPack({ ref, osm: { elements }, terrain: buildHeightGrid(ref, null), timeZone: 'Asia/Kolkata' });

describe('tag rules', () => {
  it('reads lengths with units', () => {
    expect(parseMetres('12')).toBe(12);
    expect(parseMetres('12.5 m')).toBe(12.5);
    expect(parseMetres('12,5')).toBe(12.5);
    expect(parseMetres('40 ft')).toBeCloseTo(12.19, 2);
    expect(parseMetres('tall')).toBeNull();
    expect(parseMetres(undefined)).toBeNull();
  });

  it('classifies buildings, roads and ground', () => {
    expect(buildingKind({ building: 'detached' })).toBe('house');
    expect(buildingKind({ building: 'yes', amenity: 'place_of_worship' })).toBe('religious');
    expect(buildingKind({ building: 'yes' })).toBe('generic');
    expect(classifyLine({ highway: 'residential' })).toEqual({ kind: 'residential', width: 6 });
    expect(classifyLine({ highway: 'primary', lanes: '4' })).toEqual({ kind: 'primary', width: 12.8 });
    expect(classifyLine({ highway: 'footway', width: '3' })).toEqual({ kind: 'footway', width: 3 });
    expect(classifyLine({ highway: 'secondary', tunnel: 'yes' })).toBeNull();
    expect(classifyLine({ railway: 'subway' })).toBeNull();
    expect(classifyLine({ railway: 'subway', bridge: 'viaduct' })?.kind).toBe('rail');
    expect(classifyLine({ highway: 'proposed' })).toBeNull();
    expect(classifyArea({ leisure: 'park' })).toBe('park');
    expect(classifyArea({ natural: 'water' })).toBe('water');
    expect(classifyArea({ highway: 'pedestrian', area: 'yes' })).toBe('plaza');
    expect(classifyArea({ shop: 'bakery' })).toBeNull();
  });
});

describe('building heights (PLAN §5.1)', () => {
  it('uses the height tag first and never changes it', () => {
    expect(buildingHeight({ height: '40 ft', 'building:levels': '9' }, 'house', 100, 1)).toMatchObject({ h: 12.2, guessed: false });
  });

  it('uses floors × 3 m + 0.5 m next', () => {
    expect(buildingHeight({ 'building:levels': '4' }, 'generic', 100, 1)).toMatchObject({ h: 12.5, floors: 4, guessed: false });
  });

  it('guesses by type, with at most ±1 floor of variety', () => {
    const heights = new Set<number>();
    for (let id = 1; id <= 200; id++) {
      const result = buildingHeight({}, 'house', 100, id);
      expect(result.guessed).toBe(true);
      heights.add(result.h);
    }
    expect([...heights].sort((a, b) => a - b)).toEqual([3.5, 6.5, 9.5]);
    expect(buildingHeight({}, 'industrial', 900, 5).h).toBe(8);
    expect(buildingHeight({}, 'religious', 900, 5).h).toBe(9);
  });

  it('guesses unknown buildings by footprint', () => {
    expect(buildingHeight({}, 'generic', 20, 3).h).toBe(3.5);
    expect(buildingHeight({}, 'generic', 5000, 3).h).toBeGreaterThanOrEqual(12.5);
  });

  it('respects min_height and turns canopies into thin slabs', () => {
    expect(buildingHeight({ height: '20', min_height: '12' }, 'generic', 50, 1)).toMatchObject({ h: 20, minH: 12 });
    expect(buildingHeight({}, 'roof', 50, 1)).toMatchObject({ h: 4, minH: 3.6 });
  });
});

describe('apartment heights from neighbours, and our own height fixes', () => {
  /** A 20 × 20 m apartment block whose corner is at (x, 0). */
  const block = (id: number, x: number, tags: Record<string, string> = {}) =>
    draftBuilding(id, { building: 'apartments', ...tags }, [x, 0, x + 20, 0, x + 20, 20, x, 20], [], 600)!;
  const heightOf = (buildings: { id: number; h: number }[], id: number): number => buildings.find((b) => b.id === id)!.h;

  it('copies nearby mapped towers when at least two are known', () => {
    const drafts = [block(1, 0), block(2, 100, { 'building:levels': '16' }), block(3, 200, { 'building:levels': '16' }), block(4, -500)];
    const buildings = finishBuildings(drafts, [], {});
    expect(heightOf(buildings, 1)).toBe(48.5); // 16 floors, like its neighbours
    expect(buildings.find((b) => b.id === 1)!.guessed).toBe(1); // still marked as a guess
    expect(heightOf(buildings, 4)).toBeLessThan(20); // too far away: the normal guess
  });

  it('does not copy a single lonely tower, and never touches other kinds', () => {
    const house = draftBuilding(9, { building: 'house' }, [40, 0, 50, 0, 50, 10, 40, 10], [], 600)!;
    const buildings = finishBuildings([block(1, 0), block(2, 100, { 'building:levels': '30' }), house], [], {});
    expect(heightOf(buildings, 1)).toBeLessThan(20);
    expect(heightOf(buildings, 9)).toBeLessThan(10);
  });

  it('lets a height fix win over tags and guesses', () => {
    const drafts = [block(1, 0), block(2, 100, { 'building:levels': '3' })];
    const buildings = finishBuildings(drafts, [], { 1: { levels: 12 }, 2: { height: 40 } });
    expect(buildings.find((b) => b.id === 1)).toMatchObject({ h: 36.5, floors: 12 });
    expect(buildings.find((b) => b.id === 1)!.guessed).toBeUndefined();
    expect(heightOf(buildings, 2)).toBe(40);
  });
});

describe('ring assembly', () => {
  it('joins loose pieces into a closed ring, in any direction', () => {
    const [a, b, c, d] = geo(0, 0, 10, 0, 10, 10, 0, 10);
    const rings = assembleRings([
      [a, b],
      [c, b],
      [c, d, a],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
  });

  it('drops pieces that never close', () => {
    const [a, b, c] = geo(0, 0, 10, 0, 10, 10);
    expect(assembleRings([[a, b, c]])).toEqual([]);
  });
});

describe('buildPack', () => {
  const house = { type: 'way', id: 11, tags: { building: 'house', 'building:levels': '2' }, geometry: geo(0, 0, 10, 0, 10, 8, 0, 8, 0, 0) } as const;

  it('converts a building to decimetres with a positive outline', () => {
    const pack = packOf([house]);
    expect(pack.buildings).toHaveLength(1);
    const building = pack.buildings[0];
    expect(building).toMatchObject({ id: 11, kind: 'house', h: 6.5, floors: 2 });
    expect(building.guessed).toBeUndefined();
    expect(signedArea(building.ring)).toBeCloseTo(8000, -1);
    expect(building.ring.every(Number.isInteger)).toBe(true);
  });

  it('drops buildings outside the area and junk shapes', () => {
    const far = { ...house, id: 12, geometry: geo(700, 0, 710, 0, 710, 8, 700, 8, 700, 0) };
    const sliver = { ...house, id: 13, geometry: geo(0, 0, 1, 0, 1, 1, 0, 0) };
    const open = { ...house, id: 14, geometry: geo(0, 0, 10, 0, 10, 8) };
    expect(packOf([far, sliver, open]).buildings).toHaveLength(0);
  });

  it('clips roads at the edge and measures them', () => {
    const road = { type: 'way', id: 21, tags: { highway: 'residential' }, geometry: geo(500, 0, 800, 0) } as const;
    const pack = packOf([road]);
    expect(pack.lines).toEqual([{ id: 21, kind: 'residential', w: 6, pts: [5000, 0, 6000, 0] }]);
    expect(pack.stats.roadKm).toBe(0.1);
  });

  it('builds a park with a pond-shaped hole from a multipolygon', () => {
    const [a, b, c, d] = geo(-100, -100, 100, -100, 100, 100, -100, 100);
    const [e, f, g, h] = geo(-10, -10, 10, -10, 10, 10, -10, 10);
    const relation = {
      type: 'relation',
      id: 31,
      tags: { type: 'multipolygon', leisure: 'park' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: [a, b, c] },
        { type: 'way', ref: 2, role: 'outer', geometry: [c, d, a] },
        { type: 'way', ref: 3, role: 'inner', geometry: [e, f, g, h, e] },
      ],
    } as const;
    const pack = packOf([relation as unknown as OsmElement]);
    expect(pack.areas).toHaveLength(1);
    expect(pack.areas[0].kind).toBe('park');
    expect(signedArea(pack.areas[0].ring)).toBeGreaterThan(0);
    expect(pack.areas[0].holes).toHaveLength(1);
    expect(signedArea(pack.areas[0].holes![0])).toBeLessThan(0);
  });

  it('replaces an outline by its detailed parts', () => {
    const part = { type: 'way', id: 15, tags: { 'building:part': 'yes', height: '30' }, geometry: geo(2, 2, 6, 2, 6, 6, 2, 6, 2, 2) } as const;
    const pack = packOf([house, part]);
    expect(pack.buildings).toHaveLength(1);
    expect(pack.buildings[0]).toMatchObject({ id: 15, kind: 'house', h: 30 });
  });

  it('spawns players on the street point nearest to the centre', () => {
    const road = (id: number, highway: string, ...xz: number[]) => ({ type: 'way', id, tags: { highway }, geometry: geo(...xz) }) as const;
    const pack = packOf([road(1, 'residential', 40, 30, 300, 30), road(2, 'motorway', 5, 5, 200, 5), road(3, 'footway', 550, 0, 590, 0)]);
    expect(findSpawn(pack)).toEqual([40, 30]); // not the motorway, not the path at the very edge
    expect(findSpawn(packOf([]))).toEqual([0, 0]);
  });

  it('keeps mapped trees and lamps, and is repeatable', () => {
    const [lat, lon] = projector.toGeo(50, 50);
    const tree = { type: 'node', id: 41, lat, lon, tags: { natural: 'tree' } } as const;
    const lamp = { type: 'node', id: 42, lat, lon, tags: { highway: 'street_lamp' } } as const;
    const first = packOf([house, tree, lamp]);
    expect(first.points).toEqual({ tree: [500, 500], lamp: [500, 500], bench: [] });
    expect(first.stats).toMatchObject({ buildings: 1, mappedTrees: 1, mappedLamps: 1 });
    expect(JSON.stringify(packOf([house, tree, lamp]))).toBe(JSON.stringify(first));
  });
});
