/**
 * Place search through OpenStreetMap's Nominatim, following its usage policy
 * (https://operations.osmfoundation.org/policies/nominatim/): server-side only, at most ONE
 * request per second for the whole server, an identifying User-Agent, results cached, and
 * searches only when the player presses Enter (no search-as-you-type).
 */
export interface PlaceResult {
  name: string;
  /** A short "where": area and city. */
  detail: string;
  lat: number;
  lng: number;
}

export interface GeocoderOptions {
  userAgent: string;
  fetchImpl?: typeof fetch;
  /** Milliseconds between requests to Nominatim (policy: ≥ 1000). */
  spacingMs?: number;
  now?: () => number;
}

const CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CACHE = 2000;
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export class Geocoder {
  private readonly options: GeocoderOptions;
  private readonly cache = new Map<string, { at: number; results: PlaceResult[] }>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;

  constructor(options: GeocoderOptions) {
    this.options = options;
  }

  /** Normalises the text so "VR Bengaluru " and "vr bengaluru" share one cache entry. */
  static key(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  async search(query: string): Promise<PlaceResult[]> {
    const key = Geocoder.key(query);
    const now = (this.options.now ?? Date.now)();
    const cached = this.cache.get(key);
    if (cached && now - cached.at < CACHE_MS) return cached.results;
    // One request at a time, spaced out: queue behind any search already running.
    const task = this.queue.then(() => this.fetchSpaced(key));
    this.queue = task.catch(() => {});
    const results = await task;
    if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: (this.options.now ?? Date.now)(), results });
    return results;
  }

  private async fetchSpaced(query: string): Promise<PlaceResult[]> {
    const spacing = this.options.spacingMs ?? 1100;
    const wait = this.lastRequest + spacing - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequest = Date.now();
    // Prefer Bengaluru (the viewbox), but places anywhere in India still come back.
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '6',
      countrycodes: 'in',
      viewbox: '77.35,13.25,77.95,12.75',
      addressdetails: '1',
    });
    const response = await (this.options.fetchImpl ?? fetch)(`${ENDPOINT}?${params}`, {
      headers: { 'User-Agent': this.options.userAgent, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
    const rows = (await response.json()) as { name?: string; display_name?: string; lat?: string; lon?: string; address?: Record<string, string> }[];
    return rows
      .map((row): PlaceResult | null => {
        const lat = Number(row.lat);
        const lng = Number(row.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const a = row.address ?? {};
        const name = (row.name || row.display_name?.split(',')[0] || 'Place').slice(0, 80);
        const area = a.suburb ?? a.neighbourhood ?? a.city_district ?? a.road ?? '';
        const city = a.city ?? a.town ?? a.state_district ?? a.state ?? '';
        return { name, detail: [area, city].filter(Boolean).join(', ').slice(0, 80), lat, lng };
      })
      .filter((place): place is PlaceResult => place !== null)
      // OpenStreetMap often has the same place twice (a point and an outline): keep one.
      .filter((place, index, all) => all.findIndex((other) => other.name === place.name && Math.hypot(other.lat - place.lat, other.lng - place.lng) < 0.003) === index);
  }
}
