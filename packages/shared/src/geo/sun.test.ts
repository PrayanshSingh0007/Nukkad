import { describe, expect, it } from 'vitest';
import { localHour, skyDirection, sunPosition } from './sun.ts';

const DEG = 180 / Math.PI;

describe('sun position', () => {
  it('peaks at about 60° over Bengaluru around midday on 10 November', () => {
    let best = { elevation: -1, at: 0 };
    const start = Date.UTC(2026, 10, 10, 0, 0);
    for (let m = 0; m < 24 * 60; m += 5) {
      const at = start + m * 60_000;
      const { elevation } = sunPosition(new Date(at), 12.921, 77.695);
      if (elevation > best.elevation) best = { elevation, at };
    }
    expect(best.elevation * DEG).toBeGreaterThan(58.5);
    expect(best.elevation * DEG).toBeLessThan(61.5);
    const noonUtcMinutes = (best.at - start) / 60_000;
    expect(noonUtcMinutes).toBeGreaterThan(6 * 60 + 15); // ≈ 06:35 UTC = 12:05 IST
    expect(noonUtcMinutes).toBeLessThan(6 * 60 + 55);
  });

  it('is below the horizon at midnight and rises in the east', () => {
    expect(sunPosition(new Date(Date.UTC(2026, 10, 10, 18, 30)), 12.921, 77.695).elevation).toBeLessThan(0); // 00:00 IST
    const morning = sunPosition(new Date(Date.UTC(2026, 10, 10, 1, 30)), 12.921, 77.695); // 07:00 IST
    expect(morning.elevation).toBeGreaterThan(0);
    expect(morning.azimuth * DEG).toBeGreaterThan(90);
    expect(morning.azimuth * DEG).toBeLessThan(130);
  });

  it('points the right way in world space and reads the local clock', () => {
    const [x, y, z] = skyDirection(0, Math.PI / 2); // due east on the horizon
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
    expect(localHour(new Date(Date.UTC(2026, 10, 10, 6, 30)), 'Asia/Kolkata')).toBe(12);
  });
});
