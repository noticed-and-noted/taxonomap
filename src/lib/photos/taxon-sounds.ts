/**
 * A species' sounds for its page: iNaturalist's research-grade recordings under a Creative Commons
 * licence, most-voted first, each with the country it was recorded in when that is known.
 */
import type { UsableSound } from '~/lib/gbif/licence';
import { countryNames, observationSound, soundObservations, type InatSoundObservation } from './inat';
import { resolveInatIds, type PhotoTaxon } from './taxon-photos';

/** Most recordings a species page offers. */
export const MAX_SOUNDS = 4;

/** Adds each recording's country; the recordings still play without one, so a failed lookup just leaves it out. */
async function withCountries(
  recordings: readonly { observation: InatSoundObservation; sound: UsableSound }[],
  signal?: AbortSignal,
): Promise<UsableSound[]> {
  const placeIds = [...new Set(recordings.flatMap(({ observation }) => observation.place_ids ?? []))];
  const countries = placeIds.length
    ? await countryNames(placeIds, signal).catch(() => new Map<number, string>())
    : new Map<number, string>();

  return recordings.map(({ observation, sound }) => {
    const countryId = observation.place_ids?.find((placeId) => countries.has(placeId));
    const country = countryId === undefined ? undefined : countries.get(countryId);
    return country ? { ...sound, country } : sound;
  });
}

/**
 * Up to MAX_SOUNDS recordings of a species, or none for any other rank, whose recordings would be
 * of whichever species below it came first.
 */
export async function taxonSounds(taxon: PhotoTaxon, signal?: AbortSignal): Promise<UsableSound[]> {
  if (taxon.rank !== 'SPECIES') return [];

  const inatId = (await resolveInatIds([taxon], { ...(signal && { signal }) })).get(taxon.key);
  if (inatId === undefined) return [];

  const observations = await soundObservations(inatId, signal);
  const recordings = observations
    .flatMap((observation) => {
      const sound = observationSound(observation);
      return sound ? [{ observation, sound }] : [];
    })
    .slice(0, MAX_SOUNDS);
  return withCountries(recordings, signal);
}
