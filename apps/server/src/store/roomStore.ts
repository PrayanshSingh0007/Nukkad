import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

/**
 * Rooms that must survive a server restart (BUGS B-005). Only what an invite link needs:
 * the room id, the place (lat, lng) and two timestamps. Never names, looks or positions —
 * those live only while people are connected.
 */
export interface RoomRecord {
  id: string;
  lat: number;
  lng: number;
  createdAt: number;
  /** When the last person left (ms), or null while someone is in it. */
  emptySince: number | null;
}

export interface RoomStore {
  loadAll(): Promise<RoomRecord[]>;
  save(room: RoomRecord): void;
  remove(id: string): void;
}

/** Development: one small JSON file, written at most twice a second. */
export class FileRoomStore implements RoomStore {
  private readonly file: string;
  private readonly rooms = new Map<string, RoomRecord>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(dir: string) {
    this.file = path.join(dir, 'rooms.json');
  }

  async loadAll(): Promise<RoomRecord[]> {
    try {
      const list = JSON.parse(readFileSync(this.file, 'utf8')) as RoomRecord[];
      for (const room of list) if (isRecord(room)) this.rooms.set(room.id, room);
    } catch {
      // no file yet, or unreadable: start empty
    }
    return [...this.rooms.values()];
  }

  save(room: RoomRecord): void {
    this.rooms.set(room.id, { ...room });
    this.schedule();
  }

  remove(id: string): void {
    if (this.rooms.delete(id)) this.schedule();
  }

  /** Writes now (used by tests and on shutdown). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.rooms.values()]));
    renameSync(temporary, this.file); // never leaves a half-written file
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 500);
    this.timer.unref?.();
  }
}

function isRecord(value: unknown): value is RoomRecord {
  const r = value as RoomRecord;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.id === 'string' &&
    /^[a-z0-9]{12}$/.test(r.id) &&
    Number.isFinite(r.lat) &&
    Number.isFinite(r.lng) &&
    Number.isFinite(r.createdAt) &&
    (r.emptySince === null || Number.isFinite(r.emptySince))
  );
}

interface RoomDoc {
  _id: string;
  lat: number;
  lng: number;
  createdAt: Date;
  emptySince: Date | null;
  /** MongoDB deletes the room by itself 24 h after this (empty rooms only). */
  expiresAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Production: collection `rooms` in MongoDB. NOTE: written but not yet run against a real
 * MongoDB (none installed locally) — same status as the area store.
 */
export class MongoRoomStore implements RoomStore {
  private readonly model: mongoose.Model<RoomDoc>;

  constructor(connection: mongoose.Connection) {
    const schema = new mongoose.Schema<RoomDoc>(
      {
        _id: { type: String, required: true },
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        createdAt: { type: Date, required: true },
        emptySince: { type: Date, default: null },
        expiresAt: { type: Date, default: null },
      },
      { collection: 'rooms', versionKey: false },
    );
    schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    this.model = connection.model<RoomDoc>('Room', schema);
  }

  async loadAll(): Promise<RoomRecord[]> {
    const docs = await this.model.find().lean().exec();
    return docs.map((d) => ({ id: d._id, lat: d.lat, lng: d.lng, createdAt: d.createdAt.getTime(), emptySince: d.emptySince ? d.emptySince.getTime() : null }));
  }

  save(room: RoomRecord): void {
    const emptySince = room.emptySince === null ? null : new Date(room.emptySince);
    void this.model
      .updateOne(
        { _id: room.id },
        { lat: room.lat, lng: room.lng, createdAt: new Date(room.createdAt), emptySince, expiresAt: emptySince ? new Date(emptySince.getTime() + DAY_MS) : null },
        { upsert: true },
      )
      .exec()
      .catch((error: unknown) => console.error('[nukkad] could not save room', error));
  }

  remove(id: string): void {
    void this.model
      .deleteOne({ _id: id })
      .exec()
      .catch((error: unknown) => console.error('[nukkad] could not remove room', error));
  }
}
