/**
 * Height fixes: our own corrections for buildings whose height is missing or wrong
 * on the map. A fix wins over the map tags and over every guess.
 *
 * How to add one:
 *   1. Find the building on openstreetmap.org (right-click → "Query features") and copy its way id.
 *   2. Add a line below: `<id>: { levels: <floors> }`  or  `<id>: { height: <metres> }`.
 *   3. Raise PACK_VERSION by one in packages/shared/src/constants.ts, so the server and
 *      every browser throw away their saved copy of the place and build it again.
 *
 * Even better for everyone: add `building:levels` to the building on openstreetmap.org.
 */
export interface HeightFix {
  /** Number of floors. */
  levels?: number;
  /** Total height in metres (wins over `levels`). */
  height?: number;
}

export type HeightFixes = Record<number, HeightFix>;

export const HEIGHT_FIXES: HeightFixes = {
  // Test area — the ten apartment blocks around the centre have no floor count on the map.
  // Until real numbers are filled in they copy the two mapped 16-floor towers next to them.
  // Remove the `//` and put the real floor count:
  // 1324949652: { levels: 16 }, // block A1
  // 1324949653: { levels: 16 }, // block A2
  // 1070483721: { levels: 16 }, // block A3
  // 1324949659: { levels: 16 }, // block B1
  // 1324949658: { levels: 16 }, // block B2
  // 1324322245: { levels: 16 }, // block B3
  // 1324949657: { levels: 16 }, // block C1
  // 1324949656: { levels: 16 }, // block C2
  // 1324949655: { levels: 16 }, // block C3
  // 1324949654: { levels: 16 }, // block C4
};
