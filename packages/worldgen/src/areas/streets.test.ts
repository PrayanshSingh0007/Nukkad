import { describe, expect, it } from 'vitest';
import { StreetFinder } from './streets.ts';

describe('which street am I on', () => {
  const finder = new StreetFinder([
    { name: 'Outer Ring Road', w: 24, pts: [0, 0, 200, 0] },
    { name: '1st Cross', w: 6, pts: [100, 0, 100, 150] },
  ]);

  it('finds the road you stand on, pavement included', () => {
    expect(finder.at(50, 3)).toBe('Outer Ring Road');
    expect(finder.at(50, 16)).toBe('Outer Ring Road'); // 12 m half width + 5 m pavement
    expect(finder.at(101, 80)).toBe('1st Cross');
  });

  it('picks the nearer road at a junction and nothing off the roads', () => {
    expect(finder.at(100, 1)).toBe('Outer Ring Road');
    expect(finder.at(100, 30)).toBe('1st Cross');
    expect(finder.at(50, 60)).toBeNull();
    expect(finder.at(-500, -500)).toBeNull();
  });
});
