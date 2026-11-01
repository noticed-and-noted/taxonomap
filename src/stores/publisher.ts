/**
 * The How filter's publishers: GBIF publishing organisations, records from any
 * of them shown. The URL holds their keys; names come from the picker or, for
 * a shared link, from GBIF.
 */
import { atom, onMount } from 'nanostores';
import { getOrganization, type OrganizationSuggestion } from '~/lib/gbif';
import { codecs, urlAtom } from './url-sync';

/** Most publishers the filter accepts (keeps URLs and requests short). */
export const MAX_PUBLISHERS = 10;

const ORGANIZATION_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const $publisherKeys = urlAtom(
  codecs.stringSet('publisher', { pattern: ORGANIZATION_KEY, limit: MAX_PUBLISHERS }, { scope: 'map' }),
);

/** Shown in place of a publisher's name while it is looked up, or if GBIF has none. */
export const UNKNOWN_PUBLISHER = 'Publisher';

/** Publisher names by key, for those known so far. */
export const $publisherNames = atom<Record<string, string>>({});

/** A publisher's name, or UNKNOWN_PUBLISHER until it is known. */
export const publisherName = (key: string): string => $publisherNames.get()[key] ?? UNKNOWN_PUBLISHER;

function rememberName(key: string, title: string): void {
  $publisherNames.set({ ...$publisherNames.get(), [key]: title });
}

async function lookUpMissingNames(keys: readonly string[]): Promise<void> {
  const missing = keys.filter((key) => !(key in $publisherNames.get()));
  await Promise.all(
    missing.map(async (key) => {
      try {
        rememberName(key, (await getOrganization(key)).title);
      } catch {
        // The filter still applies; its pill keeps the stand-in name.
      }
    }),
  );
}

// Only look names up while something shows them, so builds and tests make no requests.
onMount($publisherNames, () => $publisherKeys.subscribe((keys) => void lookUpMissingNames(keys)));

/** Add a picked publisher, unless the filter is full. @returns Whether it was added. */
export function addPublisher(publisher: OrganizationSuggestion): boolean {
  const keys = $publisherKeys.get();
  if (keys.includes(publisher.key) || keys.length >= MAX_PUBLISHERS) return false;
  rememberName(publisher.key, publisher.title);
  $publisherKeys.set([...keys, publisher.key].sort());
  return true;
}

/** Remove one publisher from the filter. */
export function removePublisher(key: string): void {
  $publisherKeys.set($publisherKeys.get().filter((existing) => existing !== key));
}
