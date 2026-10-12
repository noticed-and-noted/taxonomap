import type { Media, Occurrence } from './types';

export type AllowedLicence = 'CC0' | 'CC-BY' | 'CC-BY-NC';

/** GBIF enum values for server-side filtering of image searches. */
export const ALLOWED_LICENCE_ENUMS = ['CC0_1_0', 'CC_BY_4_0', 'CC_BY_NC_4_0'] as const;

export const LICENCE_URLS: Record<AllowedLicence, string> = {
  CC0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-NC': 'https://creativecommons.org/licenses/by-nc/4.0/',
};

/**
 * Parse a licence string (URL, enum or label) into an allowed licence, or
 * null if it is anything else (SA/ND variants, "Copyright", free text…).
 */
export function parseLicence(raw: string | undefined | null): AllowedLicence | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (/publicdomain\/zero|\bcc0\b|cc0_1_0/.test(s)) return 'CC0';
  const url = s.match(/creativecommons\.org\/licenses\/([a-z-]+)\//);
  const code = url?.[1] ?? s.match(/^cc[ _-]?(by(?:[ _-]nc)?)(?:[ _-]\d|$)/)?.[1]?.replace(/[ _]/g, '-');
  if (code === 'by') return 'CC-BY';
  if (code === 'by-nc') return 'CC-BY-NC';
  return null;
}

export interface UsableImage {
  url: string;
  licence: AllowedLicence;
  creator?: string;
  rightsHolder?: string;
  occurrenceKey: number;
  datasetKey: string;
  publisher?: string;
  references?: string;
}

/**
 * Rule (agreed 2026-10-12): an image's own licence wins when it is a
 * recognisable Creative Commons licence: allowed if CC0/BY/BY-NC, rejected
 * if anything else (SA, ND…). When the media licence is empty or free text
 * ("Copyright by the creator…"), the record licence decides.
 */
export function usableImages(occ: Occurrence): UsableImage[] {
  const recordLicence = parseLicence(occ.license);
  const out: UsableImage[] = [];
  for (const m of occ.media ?? []) {
    if (m.type && m.type !== 'StillImage') continue;
    if (!m.identifier) continue;
    const licence = mediaLicence(m, recordLicence);
    if (!licence) continue;
    out.push({
      url: m.identifier,
      licence,
      occurrenceKey: occ.key,
      datasetKey: occ.datasetKey,
      ...(m.creator && { creator: m.creator }),
      ...((m.rightsHolder ?? occ.rightsHolder) && { rightsHolder: (m.rightsHolder ?? occ.rightsHolder) as string }),
      ...((m.publisher ?? occ.publisher) && { publisher: (m.publisher ?? occ.publisher) as string }),
      ...(m.references && { references: m.references }),
    });
  }
  return out;
}

/** Whether a licence string names a specific CC licence (allowed or not). */
export function isCreativeCommons(raw: string | undefined | null): boolean {
  return !!raw && /creativecommons\.org\/(licenses|publicdomain)\/|^\s*cc[ _-]?(0|by)/i.test(raw);
}

function mediaLicence(m: Media, recordLicence: AllowedLicence | null): AllowedLicence | null {
  if (isCreativeCommons(m.license)) return parseLicence(m.license);
  return recordLicence;
}

/** Attribution line: "© creator · CC-BY". */
export function attribution(img: Pick<UsableImage, 'creator' | 'rightsHolder' | 'licence'>): string {
  const who = img.creator ?? img.rightsHolder;
  return who ? `© ${who} · ${img.licence}` : img.licence;
}
