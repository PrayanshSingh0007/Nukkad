import { describe, expect, it } from 'vitest';
import { cycleHour, mistAt, partOfDay } from './atmosphere.ts';

describe('the game day', () => {
  const minute = 60_000;
  // Find the moment the cycle starts (6:00) near some time, then walk through it.
  const start = (() => {
    for (let ms = 0; ms < 30 * minute; ms += 1000) if (Math.abs(cycleHour(ms) - 6) < 0.02) return ms;
    throw new Error('no 6:00 found');
  })();

  it('goes through day, a slow sunset and a quick night, then repeats', () => {
    expect(cycleHour(start + 10 * minute)).toBeCloseTo(16, 1); // 10 minutes of day
    expect(cycleHour(start + 16 * minute)).toBeCloseTo(19, 1); // 6 minutes for 16:00–19:00
    expect(cycleHour(start + 17 * minute)).toBeCloseTo(22, 1); // night runs 3 hours a minute
    const cycle = 10 + 6 + 11 / 3;
    expect(cycleHour(start + cycle * minute)).toBeCloseTo(6, 1);
  });

  it('always gives an hour of the day', () => {
    for (let ms = 0; ms < 40 * minute; ms += 7_000) {
      const h = cycleHour(ms);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(24);
    }
  });

  it('names the parts of the day', () => {
    expect(partOfDay(8)).toBe('Morning');
    expect(partOfDay(14)).toBe('Afternoon');
    expect(partOfDay(18)).toBe('Evening');
    expect(partOfDay(23)).toBe('Night');
    expect(partOfDay(3)).toBe('Night');
  });
});

describe('morning mist', () => {
  it('lies over early mornings only, thicker on some days than others', () => {
    for (let day = 0; day < 20; day++) {
      expect(mistAt(3, day)).toBe(0);
      expect(mistAt(12, day)).toBe(0);
      expect(mistAt(20, day)).toBe(0);
      expect(mistAt(7, day)).toBeGreaterThan(0.3);
      expect(mistAt(7, day)).toBeLessThanOrEqual(1);
    }
    const strengths = new Set(Array.from({ length: 20 }, (_, day) => mistAt(7, day).toFixed(2)));
    expect(strengths.size).toBeGreaterThan(5);
  });
});
