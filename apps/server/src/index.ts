import { AreaService } from './areas/areaService.ts';
import { createAreaSource } from './areas/areaSource.ts';
import { loadConfig, osmUserAgent } from './config.ts';
import { createApp } from './http/app.ts';
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
  const app = createApp({ areas, allowedOrigins: config.allowedOrigins, trustProxy: config.trustProxy });
  app.listen(config.port, '0.0.0.0', (error?: Error) => {
    if (error) {
      console.error(`[nukkad] could not listen on port ${config.port}:`, error.message);
      process.exit(1);
    }
    log(`server listening on port ${config.port}`);
  });
}

main().catch((error: unknown) => {
  console.error('[nukkad] could not start:', error);
  process.exit(1);
});
