/** Turns OpenStreetMap colour tags ("white", "light grey", "#d8c8a8") into "#rrggbb", or undefined. */
const NAMED: Record<string, string> = {
  white: '#f2f0ea',
  cream: '#efe4c8',
  beige: '#e2d3b4',
  yellow: '#e8cf6a',
  orange: '#e09a4a',
  red: '#b5463a',
  maroon: '#7a2e2e',
  pink: '#e6a4b0',
  brown: '#8a5f42',
  tan: '#c9a77c',
  grey: '#9da2a6',
  gray: '#9da2a6',
  silver: '#c3c7cb',
  black: '#2b2d30',
  blue: '#5f86b8',
  lightblue: '#a9c6e0',
  green: '#7aa36a',
  lightgreen: '#b4d39a',
  purple: '#8a6aa8',
};

export function parseColour(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return '#' + [...text.slice(1)].map((c) => c + c).join('');
  const plain = text.replace(/[\s_-]/g, '');
  if (NAMED[plain]) return NAMED[plain];
  const last = text.split(/[\s_-]/).pop() ?? '';
  return NAMED[last];
}

const MATERIALS = ['glass', 'brick', 'concrete', 'stone', 'metal', 'wood', 'plaster'] as const;
export type FacadeMaterial = (typeof MATERIALS)[number];

export function parseMaterial(value: string | undefined): FacadeMaterial | undefined {
  const text = value?.trim().toLowerCase();
  if (!text) return undefined;
  if (text === 'mirror' || text === 'glass_facade') return 'glass';
  if (text === 'cement_block' || text === 'reinforced_concrete') return 'concrete';
  return (MATERIALS as readonly string[]).includes(text) ? (text as FacadeMaterial) : undefined;
}
