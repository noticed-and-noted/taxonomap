import { BALL, COIL, COIL_STROKE_WIDTH, LEAF } from '~/lib/wordmark';

/**
 * Map cursor for "near me" pin mode, so it's clear a click drops the pin: the
 * logo's fern mark, pointing with the stem's tip. A dark outline lets it read
 * on every basemap.
 */
const AMBER = '#e89141';
const INK = '#1a1408';
const LEAF_GREEN = '#27553a';

/** Outline width in mark units (about 1.4 px at cursor size). */
const OUTLINE = 12;

/** The mark with the outline's room around it, at 28 × 32 px. */
const VIEWBOX = '74 57 121 139';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="32" viewBox="${VIEWBOX}"><g stroke-linecap="round" stroke-linejoin="round"><path d="${COIL}" fill="none" stroke="${INK}" stroke-width="${COIL_STROKE_WIDTH + OUTLINE}"/><path d="${BALL}" fill="${INK}" stroke="${INK}" stroke-width="${OUTLINE}"/><path d="${LEAF}" fill="${INK}" stroke="${INK}" stroke-width="${OUTLINE}"/><path d="${COIL}" fill="none" stroke="${AMBER}" stroke-width="${COIL_STROKE_WIDTH}"/><path d="${BALL}" fill="${AMBER}"/><path d="${LEAF}" fill="${LEAF_GREEN}"/></g></svg>`;

/** The hotspot sits on the stem's tip (120.75, 182.26 in mark units). */
export const PIN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(SVG)}") 11 29, crosshair`;
