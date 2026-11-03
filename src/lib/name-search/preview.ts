/** What the search preview knows about a taxon without asking any API: its baked iNaturalist ID and lead photo. */
import type { InatImage } from '~/lib/gbif/licence';
import type { NameHit } from '~/lib/gbif/names';
import { toImage } from '~/lib/photos/inat';
import { loadSearchFile } from './files';
import { filePath, PREVIEW_LOOKUP_PATH, previewFileFor, type PreviewColumns } from './format';

const PHOTO_BASE = 'https://inaturalist-open-data.s3.amazonaws.com/photos';
/** The same photo URL shape iNaturalist's API gives; the size is swapped later by thumbnailUrl. */
const PHOTO_URL = /^https:\/\/inaturalist-open-data\.s3\.amazonaws\.com\/photos\/(\d+)\/square(?:\.(\w+))?$/;

/** A baked photo: enough to rebuild what `toImage` makes from iNaturalist's API. */
export interface BakedPhoto {
  photoId: number;
  extension: string;
  licence: string;
  creator: string;
}

/** A taxon's preview row. */
export interface PreviewRow {
  inatId: number;
  photo?: BakedPhoto;
}

/** The photo's URL, built when reading rather than stored whole. An empty extension means none, as sampled. */
function photoUrl({ photoId, extension }: Pick<BakedPhoto, 'photoId' | 'extension'>): string {
  return `${PHOTO_BASE}/${photoId}/square${extension && `.${extension}`}`;
}

/**
 * A photo URL in the form a row can rebuild exactly, or null: such a photo isn't baked, and the
 * preview asks iNaturalist instead.
 */
export function bakeablePhotoUrl(url: string, photoId: number): Pick<BakedPhoto, 'photoId' | 'extension'> | null {
  const match = PHOTO_URL.exec(url);
  if (Number(match?.[1]) !== photoId) return null;
  return { photoId, extension: match?.[2] ?? '' };
}

/** The image a baked photo stands for, the same one `toImage` makes today; null for a licence it rejects. */
export function bakedPhotoImage(photo: BakedPhoto): InatImage | null {
  return toImage({
    id: photo.photoId,
    url: photoUrl(photo),
    license_code: photo.licence,
    ...(photo.creator && { attribution_name: photo.creator }),
  });
}

/** Row `row` of a preview file. */
function readRow(columns: PreviewColumns, row: number): PreviewRow {
  const inatId = columns.inatIds[row]!;
  const photoId = columns.photoIds[row]!;
  if (!photoId) return { inatId };
  const photo = {
    photoId,
    extension: columns.extensions[row]!,
    licence: columns.licences[row]!,
    creator: columns.creators[row]!,
  };
  return { inatId, photo };
}

/**
 * A taxon's preview row, or null when it has none.
 * @throws Error when a file can't be fetched.
 */
async function loadPreviewRow(key: number): Promise<PreviewRow | null> {
  const firstKeys = await loadSearchFile<number[]>(PREVIEW_LOOKUP_PATH);
  const fileNumber = previewFileFor(firstKeys, key);
  if (fileNumber < 0) return null;
  const columns = await loadSearchFile<PreviewColumns>(filePath('preview', fileNumber));
  const row = columns.keys.indexOf(key);
  return row === -1 ? null : readRow(columns, row);
}

/** What a taxon's preview shows: its baked photo, the live path (for a known taxon, when `inatId` is given), or nothing. */
export type BakedPreview =
  { state: 'photo'; image: InatImage } | { state: 'live'; inatId?: number } | { state: 'nothing' };

/**
 * What the static files say about a hit's preview. A higher rank from the baked index with no row
 * stays live, as its about page finds GBIF photos for it. A file failing shows no photo, as a
 * failed live lookup does.
 */
export async function bakedPreview({
  key,
  rank,
  source,
}: Pick<NameHit, 'key' | 'rank' | 'source'>): Promise<BakedPreview> {
  let row: PreviewRow | null;
  try {
    row = await loadPreviewRow(key);
  } catch {
    return { state: 'nothing' };
  }
  if (!row) return source === 'index' && rank !== 'SPECIES' ? { state: 'live' } : { state: 'nothing' };
  if (!row.photo) return { state: 'live', inatId: row.inatId };
  const image = bakedPhotoImage(row.photo);
  return image ? { state: 'photo', image } : { state: 'nothing' };
}
