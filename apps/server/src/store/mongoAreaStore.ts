import mongoose from 'mongoose';
import type { AreaStore } from './areaStore.ts';

/**
 * Area Packs in MongoDB (collection `areas`). Only public map data lives here —
 * nothing about any user. MongoDB deletes a pack by itself 30 days after its last use.
 *
 * NOTE (2026-11-10): written but not yet run against a real MongoDB — see NOTES.md.
 */
const UNUSED_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

interface AreaDoc {
  _id: string;
  data: Buffer;
  createdAt: Date;
  lastUsedAt: Date;
}

const areaSchema = new mongoose.Schema<AreaDoc>(
  {
    _id: { type: String, required: true },
    data: { type: Buffer, required: true },
    createdAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
  },
  { collection: 'areas', versionKey: false },
);
areaSchema.index({ lastUsedAt: 1 }, { expireAfterSeconds: UNUSED_DAYS * 24 * 60 * 60 });

export class MongoAreaStore implements AreaStore {
  private readonly model: mongoose.Model<AreaDoc>;
  /** Shared with the room store. */
  readonly connection: mongoose.Connection;

  constructor(connection: mongoose.Connection) {
    this.connection = connection;
    this.model = connection.model<AreaDoc>('Area', areaSchema);
  }

  async get(key: string): Promise<Buffer | null> {
    const doc = await this.model.findById(key).exec();
    if (!doc) return null;
    // Push the expiry forward, at most once a day per pack.
    const now = new Date();
    if (now.getTime() - doc.lastUsedAt.getTime() > DAY_MS) {
      await this.model.updateOne({ _id: key }, { $set: { lastUsedAt: now } }).exec();
    }
    return Buffer.from(doc.data);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const now = new Date();
    await this.model
      .updateOne({ _id: key }, { $set: { data, lastUsedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true })
      .exec();
  }
}

/** Connects to MongoDB and returns the store. Throws when the connection fails. */
export async function connectMongoAreaStore(uri: string): Promise<MongoAreaStore> {
  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 8000 }).asPromise();
  const store = new MongoAreaStore(connection);
  await connection.model('Area').createIndexes();
  return store;
}
