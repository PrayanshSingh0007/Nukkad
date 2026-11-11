import { describe, expect, it } from 'vitest';
import { ClockSync, SnapshotBuffer } from './interpolation.ts';

const s = (x: number, yaw = 0) => ({ x, y: 0, z: 0, yaw, speed: 3, flags: 0 });

describe('interpolation', () => {
  it('blends between snapshots and takes the short way round when turning', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, s(0, 6.2));
    buffer.push(1100, s(10, 0.1));
    const middle = buffer.sample(1050)!;
    expect(middle.x).toBeCloseTo(5);
    expect(Math.cos(middle.yaw)).toBeGreaterThan(0.99); // through 0, not the long way via π
  });

  it('ignores late or duplicate snapshots', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, s(0));
    buffer.push(1100, s(10));
    buffer.push(1050, s(99));
    expect(buffer.sample(1100)!.x).toBe(10);
  });

  it('carries on for 250 ms when snapshots stop, then stops', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, s(0));
    buffer.push(1100, s(10));
    expect(buffer.sample(1200)!.x).toBeCloseTo(20);
    expect(buffer.sample(2000)!.x).toBeCloseTo(35); // capped at 250 ms ahead
    expect(buffer.sample(2000)!.speed).toBe(0);
  });

  it('draws others ~133 ms in the past on a steady network, more on a shaky one', () => {
    const steady = new ClockSync();
    for (let i = 0; i < 50; i++) steady.observe(i * 66.7, 5000 + i * 66.7);
    expect(steady.delay).toBeCloseTo(133.3, 0);
    const shaky = new ClockSync();
    for (let i = 0; i < 50; i++) shaky.observe(i * 66.7, 5000 + i * 66.7 + (i % 3) * 80);
    expect(shaky.delay).toBeGreaterThan(160);
    expect(shaky.delay).toBeLessThanOrEqual(400);
  });
});
