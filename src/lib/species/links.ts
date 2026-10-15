/**
 * Links to species pages. Pre-rendered species live at /species/{key}/{slug};
 * every other species uses the client-rendered /species/view?key= fallback.
 * The build writes /data/species-manifest.json (key → slug) to decide.
 */
import { atom } from 'nanostores';
import type { SiblingSpecies } from './data';

export type SpeciesManifest = Record<string, string>;

export function speciesPath(key: number, manifest: SpeciesManifest | null | undefined): string {
  const slug = manifest?.[String(key)];
  return slug ? `/species/${key}/${slug}` : `/species/view?key=${key}`;
}

/** Similar species with their page links, for the SimilarSpecies island (which gets no manifest). */
export function similarItems(siblings: readonly SiblingSpecies[], manifest: SpeciesManifest | null | undefined) {
  return siblings.map((s) => ({ ...s, href: speciesPath(s.key, manifest) }));
}

/** Client-side manifest, loaded once on first use. */
export const $speciesManifest = atom<SpeciesManifest | null>(null);
let loading: Promise<SpeciesManifest | null> | undefined;

export function loadSpeciesManifest(): Promise<SpeciesManifest | null> {
  loading ??= fetch('/data/species-manifest.json')
    .then((r) => (r.ok ? (r.json() as Promise<SpeciesManifest>) : null))
    .catch(() => null)
    .then((m) => {
      $speciesManifest.set(m);
      return m;
    });
  return loading;
}
