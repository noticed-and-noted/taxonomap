/** Wires the cube page together: filters and view in, router, map and charts out, every run timed. */
import { drawCharts, inYears, sentenceCase, sumBy, summariseCharts } from './charts.js';
import { openCubes } from './cube-reader.js';
import { clearTaxonKeys, loadFacets, loadTiles, taxonKeyFor } from './gbif.js';
import { viewRanges } from './h3-ranges.js';
import { attachInteractions, clampView, drawCells, drawTiles, resolutionFor, viewBbox } from './map-view.js';
import { chooseChartSource, chooseMapSource, SOURCES, WORLD_ZOOM } from './router.js';

const RANKS = ['life', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BASIS_VALUES = [
  'HUMAN_OBSERVATION',
  'MACHINE_OBSERVATION',
  'PRESERVED_SPECIMEN',
  'MATERIAL_SAMPLE',
  'FOSSIL_SPECIMEN',
  'LIVING_SPECIMEN',
  'MATERIAL_CITATION',
  'OCCURRENCE',
  'OBSERVATION',
];
const WORLD = { lng: 0, lat: 0, zoom: 0 };
const EUROPE = { lng: 12, lat: 47, zoom: 3 };
const BRITAIN = { lng: -2, lat: 53.5, zoom: 5 };
// The benchmark's "years changed" step, and how far its pan step moves (a share of the view's width).
const BENCHMARK_YEARS = { yearFrom: 2010, yearTo: 2019 };
const BENCHMARK_PAN_DEGREES_AT_ZOOM_0 = 180;
const PRESETS = [
  { name: 'Everything', rank: 'life', taxon: 'Life', view: WORLD },
  { name: 'Birds', rank: 'class', taxon: 'Aves', view: WORLD },
  { name: 'Birds since 2020, Europe', rank: 'class', taxon: 'Aves', yearFrom: 2020, view: EUROPE },
  { name: 'Blackbird, Europe', rank: 'species', taxon: 'Turdus merula', kingdom: 'Animalia', view: EUROPE },
  { name: 'Red fox, Britain', rank: 'species', taxon: 'Vulpes vulpes', kingdom: 'Animalia', view: BRITAIN },
  { name: 'Birds with photos, Europe', rank: 'class', taxon: 'Aves', hasPhoto: true, view: EUROPE },
];

const form = document.querySelector('#filters');
const canvas = document.querySelector('#map');
const statusLine = document.querySelector('#status');
const meter = {
  requests: 0,
  bytes: 0,
  count(bytes) {
    this.requests += 1;
    this.bytes += bytes;
  },
};
let cubes = null;
let view = clampView(WORLD);
let isBusy = false;
let pendingRun = null;

function element(tag, text = '', className = '') {
  const created = document.createElement(tag);
  created.textContent = text;
  if (className) created.className = className;
  return created;
}

const formatCount = (count) => Math.round(count).toLocaleString('en-GB');
const formatBytes = (bytes) => (bytes < 1e6 ? `${(bytes / 1e3).toFixed(0)} KB` : `${(bytes / 1e6).toFixed(1)} MB`);
const formatMs = (milliseconds) => `${Math.round(milliseconds).toLocaleString('en-GB')} ms`;

function readFilters() {
  const fields = new FormData(form);
  const number = (name) => (fields.get(name) ? Number(fields.get(name)) : null);
  return {
    rank: fields.get('rank'),
    taxon: fields.get('taxon').trim(),
    kingdom: fields.get('kingdom').trim(),
    resolution: number('resolution'),
    yearFrom: number('yearFrom'),
    yearTo: number('yearTo'),
    months: fields.getAll('month').map(Number),
    basis: fields.get('basis'),
    hasPhoto: fields.get('photo') === '1',
    mode: fields.get('mode'),
  };
}

/** The map from the cubes: only the row groups in view (the whole world at world zoom). */
async function cubeMap(filters) {
  const resolution = resolutionFor(view.zoom, filters.resolution);
  const cellRanges = view.zoom <= WORLD_ZOOM ? null : viewRanges(viewBbox(view), resolution);
  const folder = `map/res=${resolution}/rank=${filters.rank}`;
  const rows = await cubes.taxonRows(folder, filters.taxon, filters.kingdom, cellRanges);
  return { kind: 'cells', resolution, rows };
}

async function gbifMap(filters) {
  const taxonKey = await taxonKeyFor(filters, meter);
  const { kind, tiles } = await loadTiles(viewBbox(view), view.zoom, filters, taxonKey, meter);
  return { kind: 'tiles', tileKind: kind, tiles };
}

async function chartData(filters, route) {
  if (route.source === 'facets')
    return { kind: 'facets', charts: await loadFacets(filters, await taxonKeyFor(filters, meter), meter) };
  return { kind: 'rows', rows: await cubes.taxonRows(`charts/rank=${filters.rank}`, filters.taxon, filters.kingdom) };
}

/** Draw a loaded map and charts; returns the cell and record counts (null for GBIF tiles). */
function render(mapData, chartsData, filters) {
  drawCharts(chartsData.kind === 'facets' ? chartsData.charts : summariseCharts(chartsData.rows, filters));
  if (mapData.kind === 'tiles') {
    drawTiles(canvas, view, mapData.tiles);
    return { cells: null, records: null };
  }
  const cellSums = sumBy(
    mapData.rows.filter((row) => inYears(row.year, filters)),
    (row) => row.cell.toString(16),
  );
  drawCells(canvas, view, cellSums);
  return { cells: cellSums.size, records: [...cellSums.values()].reduce((total, count) => total + count, 0) };
}

function logRun(label, detail, timing) {
  const row = document.createElement('tr');
  row.append(element('td', label), element('td', detail), element('td', timing.source));
  const numbers = [
    formatMs(timing.total),
    formatMs(timing.fetching),
    formatMs(timing.local),
    formatCount(timing.requests),
    formatBytes(timing.bytes),
    timing.cells === null ? '–' : formatCount(timing.cells),
    timing.records === null ? '–' : formatCount(timing.records),
  ];
  for (const number of numbers) row.append(element('td', number, 'number'));
  document.querySelector('#log').prepend(row);
}

function describe(filters, mapRoute) {
  const years = filters.yearFrom || filters.yearTo ? `, ${filters.yearFrom ?? '…'}–${filters.yearTo ?? '…'}` : '';
  const detail = mapRoute.source === 'cubes' ? `, res ${resolutionFor(view.zoom, filters.resolution)}` : '';
  return `${filters.taxon}${years}, zoom ${view.zoom} at ${view.lng.toFixed(1)}, ${view.lat.toFixed(1)}${detail}`;
}

/** Route, fetch, sum and draw the current filters and view, and time each half. */
async function runQuery(label) {
  const filters = readFilters();
  const mapRoute = chooseMapSource(filters, view, filters.mode);
  const chartRoute = chooseChartSource(filters, filters.mode);
  const before = { requests: meter.requests, bytes: meter.bytes };
  const started = performance.now();
  const [mapData, chartsData] = await Promise.all([
    mapRoute.source === 'cubes' ? cubeMap(filters) : gbifMap(filters),
    chartData(filters, chartRoute),
  ]);
  const fetched = performance.now();
  const counts = render(mapData, chartsData, filters);
  const finished = performance.now();
  const mapLabel = mapData.kind === 'tiles' ? SOURCES[mapData.tileKind] : SOURCES.cubes;
  document.querySelector('#map-source').textContent =
    `Map: ${SOURCES[mapRoute.source]}. ${mapRoute.reason}. Charts: ${SOURCES[chartRoute.source]}.`;
  document.querySelector('#view-readout').textContent = `Zoom ${view.zoom}`;
  const timing = {
    source: `${mapLabel}; charts from ${chartRoute.source === 'cubes' ? 'cubes' : 'GBIF'}`,
    total: finished - started,
    fetching: fetched - started,
    local: finished - fetched,
    requests: meter.requests - before.requests,
    bytes: meter.bytes - before.bytes,
    ...counts,
  };
  logRun(label, describe(filters, mapRoute), timing);
  return timing;
}

function applyPreset(preset) {
  document.querySelector('#preset').value = String(PRESETS.indexOf(preset));
  form.elements.rank.value = preset.rank;
  form.elements.taxon.value = preset.taxon;
  form.elements.kingdom.value = preset.kingdom ?? '';
  form.elements.yearFrom.value = preset.yearFrom ?? '';
  form.elements.yearTo.value = '';
  form.elements.photo.checked = !!preset.hasPhoto;
  form.elements.basis.value = '';
  for (const box of form.querySelectorAll('[name=month]')) box.checked = false;
  view = clampView(preset.view);
}

/** Run one task at a time; a pan or zoom during a run waits and then runs once with the latest view. */
async function guarded(task) {
  if (isBusy) {
    pendingRun = task;
    return;
  }
  isBusy = true;
  form.querySelectorAll('button').forEach((button) => (button.disabled = true));
  statusLine.classList.remove('failed');
  try {
    await task();
  } catch (error) {
    statusLine.textContent = `Failed: ${error.message}`;
    statusLine.classList.add('failed');
  } finally {
    isBusy = false;
    form.querySelectorAll('button').forEach((button) => (button.disabled = false));
  }
  if (pendingRun) {
    const next = pendingRun;
    pendingRun = null;
    guarded(next);
  }
}

function clearCaches() {
  cubes?.clear();
  clearTaxonKeys();
}

async function runOnce(label = 'Manual') {
  const filters = readFilters();
  statusLine.textContent = `Reading ${filters.taxon}…`;
  const timing = await runQuery(label);
  const records =
    timing.records === null ? '' : `${formatCount(timing.records)} records in ${formatCount(timing.cells)} cells, `;
  statusLine.textContent = `${filters.taxon}: ${records}${formatMs(timing.total)}.`;
}

/** Each preset from an empty cache, then with a year range, then panned half a view east. */
async function runBenchmark() {
  for (const preset of PRESETS) {
    clearCaches();
    applyPreset(preset);
    statusLine.textContent = `Benchmark: ${preset.name}…`;
    await runQuery(`${preset.name}: first visit`);
    form.elements.yearFrom.value = String(BENCHMARK_YEARS.yearFrom);
    form.elements.yearTo.value = String(BENCHMARK_YEARS.yearTo);
    await runQuery(`${preset.name}: years changed`);
    if (view.zoom <= WORLD_ZOOM) continue;
    view = clampView({ ...view, lng: view.lng + BENCHMARK_PAN_DEGREES_AT_ZOOM_0 / 2 ** view.zoom / 2 });
    await runQuery(`${preset.name}: panned`);
  }
  statusLine.textContent = 'Benchmark finished.';
}

function reportLibrarySize() {
  const libraries = performance
    .getEntriesByType('resource')
    .filter((entry) => entry.name.startsWith('https://cdn.jsdelivr.net/'));
  const bytes = libraries.reduce((total, entry) => total + entry.transferSize, 0);
  const slowest = Math.max(0, ...libraries.map((entry) => entry.responseEnd));
  document.querySelector('#library-size').textContent = bytes
    ? `${formatBytes(bytes)} over the network, ready after ${formatMs(slowest)}.`
    : `from the browser cache, ready after ${formatMs(slowest)}.`;
}

function buildForm() {
  for (const rank of RANKS) form.elements.rank.append(new Option(sentenceCase(rank), rank));
  for (const basis of BASIS_VALUES) form.elements.basis.append(new Option(sentenceCase(basis), basis));
  const months = document.querySelector('#months');
  MONTH_NAMES.forEach((name, index) => {
    const label = element('label', ` ${name}`, 'inline');
    const box = element('input');
    Object.assign(box, { type: 'checkbox', name: 'month', value: String(index + 1) });
    label.prepend(box);
    months.append(label);
  });
  const presetSelect = document.querySelector('#preset');
  PRESETS.forEach((preset, index) => presetSelect.append(new Option(preset.name, String(index))));
  presetSelect.addEventListener('change', () => {
    applyPreset(PRESETS[Number(presetSelect.value)]);
    guarded(() => runOnce());
  });
  applyPreset(PRESETS[0]);
}

function moveTo(nextView) {
  view = nextView;
  guarded(() => runOnce('Pan or zoom'));
}

async function start() {
  cubes = await openCubes(document.querySelector('#base').value, meter);
  const files = Object.values(cubes.manifest.folders).flat();
  statusLine.textContent = `Snapshot ${cubes.snapshot}, ${formatCount(cubes.manifest.partsRead)} parts baked, ${files.length} files. Pick a preset, or drag and zoom the map.`;
}

function wireControls() {
  document.querySelector('#theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  });
  document.querySelector('#base').addEventListener('change', () => guarded(start));
  document.querySelector('#clear-cache').addEventListener('click', clearCaches);
  document.querySelector('#benchmark').addEventListener('click', () => guarded(runBenchmark));
  document
    .querySelector('#zoom-in')
    .addEventListener('click', () => moveTo(clampView({ ...view, zoom: view.zoom + 1 })));
  document
    .querySelector('#zoom-out')
    .addEventListener('click', () => moveTo(clampView({ ...view, zoom: view.zoom - 1 })));
  attachInteractions(canvas, () => view, moveTo);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    guarded(() => runOnce());
  });
}

buildForm();
wireControls();
reportLibrarySize();
guarded(start);
