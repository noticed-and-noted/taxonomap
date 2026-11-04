/**
 * GBIF's own map tiles and search facets, for the views the router keeps on GBIF. Tile parameters mirror
 * occurrenceTileTemplate in src/lib/gbif/maps.ts: density tiles apply taxon, year and record type; month
 * and photos need the heavier ad hoc tiles, which must also be told to leave out geospatial issues.
 */
const API = 'https://api.gbif.org';
// The unprojected grid, so tiles line up with the page's plain longitude-latitude map.
const SRS = 'EPSG:4326';
// GBIF's tiles in this grid are 512 px and 180° / 2^zoom wide.
const TILE_DEGREES_AT_ZOOM_0 = 180;
// The app's own density (src/lib/gbif/maps.ts defaults to 60).
const HEX_PER_TILE = 60;
const STYLE = 'purpleYellow-noborder.poly';
const EARLIEST_YEAR = 1500;
const FACET_LIMIT = 1000;

const keyCache = new Map();

/** Forget matched taxon keys, as a first visit would start. */
export function clearTaxonKeys() {
  keyCache.clear();
}

/** Whether a filter needs ad hoc tiles: density tiles silently ignore month and media type. */
export function needsAdhoc(filters) {
  return filters.months.length > 0 || filters.hasPhoto;
}

/** GBIF's "from,to" year parameter, or null when no range is set. */
function yearParam({ yearFrom, yearTo }) {
  if (yearFrom === null && yearTo === null) return null;
  return `${yearFrom ?? EARLIEST_YEAR},${yearTo ?? new Date().getFullYear()}`;
}

/** Search parameters shared by tiles and facets. */
function filterParams(filters, taxonKey) {
  const params = new URLSearchParams();
  if (taxonKey) params.set('taxonKey', String(taxonKey));
  const year = yearParam(filters);
  if (year) params.set('year', year);
  if (filters.basis) params.set('basisOfRecord', filters.basis);
  for (const month of filters.months) params.append('month', String(month));
  if (filters.hasPhoto) params.set('mediaType', 'StillImage');
  return params;
}

/**
 * GBIF's backbone key for a cube taxon, matched by name, rank and kingdom (cached). The cubes key on names,
 * because the snapshot's own taxon IDs aren't the backbone keys the app and GBIF's maps use.
 * @returns {Promise<number | null>} null for the whole of life
 */
export async function taxonKeyFor({ rank, taxon, kingdom }, meter) {
  if (rank === 'life') return null;
  const cacheKey = `${rank}|${kingdom}|${taxon}`;
  if (!keyCache.has(cacheKey)) {
    const query = new URLSearchParams({ name: taxon, rank: rank.toUpperCase(), strict: 'true' });
    if (kingdom) query.set('kingdom', kingdom);
    const lookup = fetch(`${API}/v1/species/match?${query}`)
      .then((response) => response.json())
      .then((match) => {
        meter.count(JSON.stringify(match).length);
        if (!match.usageKey) throw new Error(`GBIF has no ${rank} called ${taxon}`);
        return match.usageKey;
      });
    keyCache.set(cacheKey, lookup);
    lookup.catch(() => keyCache.delete(cacheKey));
  }
  return keyCache.get(cacheKey);
}

/** The tiles at `tileZoom` that a view's bounding box touches. */
function tilesInView([west, south, east, north], tileZoom) {
  const degrees = TILE_DEGREES_AT_ZOOM_0 / 2 ** tileZoom;
  const columns = 2 ** (tileZoom + 1);
  const rows = 2 ** tileZoom;
  const clamp = (value, count) => Math.max(0, Math.min(count - 1, value));
  const tiles = [];
  for (
    let row = clamp(Math.floor((90 - north) / degrees), rows);
    row <= clamp(Math.floor((90 - south) / degrees - 1e-9), rows);
    row += 1
  ) {
    for (
      let column = clamp(Math.floor((west + 180) / degrees), columns);
      column <= clamp(Math.floor((east + 180) / degrees - 1e-9), columns);
      column += 1
    ) {
      tiles.push({ column, row, west: -180 + column * degrees, north: 90 - row * degrees, degrees });
    }
  }
  return tiles;
}

/**
 * Fetch GBIF's PNG tiles for a view, as bitmaps placed in degrees.
 * @returns {Promise<{ kind: 'adhoc' | 'density', tiles: { image: ImageBitmap, west: number, north: number, degrees: number }[] }>}
 */
export async function loadTiles(bbox, viewZoom, filters, taxonKey, meter) {
  const kind = needsAdhoc(filters) ? 'adhoc' : 'density';
  const params = filterParams(filters, taxonKey);
  params.set('srs', SRS);
  params.set('bin', 'hex');
  params.set('hexPerTile', String(HEX_PER_TILE));
  params.set('style', STYLE);
  if (kind === 'adhoc') params.set('hasGeospatialIssue', 'false');
  // The view's own zoom: a 512 px tile is drawn about 1.4× larger. A finer zoom would be sharper but four
  // times the tiles, and shrinking GBIF's hexes leaves rows of dark dots where their edges alias.
  const tileZoom = viewZoom;
  const tiles = await Promise.all(
    tilesInView(bbox, tileZoom).map(async (tile) => {
      const response = await fetch(
        `${API}/v2/map/occurrence/${kind}/${tileZoom}/${tile.column}/${tile.row}@1x.png?${params}`,
      );
      if (!response.ok) throw new Error(`GBIF tile answered ${response.status}`);
      const blob = await response.blob();
      meter.count(blob.size);
      return { ...tile, image: await createImageBitmap(blob) };
    }),
  );
  return { kind, tiles };
}

const asMap = (facet, keyOf = Number) => new Map((facet?.counts ?? []).map(({ name, count }) => [keyOf(name), count]));

/**
 * Chart sums from GBIF's search facets, in the same shape as the cube charts. facetMultiselect makes each
 * chart ignore its own filter, as the cube charts do.
 */
export async function loadFacets(filters, taxonKey, meter) {
  const params = filterParams(filters, taxonKey);
  params.set('limit', '0');
  params.set('facetMultiselect', 'true');
  params.set('facetLimit', String(FACET_LIMIT));
  for (const facet of ['year', 'month', 'basisOfRecord']) params.append('facet', facet);
  const response = await fetch(`${API}/v1/occurrence/search?${params}`);
  if (!response.ok) throw new Error(`GBIF search answered ${response.status}`);
  const body = await response.text();
  meter.count(body.length);
  const facets = Object.fromEntries(JSON.parse(body).facets.map((facet) => [facet.field, facet]));
  return {
    years: asMap(facets.YEAR),
    months: asMap(facets.MONTH),
    basis: asMap(facets.BASIS_OF_RECORD, String),
  };
}
