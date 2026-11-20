import { describe, expect, it } from 'vitest';
import { SCOOTER, VEHICLES, driveAccel, gearAt, specForModel } from './vehicleSpecs.ts';
import type { VehicleSpec } from './vehicleSpecs.ts';

/** Seconds from standing to `kmh` at full throttle (no gear-change dips), or Infinity. */
function timeTo(s: VehicleSpec, kmh: number): number {
  let v = 0;
  let t = 0;
  while (v < kmh / 3.6) {
    v = Math.min(s.maxSpeed, v + driveAccel(s, v) * 0.01);
    t += 0.01;
    if (t > 300) return Infinity;
  }
  return t;
}

describe('real vehicle performance', () => {
  it('matches the real 0–100 and 0–60 times', () => {
    expect(timeTo(VEHICLES.hatchback, 100)).toBeCloseTo(13, 0);
    expect(timeTo(VEHICLES.motorbike, 60)).toBeCloseTo(5, 0);
    expect(timeTo(SCOOTER, 60)).toBeCloseTo(5.5, 0);
    expect(timeTo(specForModel(VEHICLES.sedan, 'bmw_m3'), 100)).toBeCloseTo(3.9, 0);
    expect(timeTo(specForModel(VEHICLES.sedan, 'city'), 100)).toBeCloseTo(10.5, 0);
  });

  it('reaches the real top speed and the limiter holds it there', () => {
    for (const [s, kmh] of [
      [VEHICLES.motorbike, 115],
      [VEHICLES.hatchback, 150],
      [specForModel(VEHICLES.sedan, 'bmw_m3'), 250],
      [specForModel(VEHICLES.suv, 'thar'), 155],
      [VEHICLES.bus, 80],
    ] as const) {
      expect(s.maxSpeed * 3.6).toBeCloseTo(kmh, 0);
      expect(timeTo(s, kmh * 0.99)).toBeLessThan(120);
      expect(driveAccel(s, s.maxSpeed)).toBeGreaterThan(0); // still pulling: the limiter, not drag, stops it
    }
  });

  it('pulls hardest at low speed and less and less as speed rises', () => {
    const s = VEHICLES.hatchback;
    expect(driveAccel(s, 5)).toBeGreaterThan(driveAccel(s, 20));
    expect(driveAccel(s, 20)).toBeGreaterThan(driveAccel(s, 38));
  });

  it('shifts up through the gears', () => {
    const s = specForModel(VEHICLES.sedan, 'city');
    expect(gearAt(s, 1)).toBe(1);
    expect(gearAt(s, s.maxSpeed)).toBe(6);
    expect(gearAt(SCOOTER, 20)).toBe(1); // electric: no gears
  });

  it('keeps each kind when the model is unknown', () => {
    expect(specForModel(VEHICLES.sedan, undefined)).toBe(VEHICLES.sedan);
    expect(specForModel(VEHICLES.sedan, 'not-a-car')).toBe(VEHICLES.sedan);
  });
});
