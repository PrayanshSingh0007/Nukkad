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

/**
 * Outfits. New ones go at the end, so saved looks and old messages keep their meaning.
 * tee = tee + jeans · hoodie · kurta (with pyjama) · jacket · crop = crop top + jeans ·
 * skirt = top + knee skirt · dress = sleeveless dress · shirt = shirt + jeans · shorts = tee + shorts.
 */
export const OUTFITS = ['tee', 'hoodie', 'kurta', 'jacket', 'crop', 'skirt', 'dress', 'shirt', 'shorts'] as const;
/** Two body builds (open to everyone, any combination with anything else). */
export const BUILDS = ['Build 1', 'Build 2'] as const;
export const HAIR_STYLES = ['short', 'long', 'bun', 'curly', 'cap', 'none'] as const;

export const OUTFIT_LABELS: Record<(typeof OUTFITS)[number], string> = {
  tee: 'Tee & jeans',
  hoodie: 'Hoodie',
  kurta: 'Kurta',
  jacket: 'Jacket',
  crop: 'Crop top',
  skirt: 'Top & skirt',
  dress: 'Dress',
  shirt: 'Shirt & jeans',
  shorts: 'Tee & shorts',
};

/**
 * What people on the street usually wear with each build (index into OUTFITS). Players can still
 * pick any outfit with any build; this only shapes the crowd and a first-time look.
 */
export const USUAL_OUTFITS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 7, 8, 7, 0], // build 1: tee & jeans, hoodie, kurta, jacket, shirt & jeans (often), tee & shorts
  [4, 5, 6, 2, 0, 4, 6, 1], // build 2: crop top (often), top & skirt, dress (often), kurta, tee & jeans, hoodie
];
export const HAIR_LABELS: Record<(typeof HAIR_STYLES)[number], string> = {
  short: 'Short',
  long: 'Long',
  bun: 'Bun',
  curly: 'Crop',
  cap: 'Buzz',
  none: 'None',
};

/**
 * Ready-made realistic people (Microsoft Rocketbox avatars, in this order in the game's
 * ROCKETBOX_AVATARS), after "Classic" = the customisable body. Their clothes, skin and hair are
 * part of the model; the other look fields only apply to Classic.
 */
export const PEOPLE = ['Classic', 'Asha', 'Meera', 'Priya', 'Divya', 'Arjun', 'Rahul', 'Kiran', 'Vikram'] as const;

/** Every field is an index into one of the lists above. */
export interface AvatarLook {
  skin: number;
  hair: number;
  hairColor: number;
  outfit: number;
  color: number;
  /** Index into BUILDS (older saved looks have none → 0). */
  build: number;
  /** Index into PEOPLE: 0 = Classic (customisable), 1–8 a realistic person. */
  person: number;
  /** A realistic person's top: 0 = as they come, 1–10 = dyed OUTFIT_COLORS[tint − 1]. */
  tint: number;
}

const LIMITS: Record<keyof AvatarLook, number> = {
  skin: SKIN_TONES.length,
  hair: HAIR_STYLES.length,
  hairColor: HAIR_COLORS.length,
  outfit: OUTFITS.length,
  color: OUTFIT_COLORS.length,
  build: BUILDS.length,
  person: PEOPLE.length,
  tint: OUTFIT_COLORS.length + 1,
};

export const DEFAULT_LOOK: AvatarLook = { skin: 2, hair: 0, hairColor: 0, outfit: 0, color: 5, build: 0, person: 5, tint: 0 };

/** Turns anything (saved data, a network message) into a valid look. Bad fields fall back to the default. */
export function sanitizeLook(value: unknown): AvatarLook {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const look = { ...DEFAULT_LOOK };
  for (const key of Object.keys(LIMITS) as (keyof AvatarLook)[]) {
    const field = input[key];
    if (typeof field === 'number' && Number.isInteger(field) && field >= 0 && field < LIMITS[key]) look[key] = field;
  }
  // Looks saved before the realistic people existed get one that matches their build.
  if (input.person === undefined) look.person = look.build === 1 ? 1 : 5;
  return look;
}

/** A look picked from a seed, so a first-time player does not look like everyone else. */
export function randomLook(random: () => number): AvatarLook {
  const pick = (count: number): number => Math.floor(random() * count);
  const skin = pick(SKIN_TONES.length);
  const hair = pick(HAIR_STYLES.length - 1); // not "none" by default
  const hairColor = pick(5); // natural colours by default
  const build = pick(BUILDS.length);
  const usual = USUAL_OUTFITS[build] ?? USUAL_OUTFITS[0];
  const outfit = usual[pick(usual.length)];
  const color = pick(OUTFIT_COLORS.length);
  // A realistic person matching the build (1–4 women, 5–8 men in PEOPLE).
  const person = (build === 1 ? 1 : 5) + pick(4);
  const tint = random() < 0.4 ? 0 : 1 + pick(OUTFIT_COLORS.length);
  return { skin, hair, hairColor, outfit, color, build, person, tint };
}
