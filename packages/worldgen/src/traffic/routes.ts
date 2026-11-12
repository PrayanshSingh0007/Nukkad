import { UNITS_PER_METRE, hash32, makeRng } from '@nukkad/shared';
import type { AreaPack, LineKind } from '@nukkad/shared';

/**
 * Moving traffic. Each vehicle drives a long seeded route along the main roads and back,
 * on the LEFT of the road (India). Its position depends only on the route and a clock, so
 * every player in a room sees the same traffic without sending anything over the network.
 */
export const TRAFFIC_ROADS = new Set<LineKind>(['primary', 'secondary', 'tertiary', 'trunk']);
const SPEED: Partial<Record<LineKind, number>> = { trunk: 12, primary: 11, secondary: 10, tertiary: 8.5 };

export interface TrafficRoute {
  /** Centre line points, metres: [x0, z0, x1, z1, …]. */
  pts: Float32Array;
  /** Distance from the start to each point. */
  dist: Float32Array;
  length: number;
  /** How far left of the centre line the lane is, metres. */
  lane: number;
  speed: number;
  /** Vehicle kind index (see VEHICLE_KINDS) and colour variant. */
  kind: number;
  variant: number;
  /** Where on its trip the vehicle is at time 0, metres. */
  offset: number;
}

export interface TrafficPose {
  x: number;
  z: number;
  /** Facing angle (avatar convention: 0 = towards -z). */
  heading: number;
}

/** Traffic mix on a Bengaluru main road: lots of two-wheelers and autos. Kind indexes follow VEHICLE_KINDS. */
function pickKind(roll: number): number {
  if (roll < 0.38) return 4; // two-wheeler
  if (roll < 0.58) return 3; // auto
  if (roll < 0.72) return 0; // hatchback
  if (roll < 0.83) return 1; // sedan
  if (roll < 0.94) return 2; // SUV
  return 5; // bus
}

interface Edge {
  line: number;
  from: number;
  to: number;
}

/** Builds up to `count` routes. Roads are linked where their points touch (shared OSM nodes). */
export function buildTrafficRoutes(pack: AreaPack, count: number): TrafficRoute[] {
  const lines = pack.lines.filter((line) => TRAFFIC_ROADS.has(line.kind) && line.w >= 6);
  if (lines.length === 0) return [];
  // Graph: node = a point shared by any road, edges = consecutive points of a line.
  const nodes = new Map<string, number>();
  const coords: number[] = [];
  const adjacency: Edge[][] = [];
  const nodeOf = (x: number, z: number): number => {
    const key = `${x},${z}`;
    let id = nodes.get(key);
    if (id === undefined) {
      id = coords.length / 2;
      nodes.set(key, id);
      coords.push(x / UNITS_PER_METRE, z / UNITS_PER_METRE);
      adjacency.push([]);
    }
    return id;
  };
  lines.forEach((line, index) => {
    for (let i = 0; i + 3 < line.pts.length; i += 2) {
      const a = nodeOf(line.pts[i], line.pts[i + 1]);
      const b = nodeOf(line.pts[i + 2], line.pts[i + 3]);
      if (a === b) continue;
      adjacency[a].push({ line: index, from: a, to: b });
      adjacency[b].push({ line: index, from: b, to: a });
    }
  });

  const routes: TrafficRoute[] = [];
  const random = makeRng(hash32(pack.lines.length * 31 + pack.buildings.length, 120));
  const starts = adjacency.map((edges, id) => ({ id, edges })).filter((n) => n.edges.length > 0);
  for (let attempt = 0; attempt < count * 4 && routes.length < count; attempt++) {
    const start = starts[Math.floor(random() * starts.length)];
    let edge = start.edges[Math.floor(random() * start.edges.length)];
    const path = [edge.from];
    let length = 0;
    const visited = new Set<string>();
    while (length < 2500) {
      const key = `${Math.min(edge.from, edge.to)}-${Math.max(edge.from, edge.to)}`;
      if (visited.has(key)) break;
      visited.add(key);
      path.push(edge.to);
      length += Math.hypot(coords[edge.to * 2] - coords[edge.from * 2], coords[edge.to * 2 + 1] - coords[edge.from * 2 + 1]);
      const onward = adjacency[edge.to].filter((e) => e.to !== edge.from);
      if (onward.length === 0) break;
      // Prefer staying on the same road; sometimes turn at a junction.
      const same = onward.filter((e) => e.line === edge.line);
      edge = same.length > 0 && random() < 0.75 ? same[0] : onward[Math.floor(random() * onward.length)];
    }
    if (length < 150) continue;
    const pts = new Float32Array(path.length * 2);
    const dist = new Float32Array(path.length);
    path.forEach((id, i) => {
      pts[i * 2] = coords[id * 2];
      pts[i * 2 + 1] = coords[id * 2 + 1];
      if (i > 0) dist[i] = dist[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    });
    const line = lines[start.edges[0].line];
    const kind = pickKind(random());
    routes.push({
      pts,
      dist,
      length,
      lane: Math.min(line.w / 4 + 0.3, 2.6),
      speed: (SPEED[line.kind] ?? 9) * (kind === 5 ? 0.75 : 0.85 + random() * 0.3),
      kind,
      variant: Math.floor(random() * 8),
      offset: random() * length * 2,
    });
  }
  return routes;
}

/**
 * Where a vehicle is after driving `travelled` metres: out along the route, then back again
 * (a long trip, so the turn-around is rarely seen). The lane is on the left of travel.
 */
export function trafficPose(route: TrafficRoute, travelled: number): TrafficPose {
  const trip = route.length * 2;
  let s = (((travelled + route.offset) % trip) + trip) % trip;
  const back = s > route.length;
  if (back) s = trip - s;
  // Find the segment containing s.
  let lo = 0;
  let hi = route.dist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (route.dist[mid] <= s) lo = mid;
    else hi = mid;
  }
  const ax = route.pts[lo * 2];
  const az = route.pts[lo * 2 + 1];
  const bx = route.pts[hi * 2];
  const bz = route.pts[hi * 2 + 1];
  const segment = route.dist[hi] - route.dist[lo] || 1;
  const k = (s - route.dist[lo]) / segment;
  let dx = (bx - ax) / segment;
  let dz = (bz - az) / segment;
  if (back) {
    dx = -dx;
    dz = -dz;
  }
  // Left of the direction of travel is (dz, -dx).
  return {
    x: ax + (bx - ax) * k + dz * route.lane,
    z: az + (bz - az) * k - dx * route.lane,
    heading: Math.atan2(-dx, -dz),
  };
}
