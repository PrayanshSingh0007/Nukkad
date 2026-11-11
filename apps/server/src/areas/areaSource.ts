import { areaGeoBox } from '@nukkad/shared';
import { osmUserAgent } from '../config.ts';
import type { Config } from '../config.ts';
import type { AreaSource } from './areaService.ts';
import { loadElevationSampler, networkTileLoader } from './elevation.ts';
import { fixtureTileLoader, readFixtureOsm } from './fixtures.ts';
import { fetchOverpass } from './overpass.ts';

/** Extra metres around the area when asking for data, so shapes on the edge are complete. */
export const FETCH_MARGIN_M = 10;
export const ELEVATION_MARGIN_M = 30;

/**
 * The real source: saved fixtures first (the built-in test area works offline),
 * otherwise one Overpass request plus a few elevation tiles.
 */
export function createAreaSource(config: Config): AreaSource {
  return {
    async fetchOsm(ref) {
      const saved = await readFixtureOsm(config.fixturesDir, ref.id);
      if (saved) return saved;
      return fetchOverpass(areaGeoBox(ref, FETCH_MARGIN_M), {
        urls: config.overpassUrls,
        userAgent: osmUserAgent(config),
      });
    },
    async loadSampler(ref) {
      const network = networkTileLoader(osmUserAgent(config));
      const loader = fixtureTileLoader(config.fixturesDir, ref.id, network);
      return loadElevationSampler(areaGeoBox(ref, ELEVATION_MARGIN_M), loader);
    },
  };
}
