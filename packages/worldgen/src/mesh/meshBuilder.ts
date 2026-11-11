/** Plain typed arrays describing one mesh. They can be handed to the main thread without copying. */
export interface MeshData {
  positions: Float32Array;
  /** Unit normals packed as signed bytes (-127…127). */
  normals: Int8Array;
  /** Vertex colours, 0–255, already in linear colour space. */
  colors: Uint8Array;
  /** Two extra numbers per vertex (buildings: window column, floor). Absent when unused. */
  extra?: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export type Rgb = readonly [number, number, number];

/** Collects vertices and triangles, then packs them into typed arrays. */
export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly extra: number[] = [];
  private readonly indices: number[] = [];
  private readonly withExtra: boolean;

  constructor(withExtra = false) {
    this.withExtra = withExtra;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  addVertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: Rgb, e0 = 0, e1 = 0): number {
    const index = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.normals.push(Math.round(nx * 127), Math.round(ny * 127), Math.round(nz * 127));
    this.colors.push(color[0], color[1], color[2]);
    if (this.withExtra) this.extra.push(e0, e1);
    return index;
  }

  addTriangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /** Adds a flat-ish triangle so that it faces up (or down), whatever order the corners come in. */
  addTriangleFacing(a: number, b: number, c: number, up: boolean): void {
    const p = this.positions;
    const cross =
      (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]) - (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]);
    if (cross === 0) return; // zero-area sliver
    if (cross > 0 === up) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  /** Returns the packed mesh, or null when nothing was added. */
  finish(): MeshData | null {
    if (this.indices.length === 0) return null;
    const mesh: MeshData = {
      positions: new Float32Array(this.positions),
      normals: new Int8Array(this.normals),
      colors: new Uint8Array(this.colors),
      indices: this.vertexCount > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
    };
    if (this.withExtra) mesh.extra = new Float32Array(this.extra);
    return mesh;
  }
}

/** The transferable buffers inside a mesh (for zero-copy postMessage). */
export function meshBuffers(mesh: MeshData | null): ArrayBuffer[] {
  if (!mesh) return [];
  const buffers = [mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer, mesh.indices.buffer];
  if (mesh.extra) buffers.push(mesh.extra.buffer);
  return buffers as ArrayBuffer[];
}
