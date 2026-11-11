import type * as RapierModule from '@dimforge/rapier3d';

/** The Rapier physics engine module (WASM). Loaded on demand as its own download. */
export type Rapier = typeof RapierModule;

let loading: Promise<Rapier> | null = null;

/** Starts loading the engine once; later calls get the same promise. */
export function loadRapier(): Promise<Rapier> {
  loading ??= import('@dimforge/rapier3d');
  return loading;
}
