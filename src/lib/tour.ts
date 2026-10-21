/** Geometry for the onboarding tour: the dimmed page with spotlight holes, and where its tip goes. */

/** A rectangle on screen, in CSS px from the viewport's top left. */
export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Where the tip's top-left (or bottom-left, when it sits above its target) goes, in px. */
export type TipPosition = { left: number; top: number } | { left: number; bottom: number };

/** Room between a target and its spotlight's edge. */
const SPOT_PADDING = 6;
const SPOT_RADIUS = 10;
/** Room between a spotlight and its tip. */
const TIP_GAP = 12;
/** Least room between the tip and the viewport's edges. */
export const VIEWPORT_EDGE = 16;

/**
 * Grows a box on every side, so the spotlight doesn't touch its target.
 * @param box The target's box.
 * @returns The box with SPOT_PADDING around it.
 */
export function padBox(box: ScreenBox): ScreenBox {
  return {
    left: box.left - SPOT_PADDING,
    top: box.top - SPOT_PADDING,
    width: box.width + SPOT_PADDING * 2,
    height: box.height + SPOT_PADDING * 2,
  };
}

/**
 * The part of a box inside another, e.g. a list that scrolls past the edge of its panel.
 * @param box The box to clip.
 * @param bounds The box it must stay inside.
 * @returns The visible part, or null when none of it is.
 */
export function clipBox(box: ScreenBox, bounds: ScreenBox): ScreenBox | null {
  const left = Math.max(box.left, bounds.left);
  const top = Math.max(box.top, bounds.top);
  const right = Math.min(box.left + box.width, bounds.left + bounds.width);
  const bottom = Math.min(box.top + box.height, bounds.top + bounds.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

function roundedRect({ left, top, width, height }: ScreenBox): string {
  const corner = Math.min(SPOT_RADIUS, width / 2, height / 2);
  const right = left + width;
  const bottom = top + height;
  const arc = `A${corner} ${corner} 0 0 1`;
  return (
    `M${left + corner} ${top}H${right - corner}${arc} ${right} ${top + corner}` +
    `V${bottom - corner}${arc} ${right - corner} ${bottom}H${left + corner}${arc} ${left} ${bottom - corner}` +
    `V${top + corner}${arc} ${left + corner} ${top}Z`
  );
}

/**
 * An SVG path covering the viewport with a rounded hole over each box (draw it with fill-rule evenodd).
 * @param boxes The spotlit boxes.
 * @param viewport The page's size.
 * @returns The path's `d`.
 */
export function spotlightPath(boxes: readonly ScreenBox[], viewport: Viewport): string {
  return [`M0 0H${viewport.width}V${viewport.height}H0Z`, ...boxes.map(roundedRect)].join('');
}

/** Beside a tall side column (the cell panel): level with its top, else with its bottom. */
function besideColumn(box: ScreenBox, viewport: Viewport, tip: Viewport): TipPosition[] {
  const besideLeft = box.left - TIP_GAP - tip.width;
  const left = besideLeft >= VIEWPORT_EDGE ? besideLeft : box.left + box.width + TIP_GAP;
  return [
    { left, top: box.top + TIP_GAP * 2 },
    { left, bottom: viewport.height - box.top - box.height + TIP_GAP * 2 },
  ];
}

/** Below a target in the top half of the page and above one in the bottom half, else the other way. */
function aboveOrBelow(box: ScreenBox, viewport: Viewport, tip: Viewport): TipPosition[] {
  const left = box.left + box.width / 2 - tip.width / 2;
  const below = { left, top: box.top + box.height + TIP_GAP };
  const above = { left, bottom: viewport.height - box.top + TIP_GAP };
  const isUpperHalf = box.top + box.height / 2 < viewport.height / 2;
  return isUpperHalf ? [below, above] : [above, below];
}

function rectOf(position: TipPosition, viewport: Viewport, tip: Viewport): ScreenBox {
  const top = 'top' in position ? position.top : viewport.height - position.bottom - tip.height;
  return { left: position.left, top, width: tip.width, height: tip.height };
}

function overlaps(first: ScreenBox, second: ScreenBox): boolean {
  return (
    first.left < second.left + second.width &&
    second.left < first.left + first.width &&
    first.top < second.top + second.height &&
    second.top < first.top + first.height
  );
}

/**
 * Places the tip by its target (beside a tall side column, else above or below it), trying
 * each place in turn, then the top and bottom of the page, for one that stays on screen and
 * covers no spotlit box. With none, it takes the first.
 * @param box The main spotlit box.
 * @param viewport The page's size.
 * @param tip The tip's size in px.
 * @param avoid Other spotlit boxes the tip mustn't cover.
 * @returns The tip's position.
 */
export function tipPosition(
  box: ScreenBox,
  viewport: Viewport,
  tip: Viewport,
  avoid: readonly ScreenBox[] = [],
): TipPosition {
  const clampLeft = (left: number) =>
    Math.max(VIEWPORT_EDGE, Math.min(left, viewport.width - tip.width - VIEWPORT_EDGE));
  const isSideColumn = box.height > viewport.height / 2 && box.width < viewport.width / 2;
  const centredLeft = (viewport.width - tip.width) / 2;
  const places = [
    ...(isSideColumn ? besideColumn : aboveOrBelow)(box, viewport, tip),
    { left: centredLeft, top: VIEWPORT_EDGE },
    { left: centredLeft, bottom: VIEWPORT_EDGE },
  ].map((place) => ({ ...place, left: clampLeft(place.left) }));
  const spotlit = [box, ...avoid];
  const fits = (place: TipPosition) => {
    const rect = rectOf(place, viewport, tip);
    const isOnScreen = rect.top >= 0 && rect.top + rect.height <= viewport.height;
    return isOnScreen && !spotlit.some((other) => overlaps(rect, other));
  };
  return places.find(fits) ?? places[0]!;
}
