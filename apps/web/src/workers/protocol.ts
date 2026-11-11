import type { PackStats } from '@nukkad/shared';
import type { ChunkData, ChunkLod, MeshData, PropSet, TerrainMesh } from '@nukkad/worldgen';

/** The typed messages between the page (main thread) and the world worker. */

export interface WorldInfo {
  id: string;
  lat: number;
  lng: number;
  halfSize: number;
  chunksPerSide: number;
  timeZone: string;
  /** Credit lines that must stay visible wherever the world is shown. */
  attribution: string[];
  stats: PackStats;
  flatTerrain: boolean;
  /** Where players appear: the street point nearest to the chosen spot. */
  spawn: [x: number, z: number];
  /** Bytes that travelled over the network (0 when the browser does not tell us). */
  downloadBytes: number;
  /** Size of the pack once unzipped. */
  packBytes: number;
  fetchMs: number;
  prepareMs: number;
}

/** The ground as numbers, for cameras and (from Phase 2) physics. */
export interface TerrainHeights {
  size: number;
  cell: number;
  half: number;
  base: number;
  heights: Float32Array;
}

export type ToWorker = { type: 'load'; url: string } | { type: 'chunk'; cx: number; cz: number; lod: ChunkLod };

export interface ReadyMessage {
  type: 'ready';
  info: WorldInfo;
  terrain: TerrainMesh;
  terrainHeights: TerrainHeights;
  groundMap: { size: number; pixels: Uint8Array };
  water: MeshData | null;
  props: PropSet;
}

export interface ChunkMessage {
  type: 'chunk';
  chunk: ChunkData;
  buildMs: number;
}

export type FromWorker =
  | { type: 'progress'; stage: 'download' | 'build' }
  | ReadyMessage
  | ChunkMessage
  | { type: 'error'; message: string };
