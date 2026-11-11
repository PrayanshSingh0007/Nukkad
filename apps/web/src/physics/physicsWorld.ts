import RAPIER from '@dimforge/rapier3d-compat';
import type { ChunkData, MeshData } from '@nukkad/worldgen';

/**
 * The physics side of the world (Rapier, compiled to WASM).
 * Only solid things live here: the ground, and the buildings + road strips of the
 * chunks around the player. Everything else is just drawn.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly chunkColliders = new Map<string, RAPIER.Collider[]>();
  private terrain: RAPIER.Collider | null = null;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  /** Loads the WASM module (once) and creates an empty world. */
  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
  }

  /** The ground: the very same triangles that are drawn, so feet and pixels always agree. */
  setTerrain(positions: Float32Array, indices: Uint16Array | Uint32Array): void {
    if (this.terrain) this.world.removeCollider(this.terrain, false);
    const description = RAPIER.ColliderDesc.trimesh(positions, new Uint32Array(indices), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
    this.terrain = this.world.createCollider(description);
  }

  private addMesh(mesh: MeshData | null, into: RAPIER.Collider[]): void {
    if (!mesh) return;
    into.push(this.world.createCollider(RAPIER.ColliderDesc.trimesh(mesh.positions, new Uint32Array(mesh.indices))));
  }

  /**
   * Keeps colliders only for the chunks within `radius` chunks of (cx, cz) — 3 × 3 for radius 1.
   * Returns true when every wanted chunk that exists has its collider.
   */
  syncChunks(cx: number, cz: number, radius: number, chunksPerSide: number, getChunk: (key: string) => ChunkData | undefined): boolean {
    const wanted = new Set<string>();
    let complete = true;
    for (let z = cz - radius; z <= cz + radius; z++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || z < 0 || x >= chunksPerSide || z >= chunksPerSide) continue;
        const key = `${x},${z}`;
        wanted.add(key);
        if (this.chunkColliders.has(key)) continue;
        const chunk = getChunk(key);
        if (!chunk) {
          complete = false;
          continue;
        }
        const colliders: RAPIER.Collider[] = [];
        this.addMesh(chunk.buildings, colliders);
        this.addMesh(chunk.ground, colliders); // road strips: their 8 cm lip is the kerb
        this.chunkColliders.set(key, colliders);
      }
    }
    for (const [key, colliders] of this.chunkColliders) {
      if (wanted.has(key)) continue;
      for (const collider of colliders) this.world.removeCollider(collider, false);
      this.chunkColliders.delete(key);
    }
    return complete;
  }

  get colliderChunkCount(): number {
    return this.chunkColliders.size;
  }

  step(): void {
    this.world.step();
  }

  /**
   * Shoots a ray and returns the distance to the first solid thing, or null.
   * `exclude` is a collider to ignore (the player's own body).
   */
  castRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number, exclude?: RAPIER.Collider): number | null {
    this.ray.origin = { x: ox, y: oy, z: oz };
    this.ray.dir = { x: dx, y: dy, z: dz };
    const hit = this.world.castRay(this.ray, maxDistance, true, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : null;
  }

  dispose(): void {
    this.world.free();
  }
}
