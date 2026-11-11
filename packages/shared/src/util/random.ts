/**
 * Seeded "randomness". Every device must build the exact same world, so we
 * never use Math.random() for anything visible. Seeds come from map ids.
 */

/** Mixes an id (OSM ids are larger than 32 bits) and a salt into a 32-bit unsigned hash. */
export function hash32(id: number, salt = 0): number {
  let h = (id % 4294967296) ^ Math.floor(id / 4294967296) ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A hash turned into a number in [0, 1). */
export function hash01(id: number, salt = 0): number {
  return hash32(id, salt) / 4294967296;
}

/** Small seeded generator (mulberry32): same seed → same sequence everywhere. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
