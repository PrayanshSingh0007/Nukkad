import { randomLook, sanitizeLook } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';

/** The avatar choice lives only in this browser (PLAN §9: no signup, nothing about you on our server). */
const KEY = 'nukkad.avatar';

export function loadLook(): AvatarLook {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return sanitizeLook(JSON.parse(saved));
  } catch {
    // Private mode or broken data: fall through to a fresh look.
  }
  const look = randomLook(Math.random);
  saveLook(look);
  return look;
}

export function saveLook(look: AvatarLook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // Storage can be blocked; the look then simply lasts until the page closes.
  }
}
