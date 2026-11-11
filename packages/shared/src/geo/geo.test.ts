import { describe, expect, it } from 'vitest';
import { areaGeoBox, areaRefFor, clampHalfSize, isValidLatLng, parseAreaId } from './area.ts';
import { makeProjector, tileXY, wrapLng } from './project.ts';
import { hash32, makeRng } from '../util/random.ts';

describe('projection', () => {
  it('round-trips lat/lng through local metres', () => {
    const projector = makeProjector(12.921, 77.695);
    const [x, z] = projector.toLocal(12.925, 77.7);
    const [lat, lng] = projector.toGeo(x, z);
    expect(lat).toBeCloseTo(12.925, 9);
    expect(lng).toBeCloseTo(77.7, 9);
  });

  it('puts north at negative z and east at positive x', () => {
    const projector = makeProjector(10, 20);
    const [x, z] = projector.toLocal(10.001, 20.001);
    expect(z).toBeLessThan(0);
    expect(x).toBeGreaterThan(0);
    expect(-z).toBeCloseTo(111.3, 0);
    expect(x).toBeCloseTo(111.3 * Math.cos((10 * Math.PI) / 180), 0);
  });

  it('wraps longitudes and handles the date line', () => {
    expect(wrapLng(190)).toBeCloseTo(-170);
    const projector = makeProjector(0, 179.9995);
    const [x] = projector.toLocal(0, -179.9995);
    expect(x).toBeCloseTo(111.3, 0);
  });

  it('computes known map tile coordinates', () => {
    expect(tileXY(0, 0, 1)).toEqual([1, 1]);
    const [x, y] = tileXY(12.921, 77.695, 14);
    expect(Math.floor(x)).toBe(11727);
    expect(Math.floor(y)).toBe(7598);
  });
});

describe('area ids', () => {
  it('snaps nearby picks to the same area', () => {
    const a = areaRefFor(12.9206802, 77.695322);
    const b = areaRefFor(12.9209, 77.6951);
    expect(a.id).toBe('a_12921_77695_600');
    expect(b.id).toBe(a.id);
    expect(a.lat).toBe(12.921);
    expect(a.lng).toBe(77.695);
  });

  it('parses its own ids and rejects everything else', () => {
    const ref = areaRefFor(-33.8688, 151.2093, 300);
    expect(parseAreaId(ref.id)).toEqual(ref);
    for (const bad of ['', 'a_1_2', 'a_99999_0_600', 'a_12921_77695_601', 'a_1_2_600; drop', '../etc']) {
      expect(parseAreaId(bad)).toBeNull();
    }
  });

  it('keeps the radius to whole chunks inside the limits', () => {
    expect(clampHalfSize(10)).toBe(150);
    expect(clampHalfSize(500)).toBe(450);
    expect(clampHalfSize(5000)).toBe(600);
  });

  it('validates coordinates', () => {
    expect(isValidLatLng(12, 77)).toBe(true);
    expect(isValidLatLng(89, 0)).toBe(false);
    expect(isValidLatLng(Number.NaN, 0)).toBe(false);
    expect(isValidLatLng('12', 77)).toBe(false);
  });

  it('builds a box of the right size', () => {
    const box = areaGeoBox(areaRefFor(12.921, 77.695));
    expect(box.north).toBeGreaterThan(box.south);
    expect(box.east).toBeGreaterThan(box.west);
    expect((box.north - box.south) * 111320).toBeCloseTo(1200, -1);
  });
});

describe('seeded randomness', () => {
  it('is repeatable and spreads values', () => {
    expect(hash32(12345678901)).toBe(hash32(12345678901));
    expect(hash32(1)).not.toBe(hash32(2));
    expect(hash32(1, 1)).not.toBe(hash32(1, 2));
    const a = makeRng(42);
    const b = makeRng(42);
    const values = Array.from({ length: 100 }, () => a());
    expect(values).toEqual(Array.from({ length: 100 }, () => b()));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
  });
});
