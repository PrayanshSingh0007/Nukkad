/**
 * What a player's avatar looks like. Only small numbers are stored and (later) sent
 * over the network: positions in the lists below. Every combination is allowed for
 * everyone — there are no "boy" or "girl" options.
 */
export const SKIN_TONES = ['#f6d7c3', '#eabf9f', '#d19f7a', '#b07a55', '#8a5a3c', '#5c3a26'] as const;

export const HAIR_COLORS = ['#1f1a17', '#3b2a20', '#6b4a2f', '#a8743c', '#d8b26a', '#9a9aa0', '#b5443a', '#3f6fb0', '#7a4fb0'] as const;

export const OUTFIT_COLORS = [
  '#e4572e',
  '#f2a541',
  '#f5d547',
  '#4caf7a',
  '#3aa6b9',
  '#3f6fd8',
  '#8b5cf6',
  '#e56bb0',
  '#f1f1ee',
  '#33373d',
] as const;

export const OUTFITS = ['tee', 'hoodie', 'kurta', 'jacket'] as const;
/** Two body builds (open to everyone, any combination with anything else). */
export const BUILDS = ['Build 1', 'Build 2'] as const;
export const HAIR_STYLES = ['short', 'long', 'bun', 'curly', 'cap', 'none'] as const;

export const OUTFIT_LABELS: Record<(typeof OUTFITS)[number], string> = { tee: 'Tee', hoodie: 'Hoodie', kurta: 'Kurta', jacket: 'Jacket' };
export const HAIR_LABELS: Record<(typeof HAIR_STYLES)[number], string> = {
  short: 'Short',
  long: 'Long',
  bun: 'Bun',
  curly: 'Crop',
  cap: 'Buzz',
  none: 'None',
};

/** Every field is an index into one of the lists above. */
export interface AvatarLook {
  skin: number;
  hair: number;
  hairColor: number;
  outfit: number;
  color: number;
  /** Index into BUILDS (older saved looks have none → 0). */
  build: number;
}

const LIMITS: Record<keyof AvatarLook, number> = {
  skin: SKIN_TONES.length,
  hair: HAIR_STYLES.length,
  hairColor: HAIR_COLORS.length,
  outfit: OUTFITS.length,
  color: OUTFIT_COLORS.length,
  build: BUILDS.length,
};

export const DEFAULT_LOOK: AvatarLook = { skin: 2, hair: 0, hairColor: 0, outfit: 0, color: 5, build: 0 };

/** Turns anything (saved data, a network message) into a valid look. Bad fields fall back to the default. */
export function sanitizeLook(value: unknown): AvatarLook {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const look = { ...DEFAULT_LOOK };
  for (const key of Object.keys(LIMITS) as (keyof AvatarLook)[]) {
    const field = input[key];
    if (typeof field === 'number' && Number.isInteger(field) && field >= 0 && field < LIMITS[key]) look[key] = field;
  }
  return look;
}

/** A look picked from a seed, so a first-time player does not look like everyone else. */
export function randomLook(random: () => number): AvatarLook {
  const pick = (count: number): number => Math.floor(random() * count);
  return {
    skin: pick(SKIN_TONES.length),
    hair: pick(HAIR_STYLES.length - 1), // not "none" by default
    hairColor: pick(5), // natural colours by default
    outfit: pick(OUTFITS.length),
    color: pick(OUTFIT_COLORS.length),
    build: pick(BUILDS.length),
  };
}
