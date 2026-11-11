import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Where built Area Packs (already gzipped) are kept between server restarts. */
export interface AreaStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, data: Buffer): Promise<void>;
}

/** Keeps packs in memory only. Used by tests. */
export class MemoryAreaStore implements AreaStore {
  private readonly items = new Map<string, Buffer>();

  async get(key: string): Promise<Buffer | null> {
    return this.items.get(key) ?? null;
  }

  async put(key: string, data: Buffer): Promise<void> {
    this.items.set(key, data);
  }
}

/**
 * Keeps packs as files in `.cache/areas/`. Used in development when there is no
 * MongoDB, so restarting the server does not ask OpenStreetMap again.
 */
export class FileAreaStore implements AreaStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private fileFor(key: string): string {
    return path.join(this.dir, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json.gz`);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.fileFor(key));
    } catch {
      return null;
    }
  }

  async put(key: string, data: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.fileFor(key);
    // Write to a temp file first so a crash never leaves half a pack behind.
    await writeFile(`${file}.tmp`, data);
    await rename(`${file}.tmp`, file);
  }
}
