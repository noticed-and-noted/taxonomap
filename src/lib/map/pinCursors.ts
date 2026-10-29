/**
 * Map cursor for "near me" pin mode, so it's clear a click drops the pin: a
 * target with a dashed ring echoing the search radius. Amber fill with a dark
 * outline reads on every basemap.
 */
const AMBER = '#f0b443';
const INK = '#1a1408';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="${INK}" stroke-width="3.6"/><circle cx="16" cy="16" r="12" fill="none" stroke="${AMBER}" stroke-width="2" stroke-dasharray="4 3"/><circle cx="16" cy="16" r="4" fill="${AMBER}" stroke="${INK}" stroke-width="1.6"/></svg>`;

export const PIN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(SVG)}") 16 16, crosshair`;
