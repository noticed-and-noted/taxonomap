import { SEARCH_DATA_PATH } from './format';

/** Cloudflare's free-plan limits for a Pages site. */
export const SITE_FILE_LIMIT = 20_000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Leaves 8,000 of the site's files for pages, pre-rendered species pages and their Open Graph images. */
export const SEARCH_FILE_BUDGET = 12_000;

/** A built file: its path from the site root, and size. */
export interface BuiltFile {
  path: string;
  bytes: number;
}

/**
 * What's wrong with a site's files against the limits; empty when they fit.
 * @returns One message per limit broken.
 */
export function fileBudgetProblems(files: readonly BuiltFile[]): string[] {
  const searchFiles = files.filter((file) => file.path.startsWith(SEARCH_DATA_PATH));
  const oversized = files.filter((file) => file.bytes > MAX_FILE_BYTES);
  return [
    ...(files.length > SITE_FILE_LIMIT ? [`${files.length} files in the site, over ${SITE_FILE_LIMIT}`] : []),
    ...(searchFiles.length > SEARCH_FILE_BUDGET
      ? [`${searchFiles.length} name-search files, over the budget of ${SEARCH_FILE_BUDGET}`]
      : []),
    ...oversized.map((file) => `${file.path} is ${file.bytes} bytes, over ${MAX_FILE_BYTES}`),
  ];
}
