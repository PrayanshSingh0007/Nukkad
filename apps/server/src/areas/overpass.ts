import type { GeoBox } from '@nukkad/shared';
import type { OverpassResponse } from '@nukkad/worldgen';

export interface OverpassOptions {
  /** Servers to try, in order. */
  urls: string[];
  userAgent: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * The one question we ask OpenStreetMap per place: everything we draw inside the box.
 * `out body geom` returns the shape of every way directly, so no second request is needed.
 */
export function overpassQuery(box: GeoBox): string {
  const bbox = [box.south, box.west, box.north, box.east].map((value) => value.toFixed(6)).join(',');
  return `[out:json][timeout:60][bbox:${bbox}];
(
  way["building"];
  relation["building"]["type"="multipolygon"];
  way["building:part"];
  way["highway"];
  way["railway"~"^(rail|light_rail|subway|tram|monorail|narrow_gauge)$"];
  way["waterway"];
  way["natural"];
  relation["natural"]["type"="multipolygon"];
  way["landuse"];
  relation["landuse"]["type"="multipolygon"];
  way["leisure"];
  relation["leisure"]["type"="multipolygon"];
  way["amenity"~"^(parking|grave_yard)$"];
  way["amenity"~"^(school|kindergarten|college|university|hospital|clinic|place_of_worship|marketplace)$"]["name"];
  relation["amenity"~"^(school|kindergarten|college|university|hospital|place_of_worship)$"]["type"="multipolygon"]["name"];
  way["shop"~"^(mall|supermarket|department_store)$"]["name"];
  way["barrier"~"^(wall|fence|hedge)$"];
  node["natural"="tree"];
  node["highway"="street_lamp"];
  node["amenity"="bench"];
  node["shop"];
  node["amenity"~"^(restaurant|fast_food|food_court|cafe|ice_cream|pharmacy|clinic|doctors|dentist|hospital|bank|school|kindergarten|college|university|place_of_worship)$"];
  node["office"];
  node["tourism"~"^(hotel|guest_house|hostel)$"];
  node["leisure"~"^(fitness_centre|sports_centre)$"];
);
out body geom qt;`;
}

/** Asks an Overpass server for the map data of a box. Tries each server once before giving up. */
export async function fetchOverpass(box: GeoBox, options: OverpassOptions): Promise<OverpassResponse> {
  const doFetch = options.fetchImpl ?? fetch;
  const body = `data=${encodeURIComponent(overpassQuery(box))}`;
  let lastError: unknown = new Error('No Overpass server configured');
  for (const url of options.urls) {
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': options.userAgent },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
      });
      if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
      const data = (await response.json()) as Partial<OverpassResponse> & { remark?: string };
      if (!Array.isArray(data.elements)) throw new Error('Overpass answer has no elements');
      // A timed-out query still answers 200, with a remark and partial data.
      if (data.remark && /error|timed out/i.test(data.remark)) throw new Error(`Overpass: ${data.remark}`);
      return { elements: data.elements };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
