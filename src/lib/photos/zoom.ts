/**
 * The sums behind zooming into a photo: how far in, and how far it is panned from the centre, kept so the photo
 * always covers the stage where it is bigger than it and stays centred where it is smaller.
 */

/** A zoomed photo's state: its scale, and its offset in px from the centre of the stage. */
export interface ZoomView {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const UNZOOMED: ZoomView = { scale: 1, x: 0, y: 0 };
/** Far enough in to study a detail; much further and an 800 px photo is mostly blur. */
export const MAX_ZOOM = 6;

/**
 * Zooms by a factor about a point, keeping that point of the photo under it.
 * @param point Where to zoom about, in px from the stage's centre.
 * @param photo The photo's size as drawn unzoomed (see fittedSize).
 */
export function zoomAt(
  view: ZoomView,
  factor: number,
  point: { x: number; y: number },
  photo: Size,
  stage: Size,
): ZoomView {
  const scale = clamp(view.scale * factor, 1, MAX_ZOOM);
  const ratio = scale / view.scale;
  const zoomed = { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
  return clampPan(zoomed, photo, stage);
}

/** Pans by a distance in px, no further than the photo's edges. */
export function panBy(view: ZoomView, deltaX: number, deltaY: number, photo: Size, stage: Size): ZoomView {
  return clampPan({ ...view, x: view.x + deltaX, y: view.y + deltaY }, photo, stage);
}

/** A part of a photo, as fractions of its width and height from its top left. */
export interface PhotoArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The part of the photo the stage shows, for the zoom's locator map. */
export function visibleArea(view: ZoomView, photo: Size, stage: Size): PhotoArea {
  const [left, right] = visibleSpan(view.scale * photo.width, view.x, stage.width);
  const [top, bottom] = visibleSpan(view.scale * photo.height, view.y, stage.height);
  return { left, top, width: right - left, height: bottom - top };
}

/** Where the stage's two edges fall along one side of the photo, as fractions of it. */
function visibleSpan(drawn: number, offset: number, stage: number): [number, number] {
  const photoStart = offset - drawn / 2;
  return [clamp((-stage / 2 - photoStart) / drawn, 0, 1), clamp((stage / 2 - photoStart) / drawn, 0, 1)];
}

/** The size a photo draws at when fitted whole inside the stage, as `object-fit: contain` draws it. */
export function fittedSize(natural: Size, stage: Size): Size {
  const fit = Math.min(stage.width / natural.width, stage.height / natural.height);
  return { width: natural.width * fit, height: natural.height * fit };
}

/** Keeps the photo's edges from pulling inside the stage, and a side narrower than the stage centred. */
function clampPan(view: ZoomView, photo: Size, stage: Size): ZoomView {
  const maxX = Math.max(0, (view.scale * photo.width - stage.width) / 2);
  const maxY = Math.max(0, (view.scale * photo.height - stage.height) / 2);
  // Adding 0 turns a -0 bound into 0.
  return { scale: view.scale, x: clamp(view.x, -maxX, maxX) + 0, y: clamp(view.y, -maxY, maxY) + 0 };
}

/** A value held between two bounds. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
