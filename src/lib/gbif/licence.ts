import type { Media, Occurrence } from './types';

export type AllowedLicence = 'CC0' | 'CC-BY' | 'CC-BY-SA' | 'CC-BY-ND' | 'CC-BY-NC' | 'CC-BY-NC-SA' | 'CC-BY-NC-ND';

/**
 * GBIF enum values for server-side filtering of image searches. These are
 * record licences: GBIF only accepts these three for datasets, so the
 * ShareAlike and NoDerivatives licences only ever appear on individual media.
 */
export const ALLOWED_LICENCE_ENUMS = ['CC0_1_0', 'CC_BY_4_0', 'CC_BY_NC_4_0'] as const;

export const LICENCE_URLS: Record<AllowedLicence, string> = {
  CC0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-SA': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC-BY-ND': 'https://creativecommons.org/licenses/by-nd/4.0/',
  'CC-BY-NC': 'https://creativecommons.org/licenses/by-nc/4.0/',
  'CC-BY-NC-SA': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  'CC-BY-NC-ND': 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
};

/** Licence code (the part after "by", in any order) → licence. */
const BY_CODES: Record<string, AllowedLicence> = {
  by: 'CC-BY',
  'by-sa': 'CC-BY-SA',
  'by-nd': 'CC-BY-ND',
  'by-nc': 'CC-BY-NC',
  'by-nc-sa': 'CC-BY-NC-SA',
  'by-nc-nd': 'CC-BY-NC-ND',
};

/**
 * Parse a licence string (URL, enum or label) into an allowed licence, or
 * null if it is anything else ("Copyright", free text, unknown CC tools…).
 * Every CC licence is allowed (agreed 2026-10-15), including ShareAlike and
 * NoDerivatives, though cards crop photos and link previews composite them.
 */
export function parseLicence(raw: string | undefined | null): AllowedLicence | null {
  if (!raw) return null;
  const normalised = raw.trim().toLowerCase();
  if (/publicdomain\/zero|\bcc0\b|cc0_1_0/.test(normalised)) return 'CC0';
  const code =
    normalised.match(/creativecommons\.org\/licenses\/([a-z-]+)\//)?.[1] ??
    normalised.match(/^cc[ _-]?(by(?:[ _-](?:nc|nd|sa))*)(?:[ _-]\d|$)/)?.[1];
  if (!code) return null;
  // Normalise separators and order (older licences wrote "by-nd-nc").
  const parts = code.split(/[ _-]/).filter((part) => part !== 'by');
  const key = ['by', ...['nc', 'nd', 'sa'].filter((part) => parts.includes(part))].join('-');
  return BY_CODES[key] ?? null;
}

interface ImageBase {
  url: string;
  licence: AllowedLicence;
  creator?: string;
  rightsHolder?: string;
  publisher?: string;
  references?: string;
}

/** A photo on a GBIF occurrence record, served through GBIF's image cache. */
export interface GbifImage extends ImageBase {
  source?: 'gbif';
  occurrenceKey: number;
  /** Species of the record the image belongs to (for grouping). */
  speciesKey?: number;
  datasetKey: string;
}

/**
 * A photo served by iNaturalist itself (a taxon's curated photos or an
 * observation's). `url` is any size of the photo; see thumbnailUrl.
 */
export interface InatImage extends ImageBase {
  source: 'inat';
  photoId: number;
  /** The observation the photo belongs to, when known. */
  observationUrl?: string;
}

export type UsableImage = GbifImage | InatImage;

/**
 * Rule (agreed 2026-10-12, widened to every CC licence 2026-10-15): an
 * image's own licence wins when it is a recognisable Creative Commons
 * licence. When the media licence is empty or free text ("Copyright by the
 * creator…"), the record licence decides.
 */
export function usableImages(occurrence: Occurrence): GbifImage[] {
  const recordLicence = parseLicence(occurrence.license);
  const images: GbifImage[] = [];
  for (const media of occurrence.media ?? []) {
    if (media.type && media.type !== 'StillImage') continue;
    if (!media.identifier) continue;
    const licence = mediaLicence(media, recordLicence);
    if (!licence) continue;
    images.push({
      url: media.identifier,
      licence,
      occurrenceKey: occurrence.key,
      datasetKey: occurrence.datasetKey,
      ...(occurrence.speciesKey !== undefined && { speciesKey: occurrence.speciesKey }),
      ...(media.creator && { creator: media.creator }),
      ...((media.rightsHolder ?? occurrence.rightsHolder) && {
        rightsHolder: (media.rightsHolder ?? occurrence.rightsHolder) as string,
      }),
      ...((media.publisher ?? occurrence.publisher) && {
        publisher: (media.publisher ?? occurrence.publisher) as string,
      }),
      ...(media.references && { references: media.references }),
    });
  }
  return images;
}

/** A sound on a GBIF occurrence record, played straight from its publisher (iNaturalist, xeno-canto…). */
export interface UsableSound {
  url: string;
  licence: AllowedLicence;
  creator?: string;
  rightsHolder?: string;
  /** Where it was recorded, no finer than the country: an observation's own place text can be someone's street. */
  country?: string;
  /** The iNaturalist observation it belongs to, when known. */
  observationUrl?: string;
}

/** A record's playable sounds, licensed by the same rule as usableImages. */
export function usableSounds(occurrence: Occurrence): UsableSound[] {
  const recordLicence = parseLicence(occurrence.license);
  return (occurrence.media ?? []).flatMap((media) => {
    if (media.type !== 'Sound' || !media.identifier) return [];
    // Some identifiers are a web page about the sound, not the file itself.
    if (media.format && !media.format.startsWith('audio/')) return [];
    const licence = mediaLicence(media, recordLicence);
    if (!licence) return [];
    const rightsHolder = media.rightsHolder ?? occurrence.rightsHolder;
    return [
      {
        url: media.identifier,
        licence,
        ...(media.creator && { creator: media.creator }),
        ...(rightsHolder && { rightsHolder }),
      },
    ];
  });
}

/** Whether a licence string names a specific CC licence (allowed or not). */
export function isCreativeCommons(raw: string | undefined | null): boolean {
  return !!raw && /creativecommons\.org\/(licenses|publicdomain)\/|^\s*cc[ _-]?(0|by)/i.test(raw);
}

function mediaLicence(item: Media, recordLicence: AllowedLicence | null): AllowedLicence | null {
  if (isCreativeCommons(item.license)) return parseLicence(item.license);
  return recordLicence;
}

/** Attribution line: "© creator · CC-BY". */
export function attribution(image: Pick<UsableImage, 'creator' | 'rightsHolder' | 'licence'>): string {
  const credit = image.creator ?? image.rightsHolder;
  return credit ? `© ${credit} · ${image.licence}` : image.licence;
}
