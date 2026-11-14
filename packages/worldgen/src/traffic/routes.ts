import { UNITS_PER_METRE, hash32, makeRng } from '@nukkad/shared';
import type { AreaPack, LineKind, PackLine } from '@nukkad/shared';
import { bridgeRise } from '../roads/ribbon.ts';

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
  /** Height above the ground at each point: > 0 on bridges and flyovers. */
  rise: Float32Array;
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
  /** Metres above the ground (on a flyover). */
  rise: number;
  /** Facing angle (avatar convention: 0 = towards -z). */
  heading: number;
}

/** Traffic mix on a Bengaluru main road: lots of two-wheelers and autos. Kind indexes follow VEHICLE_KINDS. */
function pickKind(roll: number): number {
  if (roll < 0.26) return 4; // scooter
  if (roll < 0.34) return 11; // motorbike
  if (roll < 0.52) return 3; // auto
  if (roll < 0.62) return 0; // hatchback
  if (roll < 0.7) return 1; // sedan
  if (roll < 0.77) return 2; // SUV
  if (roll < 0.83) return 6; // taxi
  if (roll < 0.88) return 7; // van
  if (roll < 0.92) return 10; // delivery tempo
  if (roll < 0.95) return 9; // truck
  if (roll < 0.96) return 8; // ambulance
  return 5; // bus
}

interface Edge {
  line: number;
  from: number;
  to: number;
}

/** What kind of routes to build: which roads, how far off the centre, how fast, which vehicle. */
interface RouteRules {
  roads: (line: PackLine) => boolean;
  lane: (width: number, random: () => number) => number;
  speed: (kind: LineKind, vehicle: number, random: () => number) => number;
  kind: (random: () => number) => number;
  salt: number;
  minLength: number;
}

const DRIVING: RouteRules = {
  roads: (line) => TRAFFIC_ROADS.has(line.kind) && line.w >= 6,
  lane: (width) => Math.min(width / 4 + 0.3, 2.6),
  speed: (kind, vehicle, random) => (SPEED[kind] ?? 9) * (vehicle === 5 ? 0.75 : 0.85 + random() * 0.3),
  kind: (random) => pickKind(random()),
  salt: 120,
  minLength: 150,
};

const NO_WALKING = new Set<LineKind>(['motorway', 'trunk', 'rail', 'river', 'stream', 'construction']);

/** People: on both sides of almost any street, just beyond the road edge. `kind` = which look (0–7). */
const WALKING: RouteRules = {
  roads: (line) => !NO_WALKING.has(line.kind) && !line.b, // flyover decks have no footpath
  lane: (width, random) => (width / 2 + 0.8) * (random() < 0.5 ? 1 : -1),
  speed: (_kind, _look, random) => 1.1 + random() * 0.5,
  kind: (random) => Math.floor(random() * 8),
  salt: 140,
  minLength: 60,
};

/** Builds up to `count` vehicle routes on the main roads. */
export function buildTrafficRoutes(pack: AreaPack, count: number): TrafficRoute[] {
  return buildRoutes(pack, count, DRIVING);
}

/** Builds up to `count` walking routes along the streets (`kind` = which person look). */
export function buildWalkRoutes(pack: AreaPack, count: number): TrafficRoute[] {
  return buildRoutes(pack, count, WALKING);
}

/** Roads are linked where their points touch (shared OSM nodes). */
function buildRoutes(pack: AreaPack, count: number, rules: RouteRules): TrafficRoute[] {
  const lines = pack.lines.filter((line) => rules.roads(line));
  if (lines.length === 0) return [];
  // Graph: node = a point shared by any road, edges = consecutive points of a line.
  const nodes = new Map<string, number>();
  const coords: number[] = [];
  /** How high each point sits on its bridge (0 off bridges; bridge ends are 0 too). */
  const nodeRise: number[] = [];
  const adjacency: Edge[][] = [];
  const nodeOf = (x: number, z: number): number => {
    const key = `${x},${z}`;
    let id = nodes.get(key);
    if (id === undefined) {
      id = coords.length / 2;
      nodes.set(key, id);
      coords.push(x / UNITS_PER_METRE, z / UNITS_PER_METRE);
      adjacency.push([]);
      nodeRise.push(0);
    }
    return id;
  };
  lines.forEach((line, index) => {
    if (line.b) {
      // The same ramp profile as the drawn deck (see bridgeRise), measured along this line.
      const along = new Float32Array(line.pts.length / 2);
      for (let i = 1; i < along.length; i++) along[i] = along[i - 1] + Math.hypot(line.pts[i * 2] - line.pts[i * 2 - 2], line.pts[i * 2 + 1] - line.pts[i * 2 - 1]) / UNITS_PER_METRE;
      const rise = bridgeRise(along);
      for (let i = 0; i < along.length; i++) {
        const id = nodeOf(line.pts[i * 2], line.pts[i * 2 + 1]);
        nodeRise[id] = Math.max(nodeRise[id], rise[i]);
      }
    }
    for (let i = 0; i + 3 < line.pts.length; i += 2) {
      const a = nodeOf(line.pts[i], line.pts[i + 1]);
      const b = nodeOf(line.pts[i + 2], line.pts[i + 3]);
      if (a === b) continue;
      adjacency[a].push({ line: index, from: a, to: b });
      adjacency[b].push({ line: index, from: b, to: a });
    }
  });

  const routes: TrafficRoute[] = [];
  const random = makeRng(hash32(pack.lines.length * 31 + pack.buildings.length, rules.salt));
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
    if (length < rules.minLength) continue;
    const pts = new Float32Array(path.length * 2);
    const dist = new Float32Array(path.length);
    const rise = new Float32Array(path.length);
    path.forEach((id, i) => {
      rise[i] = nodeRise[id];
      pts[i * 2] = coords[id * 2];
      pts[i * 2 + 1] = coords[id * 2 + 1];
      if (i > 0) dist[i] = dist[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    });
    const line = lines[start.edges[0].line];
    const kind = rules.kind(random);
    routes.push({
      pts,
      dist,
      rise,
      length,
      lane: rules.lane(line.w, random),
      speed: rules.speed(line.kind, kind, random),
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
    rise: route.rise[lo] + (route.rise[hi] - route.rise[lo]) * k,
    heading: Math.atan2(-dx, -dz),
  };
}
