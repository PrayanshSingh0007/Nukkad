import type { ChunkLod } from '@nukkad/worldgen';

/** How far the world is loaded around the player (PLAN §7). */
export interface StreamSettings {
  /** Half the side of the area, metres. */
  half: number;
  chunksPerSide: number;
  chunkSize: number;
  /** Chunks this many steps away (3 × 3 for 1) are always full detail: they also get colliders. */
  nearRing: number;
  /** Chunks closer than this are shown (far ones simplified). */
  viewDistance: number;
  /** Extra metres before something loaded is dropped again, so it does not flip-flop at a border. */
  hysteresis: number;
}

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

/** Which chunk a point is in (clamped to the area). */
export function chunkAt(x: number, z: number, s: StreamSettings): [number, number] {
  const clamp = (v: number): number => Math.min(s.chunksPerSide - 1, Math.max(0, Math.floor((v + s.half) / s.chunkSize)));
  return [clamp(x), clamp(z)];
}

/** Distance from a point to the nearest edge of a chunk (0 inside it). */
export function distanceToChunk(x: number, z: number, cx: number, cz: number, s: StreamSettings): number {
  const minX = -s.half + cx * s.chunkSize;
  const minZ = -s.half + cz * s.chunkSize;
  const dx = Math.max(minX - x, 0, x - (minX + s.chunkSize));
  const dz = Math.max(minZ - z, 0, z - (minZ + s.chunkSize));
  return Math.hypot(dx, dz);
}

/**
 * The chunks that should be on screen for a player at (x, z), and at which detail.
 * `loaded` is what is on screen now; it is used only to keep things a little longer (hysteresis).
 */
export function planChunks(x: number, z: number, loaded: ReadonlyMap<string, ChunkLod>, s: StreamSettings): Map<string, ChunkLod> {
  const [pcx, pcz] = chunkAt(x, z, s);
  const keepNear = s.nearRing * s.chunkSize + s.hysteresis;
  const plan = new Map<string, ChunkLod>();
  for (let cz = 0; cz < s.chunksPerSide; cz++) {
    for (let cx = 0; cx < s.chunksPerSide; cx++) {
      const key = chunkKey(cx, cz);
      const ring = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
      const distance = distanceToChunk(x, z, cx, cz, s);
      const current = loaded.get(key);
      if (ring <= s.nearRing || (current === 0 && distance <= keepNear)) plan.set(key, 0);
      else if (distance <= s.viewDistance || (current !== undefined && distance <= s.viewDistance + s.hysteresis)) plan.set(key, 1);
    }
  }
  return plan;
}
