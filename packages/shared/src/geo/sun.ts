/**
 * Where the sun is in the sky for a place and a moment (accurate to about a degree —
 * plenty for lighting). Based on the standard low-precision almanac formulas.
 * The answer depends only on lat/lng and UTC time, so every player sees the same sky.
 */
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J2000_DAYS_SINCE_1970 = 10957.5;

export interface SunPosition {
  /** Angle above the horizon, radians (negative = below). */
  elevation: number;
  /** Compass direction, radians clockwise from north. */
  azimuth: number;
}

export function sunPosition(date: Date, lat: number, lng: number): SunPosition {
  const d = date.getTime() / DAY_MS - J2000_DAYS_SINCE_1970;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const epsilon = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const gmstHours = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const hourAngle = gmstHours * 15 * RAD + lng * RAD - ra;
  const phi = lat * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle));
  const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle));
  return { elevation, azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI) };
}

/** Unit vector towards a sky position in the world (x east, y up, z south). */
export function skyDirection(elevation: number, azimuth: number): [number, number, number] {
  return [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation)];
}

/** The hour (0–24, with fractions) on the place's local clock. */
export function localHour(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    return hour + minute / 60;
  } catch {
    return date.getUTCHours() + date.getUTCMinutes() / 60;
  }
}
