import { describe, expect, it } from 'vitest';
import type { AreaPack } from '@nukkad/shared';
import { buildTrafficRoutes, trafficPose } from './routes.ts';

/** A plus-shaped pair of main roads crossing at the origin, 400 m each way. */
const pack = {
  halfSize: 600,
  buildings: [],
  lines: [
    { id: 1, kind: 'secondary', w: 9, pts: [-4000, 0, 0, 0, 4000, 0] },
    { id: 2, kind: 'tertiary', w: 7.5, pts: [0, -4000, 0, 0, 0, 4000] },
    { id: 3, kind: 'residential', w: 6, pts: [100, 100, 900, 100] },
  ],
} as unknown as AreaPack;

describe('traffic routes', () => {
  const routes = buildTrafficRoutes(pack, 6);

  it('builds routes only on main roads, linked at junctions', () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.length).toBeGreaterThanOrEqual(150);
      for (let i = 0; i < route.pts.length; i += 2) {
        const onMain = Math.abs(route.pts[i]) < 1e-6 || Math.abs(route.pts[i + 1]) < 1e-6;
        expect(onMain).toBe(true); // never on the residential street
      }
    }
  });

  it('drives on the left of the road, both ways', () => {
    const route = { ...routes[0], pts: new Float32Array([-400, 0, 400, 0]), dist: new Float32Array([0, 800]), length: 800, offset: 0, lane: 2 };
    const going = trafficPose(route, 100); // heading east (+x): left is north (-z)
    expect(going.x).toBeCloseTo(-300);
    expect(going.z).toBeCloseTo(-2);
    const coming = trafficPose(route, 900); // on the way back (west): left is south (+z)
    expect(coming.x).toBeCloseTo(300);
    expect(coming.z).toBeCloseTo(2);
  });

  it('is the same on every device', () => {
    const again = buildTrafficRoutes(pack, 6);
    expect(again.map((r) => [r.length, r.kind, r.offset])).toEqual(routes.map((r) => [r.length, r.kind, r.offset]));
  });
});
