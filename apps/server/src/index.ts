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

const log = (message: string): void => console.log(`[nukkad] ${message}`);

async function main(): Promise<void> {
  const config = loadConfig();

  let store: AreaStore;
  if (config.mongoUri) {
    store = await connectMongoAreaStore(config.mongoUri);
    log('area cache: MongoDB');
  } else {
    store = new FileAreaStore(config.cacheDir);
    log('area cache: memory + .cache/ on disk (no MONGODB_URI set)');
  }

  if (!config.osmContact) {
    if (config.production) osmUserAgent(config); // throws with a clear message
    log('OSM_CONTACT is not set — fine for local development, required before deploying');
  }

  const areas = new AreaService({ store, source: createAreaSource(config), log });
  const rooms = new RoomManager();
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
