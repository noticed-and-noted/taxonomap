/**
 * The page's map: a plain longitude-latitude view (2:1, like GBIF's EPSG:4326 tiles) that pans and zooms,
 * and draws either cube cells or GBIF tiles.
 */
import { cellToBoundary } from 'h3-js';

const WIDTH = 1440;
const HEIGHT = 720;
const MAX_ZOOM = 7;
const HALF_TURN = 180;
const RAMP_STOPS = 7;
// H3 resolution by zoom, so hexes stay roughly 10–40 px across.
const RESOLUTION_BY_ZOOM = [2, 2, 3, 4, 4, 5, 5, 5];
// Arrow keys move the view by this share of its width or height.
const KEY_PAN_SHARE = 0.25;

/** The view's longitude and latitude spans in degrees. */
function spans(zoom) {
  return { lng: (2 * HALF_TURN) / 2 ** zoom, lat: HALF_TURN / 2 ** zoom };
}

/** A view with its zoom in range and its edges kept inside the world. */
export function clampView({ lng, lat, zoom }) {
  const level = Math.max(0, Math.min(MAX_ZOOM, Math.round(zoom)));
  const span = spans(level);
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
  return { lng: clamp(lng, HALF_TURN - span.lng / 2), lat: clamp(lat, HALF_TURN / 2 - span.lat / 2), zoom: level };
}

/** A view's bounding box: [west, south, east, north]. */
export function viewBbox({ lng, lat, zoom }) {
  const span = spans(zoom);
  return [lng - span.lng / 2, lat - span.lat / 2, lng + span.lng / 2, lat + span.lat / 2];
}

/** The H3 resolution the map uses at a zoom, unless a fixed one is chosen. */
export function resolutionFor(zoom, fixed) {
  return fixed || RESOLUTION_BY_ZOOM[zoom];
}

/** Canvas position of a longitude and latitude. */
function projector(view) {
  const [west, , , north] = viewBbox(view);
  const span = spans(view.zoom);
  return (lng, lat) => [((lng - west) / span.lng) * WIDTH, ((north - lat) / span.lat) * HEIGHT];
}

/** A cell's outline, unwrapped when it straddles the antimeridian, drawn on both sides of it. */
function cellOutlines(cell, project) {
  const boundary = cellToBoundary(cell);
  const longitudes = boundary.map(([, lng]) => lng);
  if (Math.max(...longitudes) - Math.min(...longitudes) < HALF_TURN) {
    return [boundary.map(([lat, lng]) => project(lng, lat))];
  }
  const unwrapped = boundary.map(([lat, lng]) => [lat, lng < 0 ? lng + 2 * HALF_TURN : lng]);
  return [0, -2 * HALF_TURN].map((shift) => unwrapped.map(([lat, lng]) => project(lng + shift, lat)));
}

/** How many values in an ascending list are below `value` (binary search). */
function countBelow(ascending, value) {
  let low = 0;
  let high = ascending.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ascending[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function rampColours() {
  const styles = getComputedStyle(document.documentElement);
  return Array.from({ length: RAMP_STOPS }, (_unused, index) => styles.getPropertyValue(`--ramp-${index + 1}`).trim());
}

function freshContext(canvas) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.transform = '';
  return canvas.getContext('2d');
}

/**
 * Draw cube cells, shaded by rank among the cells in view, not raw count: a sparse species is mostly
 * 1-record cells, which a count scale would paint all in the darkest stop.
 * @param {Map<string, number>} cellSums records by H3 cell (hex)
 */
export function drawCells(canvas, view, cellSums) {
  const context = freshContext(canvas);
  const project = projector(view);
  const colours = rampColours();
  const ranked = [...cellSums.values()].sort((left, right) => left - right);
  for (const [cell, records] of cellSums) {
    const stop = Math.min(RAMP_STOPS - 1, Math.floor((countBelow(ranked, records) / ranked.length) * RAMP_STOPS));
    context.fillStyle = colours[stop];
    for (const outline of cellOutlines(cell, project)) {
      context.beginPath();
      outline.forEach(([pointX, pointY], index) =>
        index ? context.lineTo(pointX, pointY) : context.moveTo(pointX, pointY),
      );
      context.fill();
    }
  }
}

/** Draw GBIF's tiles, each placed by its corner and size in degrees. */
export function drawTiles(canvas, view, tiles) {
  const context = freshContext(canvas);
  const project = projector(view);
  for (const tile of tiles) {
    const [left, top] = project(tile.west, tile.north);
    const [right, bottom] = project(tile.west + tile.degrees, tile.north - tile.degrees);
    context.drawImage(tile.image, left, top, right - left, bottom - top);
  }
}

/** The view moved by a drag of `deltaX`, `deltaY` canvas pixels. */
function panned(view, deltaX, deltaY) {
  const span = spans(view.zoom);
  return clampView({
    ...view,
    lng: view.lng - (deltaX / WIDTH) * span.lng,
    lat: view.lat + (deltaY / HEIGHT) * span.lat,
  });
}

/** Canvas pixels per CSS pixel, as the canvas is scaled to fit its box. */
const scaleOf = (canvas) => WIDTH / canvas.getBoundingClientRect().width;

function attachDrag(canvas, getView, onChange) {
  let start = null;
  canvas.addEventListener('pointerdown', (event) => {
    start = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (start) canvas.style.transform = `translate(${event.clientX - start.x}px, ${event.clientY - start.y}px)`;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!start) return;
    const scale = scaleOf(canvas);
    const [deltaX, deltaY] = [(event.clientX - start.x) * scale, (event.clientY - start.y) * scale];
    start = null;
    if (Math.hypot(deltaX, deltaY) < 3) canvas.style.transform = '';
    else onChange(panned(getView(), deltaX, deltaY));
  });
}

function attachZoomAndKeys(canvas, getView, onChange) {
  canvas.addEventListener('dblclick', (event) => {
    const box = canvas.getBoundingClientRect();
    const view = getView();
    const [west, , , north] = viewBbox(view);
    const span = spans(view.zoom);
    const lng = west + ((event.clientX - box.left) / box.width) * span.lng;
    const lat = north - ((event.clientY - box.top) / box.height) * span.lat;
    onChange(clampView({ lng, lat, zoom: view.zoom + 1 }));
  });
  const keyMoves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  canvas.addEventListener('keydown', (event) => {
    const zoomStep = { '+': 1, '=': 1, '-': -1 }[event.key];
    const move = keyMoves[event.key];
    if (!zoomStep && !move) return;
    event.preventDefault();
    const view = getView();
    if (zoomStep) onChange(clampView({ ...view, zoom: view.zoom + zoomStep }));
    else onChange(panned(view, -move[0] * WIDTH * KEY_PAN_SHARE, -move[1] * HEIGHT * KEY_PAN_SHARE));
  });
}

/**
 * Pan by dragging or with the arrow keys, zoom with double-click or + and −.
 * @param {() => object} getView the current view
 * @param {(view: object) => void} onChange called with the new view
 */
export function attachInteractions(canvas, getView, onChange) {
  attachDrag(canvas, getView, onChange);
  attachZoomAndKeys(canvas, getView, onChange);
}
