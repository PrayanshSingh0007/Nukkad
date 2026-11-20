/**
 * The real weather over a place, from Open-Meteo (https://open-meteo.com: free, no key, open
 * data under CC BY 4.0 — credited in the game and in CREDITS.md). Server-side, so players'
 * browsers only talk to our server. Only the game area's centre is sent (never anyone's own
 * location), rounded to about 5 km, and each answer is kept for 10 minutes, so a busy server
 * still asks rarely.
 */
export interface Weather {
  /** 0 = dry … 1 = downpour / thunderstorm. */
  rain: number;
  /** 0 = clear … 1 = overcast. */
  cloud: number;
  /** Thunder and lightning right now. */
  storm: boolean;
  /** When Open-Meteo measured it (ISO time). */
  at: string;
}

export interface WeatherOptions {
  fetchImpl?: typeof fetch;
  ttlMs?: number;
}

const TTL_MS = 10 * 60_000;

/** WMO weather codes → at least this much rain. */
function rainForCode(code: number): number {
  if (code >= 95) return 1; // thunderstorm
  if (code >= 80) return code === 82 ? 0.9 : code === 81 ? 0.7 : 0.5; // showers
  if (code >= 61 && code <= 67) return code === 65 || code === 67 ? 0.85 : code === 63 ? 0.6 : 0.4; // rain
  if (code >= 51 && code <= 57) return 0.25; // drizzle
  return 0;
}

/** Rainfall in mm/h → 0–1: a trace is a drizzle, about 4 mm/h and more is a downpour. */
export function rainFromMillimetres(mm: number): number {
  if (!(mm > 0.05)) return 0;
  return Math.min(1, 0.28 + 0.18 * mm);
}

export class WeatherService {
  private readonly fetchImpl: typeof fetch;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, { weather: Weather; until: number }>();
  private readonly pending = new Map<string, Promise<Weather>>();

  constructor(options: WeatherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.ttlMs = options.ttlMs ?? TTL_MS;
  }

  async current(lat: number, lng: number): Promise<Weather> {
    const rLat = Math.round(lat * 20) / 20;
    const rLng = Math.round(lng * 20) / 20;
    const key = `${rLat},${rLng}`;
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.weather;
    const waiting = this.pending.get(key);
    if (waiting) return waiting;
    const ask = this.ask(rLat, rLng)
      .then((weather) => {
        this.cache.set(key, { weather, until: Date.now() + this.ttlMs });
        return weather;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, ask);
    return ask;
  }

  private async ask(lat: number, lng: number): Promise<Weather> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=precipitation,weather_code,cloud_cover&timezone=auto`;
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);
    const body = (await response.json()) as { current?: { time?: string; precipitation?: number; weather_code?: number; cloud_cover?: number } };
    const now = body.current;
    if (!now) throw new Error('Open-Meteo sent no current weather');
    const code = Number(now.weather_code ?? 0);
    return {
      rain: Math.max(rainForCode(code), rainFromMillimetres(Number(now.precipitation ?? 0))),
      cloud: Math.min(1, Math.max(0, Number(now.cloud_cover ?? 0) / 100)),
      storm: code >= 95,
      at: String(now.time ?? ''),
    };
  }
}
