import type { OsmLatLon } from './osmTypes.ts';

const keyOf = (p: OsmLatLon): string => `${p.lat},${p.lon}`;

/**
 * A multipolygon (a building with a courtyard, a park with a pond…) arrives as
 * loose pieces of outline. This joins pieces end to end until they close.
 * Pieces that never close are broken data and are dropped.
 */
export function assembleRings(segments: OsmLatLon[][]): OsmLatLon[][] {
  const pool = segments.filter((segment) => segment.length >= 2).map((segment) => segment.slice());
  const rings: OsmLatLon[][] = [];
  while (pool.length > 0) {
    let current = pool.pop() as OsmLatLon[];
    for (let guard = 0; guard < 10_000; guard++) {
      const endKey = keyOf(current[current.length - 1]);
      if (keyOf(current[0]) === endKey) break;
      const index = pool.findIndex(
        (segment) => keyOf(segment[0]) === endKey || keyOf(segment[segment.length - 1]) === endKey,
      );
      if (index < 0) break;
      const next = pool.splice(index, 1)[0];
      if (keyOf(next[0]) !== endKey) next.reverse();
      current = current.concat(next.slice(1));
    }
    if (current.length >= 4 && keyOf(current[0]) === keyOf(current[current.length - 1])) rings.push(current);
  }
  return rings;
}

export function isClosed(points: OsmLatLon[]): boolean {
  return points.length >= 4 && keyOf(points[0]) === keyOf(points[points.length - 1]);
}
