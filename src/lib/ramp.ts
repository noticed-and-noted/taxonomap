/**
 * Density colour ramp shared by the map layer and the legend.
 *
 * GBIF hex cells cover a fixed share of each tile, so a cell's area (and
 * typical count) grows ~4× per zoom level out. Fixed bins saturate at world
 * view, so the log-scale thresholds are scaled by 4^(REF_ZOOM − zoom) and
 * rounded to 1-2-5 steps; the legend shows the values for the current zoom.
 * Colours come from the viridis tokens in tokens.css (perceptually uniform,
 * colour-blind safe).
 */
export const BASE_THRESHOLDS = [10, 100, 1_000, 10_000, 100_000, 1_000_000] as const;
export const REF_ZOOM = 6;
export const MAX_ZOOM_STOP = 14;

const FALLBACK = ['#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'];

/** Seven colours, one per bin. */
export function rampColors(): string[] {
  if (typeof document === 'undefined') return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  return FALLBACK.map((fb, i) => cs.getPropertyValue(`--ramp-${i + 1}`).trim() || fb);
}

/** Round to 1, 2 or 5 × 10ⁿ. */
export function nice(n: number): number {
  if (n <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  const m = n / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** Bin thresholds (6 values, strictly increasing) for a zoom level. */
export function thresholdsAt(zoom: number): number[] {
  const scale = 4 ** (REF_ZOOM - Math.round(zoom));
  const out: number[] = [];
  for (const t of BASE_THRESHOLDS) {
    const v = nice(t * scale);
    out.push(out.length && v <= (out[out.length - 1] as number) ? (out[out.length - 1] as number) * 10 : v);
  }
  return out;
}

export function formatCount(n: number): string {
  if (n >= 1e9) return `${n / 1e9}B`;
  if (n >= 1e6) return `${n / 1e6}M`;
  if (n >= 1e3) return `${n / 1e3}K`;
  return String(n);
}

/** Lower bound of each of the 7 bins at a zoom level. */
export function binLabels(zoom: number): string[] {
  return ['1', ...thresholdsAt(zoom).map(formatCount)];
}
