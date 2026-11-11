import { PACK_VERSION } from '@nukkad/shared';

/**
 * Address of the Area Pack for a spot. The pack version is part of the address, so
 * after an update a browser never reuses a cached pack in an old format.
 */
export function areaUrl(lat: number, lng: number, halfSize = 0): string {
  const base: string = import.meta.env.VITE_SERVER_URL ?? '';
  const radius = halfSize > 0 ? `&r=${halfSize}` : '';
  return `${base}/api/areas?lat=${lat}&lng=${lng}${radius}&v=${PACK_VERSION}`;
}
