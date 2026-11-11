// Saves the raw map data of one place into tools/fixtures/<areaId>/ so that place
// works offline and tests always see the same data.
//
//   npm run fixture                 → the built-in test area
//   npm run fixture -- 48.8584 2.2945
//
// It makes ONE Overpass request and downloads a few elevation tiles. Be kind to the
// free OpenStreetMap servers: only run it when you really need fresh data.
import { TEST_AREA, areaGeoBox, areaRefFor, isValidLatLng } from '@nukkad/shared';
import { ELEVATION_MARGIN_M, FETCH_MARGIN_M } from '../../apps/server/src/areas/areaSource.ts';
import { networkTileLoader, tilesForBox } from '../../apps/server/src/areas/elevation.ts';
import { writeFixture } from '../../apps/server/src/areas/fixtures.ts';
import { fetchOverpass } from '../../apps/server/src/areas/overpass.ts';
import { loadConfig, osmUserAgent } from '../../apps/server/src/config.ts';

const [latArg, lngArg] = process.argv.slice(2);
const lat = latArg === undefined ? TEST_AREA.lat : Number(latArg);
const lng = lngArg === undefined ? TEST_AREA.lng : Number(lngArg);
if (!isValidLatLng(lat, lng)) {
  console.error('Usage: npm run fixture -- <lat> <lng>');
  process.exit(1);
}

const config = loadConfig();
const userAgent = osmUserAgent(config);
const ref = areaRefFor(lat, lng);

console.log(`Recording ${ref.id} (centre ${ref.lat}, ${ref.lng}) …`);
const started = Date.now();
const osm = await fetchOverpass(areaGeoBox(ref, FETCH_MARGIN_M), { urls: config.overpassUrls, userAgent });
console.log(`  map data: ${osm.elements.length} elements in ${Date.now() - started} ms`);

const loadTile = networkTileLoader(userAgent);
const tiles = [];
for (const tile of tilesForBox(areaGeoBox(ref, ELEVATION_MARGIN_M))) {
  tiles.push({ tile, png: await loadTile(tile) });
}
console.log(`  elevation: ${tiles.length} tiles`);

const dir = await writeFixture(config.fixturesDir, ref.id, osm, tiles);
console.log(`Saved to ${dir}`);
