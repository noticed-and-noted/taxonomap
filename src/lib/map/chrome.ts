/**
 * The floating chrome over the map (header, side panel, bottom sheet), how much of the map it covers,
 * and where the tour and hints may point: the busiest cell clear of it, facing the viewer on the globe.
 */
import type { Map as MlMap } from 'maplibre-gl';
import type { ScreenBox } from '~/lib/tour';
import { hexCentre, type Hex, type LngLat } from './occGrid';
import type { CoveredEdges } from './recordFit';

/** Room kept between the tour's hex and the map's covered edges, so its tip and the legend never hide it. */
const BUSIEST_MARGIN = 120;
/** The same with the bottom sheet, which leaves a short band of map; the tip moves itself off the hex there. */
const SHEET_MARGIN = 40;
/** cos of the widest angle from the map's centre a tour hex may sit at (60°), so it faces the viewer on the globe. */
const FACING_COS = 0.5;
/** The bottom sheet's height when it opens (BottomSheet's half snap), as a share of the page. */
const SHEET_OPEN_SHARE = 0.55;
/** The side panel's inset from the map's right edge (right-3). */
const PANEL_INSET = 12;
/** From this width the cell panel is a side panel; below it, a bottom sheet. */
const SIDE_PANEL_QUERY = '(min-width: 768px)';
const DEFAULT_PANEL_WIDTH = '400px';

/** How much of the map the floating header, bottom sheet and side panel cover, in px per edge. */
export function coveredEdges(map: MlMap): CoveredEdges {
  const box = map.getContainer().getBoundingClientRect();
  const header = document.querySelector('.app-header')?.getBoundingClientRect();
  // offsetHeight, not the rect: the sheet may still be sliding in.
  const sheet = document.querySelector<HTMLElement>('.bottom-sheet')?.offsetHeight ?? 0;
  const panel = document.querySelector('.side-panel:not(.collapsed)')?.getBoundingClientRect();
  return {
    top: header ? Math.max(0, header.bottom - box.top) : 0,
    bottom: Math.min(sheet, box.height / 2),
    left: 0,
    right: panel ? Math.max(0, box.right - panel.left) : 0,
  };
}

/** The covered edges, plus a margin, once the cell panel is open too, since the tour opens it on the hex it picks. */
function coveredWithPanel(map: MlMap, box: DOMRect) {
  const covered = coveredEdges(map);
  if (window.matchMedia(SIDE_PANEL_QUERY).matches) {
    const panelWidthCss = getComputedStyle(document.documentElement).getPropertyValue('--panel-width').trim();
    const panelWidth = parseFloat(panelWidthCss || DEFAULT_PANEL_WIDTH);
    return { ...covered, right: Math.max(covered.right, panelWidth + PANEL_INSET), margin: BUSIEST_MARGIN };
  }
  return { ...covered, bottom: Math.max(covered.bottom, box.height * SHEET_OPEN_SHARE), margin: SHEET_MARGIN };
}

/** Whether a point is within FACING_COS of the map's centre, by great-circle angle. */
function isFacing(map: MlMap, [lng, lat]: LngLat): boolean {
  const centre = map.getCenter();
  const radians = Math.PI / 180;
  const cosAngle =
    Math.sin(lat * radians) * Math.sin(centre.lat * radians) +
    Math.cos(lat * radians) * Math.cos(centre.lat * radians) * Math.cos((lng - centre.lng) * radians);
  return cosAngle > FACING_COS;
}

/**
 * The cell with the most records that faces the viewer, clear of the floating chrome and the cell panel.
 * @param hexes The loaded cells.
 */
export function busiestInView(map: MlMap, hexes: readonly Hex[]): Hex | undefined {
  const box = map.getContainer().getBoundingClientRect();
  const covered = coveredWithPanel(map, box);
  let busiest: Hex | undefined;
  for (const hex of hexes) {
    const centre = hexCentre(hex);
    const point = map.project(centre);
    const isClear =
      point.x > covered.left + covered.margin &&
      point.x < box.width - covered.right - covered.margin &&
      point.y > covered.top + covered.margin &&
      point.y < box.height - covered.bottom - covered.margin;
    if (isClear && isFacing(map, centre) && hex.properties.total > (busiest?.properties.total ?? 0)) busiest = hex;
  }
  return busiest;
}

/** A cell outline's box on screen, in viewport px. */
export function ringBox(map: MlMap, ring: readonly LngLat[]): ScreenBox {
  const box = map.getContainer().getBoundingClientRect();
  const points = ring.map((position) => map.project(position));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left: box.left + left, top: box.top + top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}
