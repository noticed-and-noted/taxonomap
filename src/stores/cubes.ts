/**
 * Whether the map draws hexes from the pre-counted cubes where it can (map settings, experimental),
 * remembered per browser. Off unless turned on, and only offered when the build has cubes to read
 * (PUBLIC_CUBES_BASE).
 */
import { atom } from 'nanostores';
import type { CubeSet } from '~/lib/cubes/reader';
import { env } from '~/lib/env';

export const CUBES_KEY = 'map-cubes';
const ON = 'on';

/** Where the cubes are published (their latest.json's folder), or null when this build has none. */
export const CUBES_BASE: string | null = env['PUBLIC_CUBES_BASE'] || null;

function saved(): boolean {
  try {
    return localStorage.getItem(CUBES_KEY) === ON;
  } catch {
    return false;
  }
}

export const $cubesOn = atom(typeof window !== 'undefined' && CUBES_BASE !== null && saved());

/** The cubes once opened (see openedCubes); null until then. */
export const $openCubes = atom<CubeSet | null>(null);

let opening: Promise<CubeSet> | null = null;

/**
 * The cubes, opened the first time any page asks for them (the map, the tree of life, a species page),
 * and kept for the visit.
 * @throws Error when the build has no cubes, or they can't be read (the next call tries again)
 */
export function openedCubes(): Promise<CubeSet> {
  const open = $openCubes.get();
  if (open) return Promise.resolve(open);
  opening ??= (async () => {
    if (!CUBES_BASE) throw new Error('This build has no cubes');
    const { openCubes } = await import('~/lib/cubes/reader');
    const cubes = await openCubes(CUBES_BASE);
    $openCubes.set(cubes);
    return cubes;
  })();
  opening.catch(() => (opening = null));
  return opening;
}

/**
 * Turn the cube hexes on or off.
 * @param isOn Whether the map reads the cubes where it can.
 */
export function setCubesOn(isOn: boolean) {
  try {
    if (isOn) localStorage.setItem(CUBES_KEY, ON);
    else localStorage.removeItem(CUBES_KEY);
  } catch {
    /* Storage unavailable (private mode, blocked): keep the in-memory choice. */
  }
  $cubesOn.set(isOn && CUBES_BASE !== null);
}
