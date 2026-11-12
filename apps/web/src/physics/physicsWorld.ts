import type { Collider, Ray, RigidBody, World } from '@dimforge/rapier3d';
import type { ChunkData, MeshData } from '@nukkad/worldgen';
import { loadRapier } from './rapier.ts';
import type { Rapier } from './rapier.ts';

/**
 * The physics side of the world (Rapier, compiled to WASM).
 * Only solid things live here: the ground, and the buildings + road strips of the
 * chunks around the player. Everything else is just drawn.
 */
export class PhysicsWorld {
  readonly rapier: Rapier;
  readonly world: World;
  private readonly chunkColliders = new Map<string, Collider[]>();
  private terrain: Collider | null = null;
  private readonly ray: Ray;
  private boxes: Collider[] = [];
  /** Moving solids (traffic): one kinematic body each, reused frame after frame. */
  private movers: { body: RigidBody; collider: Collider; size: string }[] = [];

  /** Loads the WASM module (once) and creates an empty world. */
  static async create(): Promise<PhysicsWorld> {
    return new PhysicsWorld(await loadRapier());
  }

  private constructor(rapier: Rapier) {
    this.rapier = rapier;
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  /** The ground: the very same triangles that are drawn, so feet and pixels always agree. */
  setTerrain(positions: Float32Array, indices: Uint16Array | Uint32Array): void {
    if (this.terrain) this.world.removeCollider(this.terrain, false);
    const { ColliderDesc, TriMeshFlags } = this.rapier;
    this.terrain = this.world.createCollider(ColliderDesc.trimesh(positions, new Uint32Array(indices), TriMeshFlags.FIX_INTERNAL_EDGES));
  }

  private addMesh(mesh: MeshData | null, into: Collider[]): void {
    if (!mesh) return;
    into.push(this.world.createCollider(this.rapier.ColliderDesc.trimesh(mesh.positions, new Uint32Array(mesh.indices))));
  }

  /**
   * Keeps colliders only for the chunks within `radius` chunks of (cx, cz) — 3 × 3 for radius 1.
   * `getChunk` must return full-detail (LOD0) chunk data. Returns true when every wanted chunk has its collider.
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
        const colliders: Collider[] = [];
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

  /** Replaces the solid boxes of parked vehicles and stalls near the player. */
  setBoxes(boxes: { x: number; y: number; z: number; hx: number; hy: number; hz: number; rotation: number }[]): void {
    for (const collider of this.boxes) this.world.removeCollider(collider, false);
    const { ColliderDesc } = this.rapier;
    this.boxes = boxes.map((b) => {
      const half = b.rotation / 2;
      return this.world.createCollider(
        ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z).setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
      );
    });
  }

  private interior: Collider[] = [];

  /** The walls, floor and furniture of the building you are inside (empty list = outside). */
  setInterior(boxes: { x: number; y: number; z: number; hx: number; hy: number; hz: number; rotation: number }[]): void {
    for (const collider of this.interior) this.world.removeCollider(collider, false);
    const { ColliderDesc } = this.rapier;
    this.interior = boxes.map((b) => {
      const half = b.rotation / 2;
      return this.world.createCollider(
        ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z).setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
      );
    });
  }

  /** Moves the traffic solids to where the vehicles are this frame. */
  setMovers(boxes: { x: number; y: number; z: number; hx: number; hy: number; hz: number; rotation: number }[]): void {
    const { ColliderDesc, RigidBodyDesc } = this.rapier;
    boxes.forEach((b, i) => {
      const size = `${b.hx},${b.hy},${b.hz}`;
      let mover = this.movers[i];
      if (!mover) {
        const body = this.world.createRigidBody(RigidBodyDesc.kinematicPositionBased().setTranslation(b.x, b.y, b.z));
        mover = { body, collider: this.world.createCollider(ColliderDesc.cuboid(b.hx, b.hy, b.hz), body), size };
        this.movers[i] = mover;
      } else if (mover.size !== size) {
        this.world.removeCollider(mover.collider, false);
        mover.collider = this.world.createCollider(ColliderDesc.cuboid(b.hx, b.hy, b.hz), mover.body);
        mover.size = size;
      }
      const half = b.rotation / 2;
      mover.body.setNextKinematicTranslation({ x: b.x, y: b.y, z: b.z });
      mover.body.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    });
    // Unused movers are parked far below the world.
    for (let i = boxes.length; i < this.movers.length; i++) this.movers[i].body.setNextKinematicTranslation({ x: 0, y: -500, z: 0 });
  }

  get boxCount(): number {
    return this.boxes.length;
  }

  get colliderChunkCount(): number {
    return this.chunkColliders.size;
  }

  step(): void {
    this.world.step();
  }

  /** Distance along a ray to the first solid thing, or null. `exclude` = the player's own body. */
  castRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number, exclude?: Collider): number | null {
    this.ray.origin = { x: ox, y: oy, z: oz };
    this.ray.dir = { x: dx, y: dy, z: dz };
    const hit = this.world.castRay(this.ray, maxDistance, true, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : null;
  }

  dispose(): void {
    this.world.free();
  }
}
