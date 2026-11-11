import type { ChunkLod } from '@nukkad/worldgen';
import type { ChunkMessage, FromWorker, ReadyMessage, ToWorker } from '../workers/protocol.ts';

type Progress = (stage: 'download' | 'build') => void;

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/** The page's handle on the world worker: ask for a world, then ask for chunks. */
export class WorldClient {
  private readonly worker: Worker;
  private loadWaiter: Waiter<ReadyMessage> | null = null;
  private onProgress: Progress | null = null;
  private readonly chunkWaiters = new Map<string, Waiter<ChunkMessage>>();

  constructor() {
    this.worker = new Worker(new URL('../workers/world.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.handle(event.data);
    this.worker.onerror = (event) => this.failAll(new Error(event.message || 'The world worker crashed.'));
  }

  /** Downloads and prepares the world behind `url` (an /api/areas address). */
  load(url: string, onProgress?: Progress): Promise<ReadyMessage> {
    this.onProgress = onProgress ?? null;
    return new Promise((resolve, reject) => {
      this.loadWaiter = { resolve, reject };
      this.send({ type: 'load', url });
    });
  }

  /** Builds the meshes of one chunk in the worker. */
  requestChunk(cx: number, cz: number, lod: ChunkLod = 0): Promise<ChunkMessage> {
    return new Promise((resolve, reject) => {
      this.chunkWaiters.set(`${cx},${cz},${lod}`, { resolve, reject });
      this.send({ type: 'chunk', cx, cz, lod });
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.failAll(new Error('The world was closed.'));
  }

  private send(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  private handle(message: FromWorker): void {
    if (message.type === 'progress') {
      this.onProgress?.(message.stage);
    } else if (message.type === 'ready') {
      this.loadWaiter?.resolve(message);
      this.loadWaiter = null;
    } else if (message.type === 'chunk') {
      const key = `${message.chunk.cx},${message.chunk.cz},${message.chunk.lod}`;
      this.chunkWaiters.get(key)?.resolve(message);
      this.chunkWaiters.delete(key);
    } else {
      this.failAll(new Error(message.message));
    }
  }

  private failAll(error: Error): void {
    this.loadWaiter?.reject(error);
    this.loadWaiter = null;
    for (const waiter of this.chunkWaiters.values()) waiter.reject(error);
    this.chunkWaiters.clear();
  }
}
