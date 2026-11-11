import path from 'node:path';

export interface Config {
  port: number;
  /** Empty = no MongoDB: areas are cached in memory and on disk (dev). */
  mongoUri: string;
  /** Contact shown to OpenStreetMap services in our User-Agent. */
  osmContact: string;
  overpassUrls: string[];
  allowedOrigins: string[];
  trustProxy: boolean;
  production: boolean;
  /** Folder for the dev disk cache. */
  cacheDir: string;
  /** Saved map data for the built-in test area (works offline). */
  fixturesDir: string;
}

const APP_VERSION = '0.1';

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** Reads settings from the environment (and from `.env` at the repo root when it exists). */
export function loadConfig(): Config {
  const rootDir = path.resolve(import.meta.dirname, '../../..');
  try {
    process.loadEnvFile(path.join(rootDir, '.env'));
  } catch {
    // No .env file: fine, defaults below are meant for local development.
  }
  const env = process.env;
  const overpassUrls = list(env.OVERPASS_URLS);
  return {
    port: Number(env.PORT) || 8787,
    mongoUri: env.MONGODB_URI?.trim() ?? '',
    osmContact: env.OSM_CONTACT?.trim() ?? '',
    overpassUrls: overpassUrls.length > 0 ? overpassUrls : ['https://overpass-api.de/api/interpreter'],
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    trustProxy: env.TRUST_PROXY === '1',
    production: env.NODE_ENV === 'production',
    cacheDir: path.join(rootDir, '.cache', 'areas'),
    fixturesDir: path.join(rootDir, 'tools', 'fixtures'),
  };
}

/**
 * The User-Agent we send to OpenStreetMap services. Their usage policies ask every
 * app to identify itself with a contact, so a deployed server must have OSM_CONTACT set.
 */
export function osmUserAgent(config: Pick<Config, 'osmContact' | 'production'>): string {
  if (config.osmContact) return `Nukkad/${APP_VERSION} (${config.osmContact})`;
  if (config.production) {
    throw new Error('OSM_CONTACT is not set. A deployed Nukkad server must identify itself to OpenStreetMap services.');
  }
  return `Nukkad/${APP_VERSION} (local development build)`;
}
