/**
 * Reads the pre-counted cubes over HTTP range requests: latest.json, the manifest, then for each query
 * one file's footer and only the row groups that can hold the taxon (and, for the map, the cells in view).
 * Footers and row groups are kept, so a filter change or a pan back over loaded ground needs no network.
 */
import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

import { inRanges, overlapsRanges } from './h3-ranges.js';

// Enough for a cube file's footer in one request; hyparquet fetches the rest if a footer is bigger.
const FOOTER_FETCH_BYTES = 1 << 15;

/** A file hyparquet reads in slices, each one a counted range request. */
function rangedFile(url, byteLength, meter) {
  return {
    byteLength,
    async slice(start, end = byteLength) {
      // Through the HTTP cache, the browser lets one request per URL through at a time, so parallel
      // ranges of one file would queue behind each other; the reader keeps its own cache instead.
      const response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: 'no-store' });
      if (response.status !== 206) throw new Error(`${url} ignored the range request (${response.status})`);
      const buffer = await response.arrayBuffer();
      meter.count(buffer.byteLength);
      return buffer;
    },
  };
}

async function fetchJson(url, meter) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body = await response.text();
  meter.count(body.length);
  return JSON.parse(body);
}

/** A promise kept under `key`, dropped again if it fails so the next call retries. */
function cached(store, key, load) {
  if (!store.has(key)) {
    const loading = load();
    store.set(key, loading);
    loading.catch(() => store.delete(key));
  }
  return store.get(key);
}

/** Index of a column in a row group, or -1 when the file has no such column. */
function columnIndex(metadata, name) {
  return metadata.row_groups[0].columns.findIndex((column) => column.meta_data.path_in_schema[0] === name);
}

/**
 * Row ranges of the row groups that could hold the taxon. When the view's cell ranges are given and a group
 * holds only this taxon, its cell statistics say whether any of its cells are in view.
 */
function groupsFor(metadata, taxon, cellRanges) {
  const taxonColumn = columnIndex(metadata, 'taxon');
  const cellColumn = columnIndex(metadata, 'cell');
  const chosen = [];
  let rowStart = 0;
  for (const group of metadata.row_groups) {
    const rowEnd = rowStart + Number(group.num_rows);
    const taxonStats = group.columns[taxonColumn].meta_data.statistics;
    const holdsTaxon = taxonStats.min_value <= taxon && taxon <= taxonStats.max_value;
    const onlyTaxon = taxonStats.min_value === taxon && taxonStats.max_value === taxon;
    const cellStats = cellColumn >= 0 ? group.columns[cellColumn].meta_data.statistics : null;
    const outOfView = cellRanges && onlyTaxon && !overlapsRanges(cellStats.min_value, cellStats.max_value, cellRanges);
    if (holdsTaxon && !outOfView) chosen.push({ rowStart, rowEnd });
    rowStart = rowEnd;
  }
  return chosen;
}

/**
 * A reader for one published set of cubes.
 * @param {string} base the folder holding latest.json, such as a Hugging Face `resolve/main/` URL
 * @param {{ count(bytes: number): void }} meter told the size of every response
 * @returns {Promise<{ snapshot: string, manifest: object, taxonRows: Function }>}
 */
export async function openCubes(base, meter) {
  const root = new URL(base, location.href);
  const latest = await fetchJson(new URL('latest.json', root), meter);
  const manifest = await fetchJson(new URL(latest.manifest, root), meter);
  const snapshotRoot = new URL(`snapshots/${latest.snapshot}/`, root);
  const footers = new Map();
  const groups = new Map();

  const filesFor = (folder, taxon) =>
    (manifest.folders[folder] ?? [])
      .filter((file) => file.first <= taxon && taxon <= file.last)
      .map((file) => ({ url: new URL(file.path, snapshotRoot).href, bytes: file.bytes }));

  const openFile = ({ url, bytes }) =>
    cached(footers, url, () => {
      const file = rangedFile(url, bytes, meter);
      return parquetMetadataAsync(file, { initialFetchSize: FOOTER_FETCH_BYTES }).then((metadata) => ({
        file,
        metadata,
      }));
    });

  const readGroup = (url, { file, metadata }, { rowStart, rowEnd }) =>
    cached(groups, `${url}#${rowStart}`, () => parquetReadObjects({ file, metadata, compressors, rowStart, rowEnd }));

  /**
   * Every row of one taxon in a cube folder, limited to the view's cells when `cellRanges` is given.
   * @param {[bigint, bigint][] | null} cellRanges from viewRanges, or null for the whole world (and for charts)
   */
  async function taxonRows(folder, taxon, kingdom, cellRanges = null) {
    const perFile = await Promise.all(
      filesFor(folder, taxon).map(async (fileRef) => {
        const opened = await openFile(fileRef);
        const wanted = groupsFor(opened.metadata, taxon, cellRanges);
        return (await Promise.all(wanted.map((group) => readGroup(fileRef.url, opened, group)))).flat();
      }),
    );
    return perFile
      .flat()
      .filter((row) => row.taxon === taxon && (!kingdom || row.kingdom === kingdom))
      .filter((row) => !cellRanges || inRanges(row.cell, cellRanges));
  }

  /** Forget every footer and row group read so far, as a first visit would start. */
  function clear() {
    footers.clear();
    groups.clear();
  }

  return { snapshot: latest.snapshot, manifest, taxonRows, clear };
}
