/**
 * The How filter's recorders: people's names exactly as GBIF holds them (an
 * iNaturalist observer's display name, or their login), records by any of
 * them shown. The names themselves are the URL's values.
 */
import { codecs, urlAtom } from './url-sync';

/** Most recorders the filter accepts (keeps URLs and requests short). */
export const MAX_RECORDERS = 10;

// GBIF splits recorder lists on "|", so a name never holds one, and it can join them in the URL.
const RECORDER_SEPARATOR = '|';

const RECORDER_NAME = /^[^|]{1,200}$/;

export const $recorders = urlAtom(
  codecs.stringSet(
    'recorder',
    { pattern: RECORDER_NAME, limit: MAX_RECORDERS, separator: RECORDER_SEPARATOR },
    { scope: 'map' },
  ),
);

/** Add a picked recorder, unless the filter is full. @returns Whether it was added. */
export function addRecorder(name: string): boolean {
  const names = $recorders.get();
  if (names.includes(name) || names.length >= MAX_RECORDERS) return false;
  $recorders.set([...names, name].sort());
  return true;
}

/** Remove one recorder from the filter. */
export function removeRecorder(name: string): void {
  $recorders.set($recorders.get().filter((existing) => existing !== name));
}
