import { AreaService } from './areas/areaService.ts';
import { createAreaSource } from './areas/areaSource.ts';
import { loadConfig, osmUserAgent } from './config.ts';
import { createApp } from './http/app.ts';
import { RealtimeHub } from './realtime/hub.ts';
import { Geocoder } from './geocode/nominatim.ts';
import { RoomManager } from './realtime/rooms.ts';
import { FileAreaStore } from './store/areaStore.ts';
import type { AreaStore } from './store/areaStore.ts';
import { connectMongoAreaStore } from './store/mongoAreaStore.ts';
import { FileRoomStore, MongoRoomStore } from './store/roomStore.ts';
import type { RoomStore } from './store/roomStore.ts';
import path from 'node:path';

const log = (message: string): void => console.log(`[nukkad] ${message}`);

async function main(): Promise<void> {
  const config = loadConfig();

  let store: AreaStore;
  let roomStore: RoomStore;
  if (config.mongoUri) {
    const mongo = await connectMongoAreaStore(config.mongoUri);
    store = mongo;
    roomStore = new MongoRoomStore(mongo.connection);
    log('area cache and rooms: MongoDB');
  } else {
    store = new FileAreaStore(config.cacheDir);
    roomStore = new FileRoomStore(path.join(path.dirname(config.cacheDir), 'rooms'));
    log('area cache: memory + .cache/ on disk; rooms: .cache/rooms/ (no MONGODB_URI set)');
  }

  if (!config.osmContact) {
    if (config.production) osmUserAgent(config); // throws with a clear message
    log('OSM_CONTACT is not set — fine for local development, required before deploying');
  }

  const areas = new AreaService({ store, source: createAreaSource(config), log });
  const rooms = new RoomManager(Date.now, roomStore);
  log(`rooms restored after restart: ${rooms.restore(await roomStore.loadAll())}`);
  const geocoder = new Geocoder({ userAgent: osmUserAgent(config) });
  const app = createApp({ areas, rooms, geocoder, allowedOrigins: config.allowedOrigins, trustProxy: config.trustProxy });
  const hub = new RealtimeHub({ rooms, allowedOrigins: config.allowedOrigins, trustProxy: config.trustProxy, log });
  const server = app.listen(config.port, '0.0.0.0', (error?: Error) => {
    if (error) {
      console.error(`[nukkad] could not listen on port ${config.port}:`, error.message);
      process.exit(1);
    }
    log(`server listening on port ${config.port}`);
  });
  hub.attach(server);
}

main().catch((error: unknown) => {
  console.error('[nukkad] could not start:', error);
  process.exit(1);
});
