import { hash32 } from './util/random.ts';

/**
 * Places that make the world feel lived in: shops, food, schools, offices, malls…
 * Where OpenStreetMap knows a place we keep its KIND and position — never its name.
 * Every name shown in Nukkad is made up here (legal rule: no real shop or brand names),
 * from the place's seed, so all players read the same sign.
 */
export const PLACE_KINDS = [
  'supermarket',
  'grocery',
  'food',
  'cafe',
  'bakery',
  'pharmacy',
  'clinic',
  'salon',
  'clothes',
  'mobile',
  'bank',
  'gym',
  'school',
  'college',
  'office',
  'hotel',
  'mall',
  'showroom',
  'shop',
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export interface PackPlace {
  kind: PlaceKind;
  /** Where the sign hangs, decimetres. */
  x: number;
  z: number;
  /** Height of the sign above the ground, decimetres. */
  y: number;
  /** Turn around the up axis, whole degrees, for a sign whose front looks towards +z. */
  face: number;
  /** Sign width, decimetres. */
  w: number;
  seed: number;
  /** 1 = this kind of place really is here on the map · 0 = invented by us. */
  real: 0 | 1;
}

const FIRST = [
  'Lakshmi',
  'Shanti',
  'Sunrise',
  'Green Leaf',
  'Lotus',
  'Peacock',
  'Banyan',
  'Silver Oak',
  'Blue Sky',
  'Tulsi',
  'Jasmine',
  'Mango Tree',
  'Lakeside',
  'Hilltop',
  'Orchid',
  'Little Star',
  'Golden Sparrow',
  'Garden City',
  'Coconut Grove',
  'Malnad',
  'Namma',
  'Rangoli',
  'Monsoon',
  'Marigold',
];

const LAST: Record<PlaceKind, string[]> = {
  supermarket: ['Supermarket', 'Fresh Mart', 'Hyper Bazaar'],
  grocery: ['Stores', 'Provision Store', 'Fruits & Veg', 'Kirana'],
  food: ['Tiffin Room', 'Darshini', 'Meals', 'Biryani House', 'Dosa Corner'],
  cafe: ['Cafe', 'Coffee House', 'Chai Stop', 'Juice Bar'],
  bakery: ['Bakery', 'Cakes & Bakes', 'Sweets'],
  pharmacy: ['Medicals', 'Pharmacy'],
  clinic: ['Clinic', 'Health Centre', 'Dental Care'],
  salon: ['Salon', 'Hair Studio', 'Beauty Parlour'],
  clothes: ['Fashions', 'Silks', 'Tailors', 'Garments'],
  mobile: ['Mobiles', 'Electronics', 'Gadget Hub'],
  bank: ['Co-op Bank', 'Bank'],
  gym: ['Fitness', 'Gym', 'Yoga Studio'],
  school: ['Public School', 'High School', 'Kids School'],
  college: ['College', 'Institute'],
  office: ['Tech Park', 'Business Centre', 'Towers', 'Workspaces'],
  hotel: ['Residency', 'Grand Inn', 'Comforts'],
  mall: ['Mall', 'Galleria', 'Plaza'],
  showroom: ['Motors', 'Wheels', 'Auto World'],
  shop: ['Stores', 'Traders', 'Enterprises', 'Fancy Store'],
};

/** The made-up name on a place's sign. Same seed → same name on every device. */
export function placeName(kind: PlaceKind, seed: number): string {
  const first = FIRST[hash32(seed, 71) % FIRST.length];
  const last = LAST[kind][hash32(seed, 72) % LAST[kind].length];
  return `${first} ${last}`;
}

/** Sign background colours by kind (web colours). */
export const PLACE_COLORS: Record<PlaceKind, string> = {
  supermarket: '#1f8a4c',
  grocery: '#2e7d32',
  food: '#c62828',
  cafe: '#6d4c41',
  bakery: '#ad1457',
  pharmacy: '#00897b',
  clinic: '#0277bd',
  salon: '#8e24aa',
  clothes: '#d84315',
  mobile: '#283593',
  bank: '#1565c0',
  gym: '#37474f',
  school: '#f9a825',
  college: '#ef6c00',
  office: '#455a64',
  hotel: '#5d4037',
  mall: '#c2185b',
  showroom: '#212121',
  shop: '#00695c',
};
