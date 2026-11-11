import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, HAIR_STYLES, OUTFITS, OUTFIT_COLORS, SKIN_TONES, randomLook, sanitizeLook } from './avatar.ts';
import { makeRng } from './util/random.ts';

describe('avatar look', () => {
  it('keeps valid choices', () => {
    const look = { skin: 5, hair: 3, hairColor: 8, outfit: 2, color: 9 };
    expect(sanitizeLook(look)).toEqual(look);
  });

  it('replaces anything invalid with the default, field by field', () => {
    expect(sanitizeLook(null)).toEqual(DEFAULT_LOOK);
    expect(sanitizeLook('hello')).toEqual(DEFAULT_LOOK);
    expect(sanitizeLook({ skin: 99, hair: -1, hairColor: 1.5, outfit: '2', color: 4, extra: 'x' })).toEqual({ ...DEFAULT_LOOK, color: 4 });
  });

  it('makes random looks that are always valid', () => {
    const random = makeRng(7);
    for (let i = 0; i < 200; i++) {
      const look = randomLook(random);
      expect(sanitizeLook(look)).toEqual(look);
      expect(look.skin).toBeLessThan(SKIN_TONES.length);
      expect(look.hair).toBeLessThan(HAIR_STYLES.length);
      expect(look.outfit).toBeLessThan(OUTFITS.length);
      expect(look.color).toBeLessThan(OUTFIT_COLORS.length);
    }
  });
});
