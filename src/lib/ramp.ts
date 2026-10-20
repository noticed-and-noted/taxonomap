/**
 * Density colour ramp shared by the map layer and the legend.
 *
 * GBIF hex cells cover a fixed share of each tile, so a cell's area (and
 * typical count) grows ~4× per grid level out. Fixed bins saturate at world
 * view, so the log-scale thresholds are scaled by 4^(REF_ZOOM − level) and
 * rounded to 1-2-5 steps; the legend shows the values for the current grid
 * level (lib/map/occGrid.ts).
 * Colours come from the --ramp-* tokens: the default ramp in tokens.css, or
 * the viewer's choice from RAMPS (applied by stores/ramp.ts).
 */
export const BASE_THRESHOLDS = [10, 100, 1_000, 10_000, 100_000, 1_000_000] as const;
export const REF_ZOOM = 6;

export interface Ramp {
  id: string;
  name: string;
  /** One line for the settings list. */
  note: string;
  /** Eight stops, low to high: --ramp-0…7. The map bins use stops 1–7. */
  colors: readonly string[];
}

/**
 * The ramps a viewer can pick. The d3 ones (viridis, cividis, magma, inferno,
 * plasma) are sampled from d3-scale-chromatic; all but viridis skip their
 * darkest 12% so the lowest bins still show on the dark basemap.
 */
export const RAMPS = [
  {
    id: 'lichen-fern',
    name: 'Lichen to fern',
    note: 'Pale straw to deep teal; best on the light map',
    colors: ['#e8e2b0', '#c6d491', '#9cc27b', '#6fab6f', '#45916a', '#237563', '#105958', '#0b3c48'],
  },
  {
    id: 'viridis',
    name: 'Viridis',
    note: 'Purple to yellow, colour-blind safe',
    colors: ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'],
  },
  {
    id: 'forest-pollen',
    name: 'Forest to pollen',
    note: 'Moss green to amber, from the brand palette',
    colors: ['#2c4437', '#3f5c4c', '#5c7449', '#808845', '#a69a44', '#cfa843', '#f0b443', '#f8dc9a'],
  },
  {
    id: 'cividis',
    name: 'Cividis',
    note: 'Navy to yellow, tuned for colour blindness',
    colors: ['#10366c', '#3b4c6e', '#61636f', '#7f7b75', '#999478', '#bbae71', '#e2cb5c', '#fdea45'],
  },
  {
    id: 'magma',
    name: 'Magma',
    note: 'Purple through pink to peach',
    colors: ['#1a1042', '#4e117b', '#812581', '#b5367a', '#e55064', '#fb8761', '#fec287', '#fcfdbf'],
  },
  {
    id: 'inferno',
    name: 'Inferno',
    note: 'Embers: purple, red, orange, yellow',
    colors: ['#1e0c45', '#540f6d', '#88226a', '#ba3655', '#e35933', '#f98c0a', '#f9c932', '#fcffa4'],
  },
  {
    id: 'plasma',
    name: 'Plasma',
    note: 'Saturated violet to yellow',
    colors: ['#4903a0', '#7b02a8', '#a82296', '#cb4679', '#e56b5d', '#f89441', '#fdc328', '#f0f921'],
  },
  {
    id: 'mako',
    name: 'Mako',
    note: 'Deep blue to sea-glass',
    colors: ['#2e1e3c', '#413d7b', '#37659e', '#348fa7', '#40b7ad', '#67cfab', '#a6e1bc', '#def5e5'],
  },
  {
    id: 'batlow',
    name: 'Batlow',
    note: 'Navy, green, orange, pink; built for print',
    colors: ['#011959', '#0f3f5f', '#25575d', '#4f6b48', '#7f7d32', '#b38b3c', '#e59a6f', '#fbb6c5'],
  },
  {
    id: 'bamako',
    name: 'Bamako',
    note: 'Teal to olive to straw',
    colors: ['#00404d', '#134b42', '#275736', '#406527', '#5f7413', '#8c8a05', '#c2a63e', '#f2d68e'],
  },
] as const satisfies readonly Ramp[];

export type RampId = (typeof RAMPS)[number]['id'];
export const DEFAULT_RAMP: RampId = 'lichen-fern';

/** Whether a value is the id of a known ramp. */
export function isRampId(value: unknown): value is RampId {
  return RAMPS.some((ramp) => ramp.id === value);
}

/** The ramp with this id (the first, if none matches). */
export function rampById(id: RampId): Ramp {
  return RAMPS.find((ramp) => ramp.id === id) ?? RAMPS[0];
}

const FALLBACK = rampById(DEFAULT_RAMP).colors.slice(1);

/** Seven colours, one per bin. */
export function rampColors(): string[] {
  if (typeof document === 'undefined') return FALLBACK;
  const computedStyle = getComputedStyle(document.documentElement);
  return FALLBACK.map((fallback, index) => computedStyle.getPropertyValue(`--ramp-${index + 1}`).trim() || fallback);
}

/** Round to 1, 2 or 5 × 10ⁿ. */
export function nice(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / magnitude;
  return (mantissa < 1.5 ? 1 : mantissa < 3.5 ? 2 : mantissa < 7.5 ? 5 : 10) * magnitude;
}

/** Bin thresholds (6 values, strictly increasing) for a zoom level. */
export function thresholdsAt(zoom: number): number[] {
  const scale = 4 ** (REF_ZOOM - Math.round(zoom));
  const out: number[] = [];
  for (const base of BASE_THRESHOLDS) {
    const niceValue = nice(base * scale);
    out.push(
      out.length && niceValue <= (out[out.length - 1] as number) ? (out[out.length - 1] as number) * 10 : niceValue,
    );
  }
  return out;
}

/** A legend count, shortened: 5K, 2M, 1B. */
export function formatCount(value: number): string {
  if (value >= 1e9) return `${value / 1e9}B`;
  if (value >= 1e6) return `${value / 1e6}M`;
  if (value >= 1e3) return `${value / 1e3}K`;
  return String(value);
}

/** Lower bound of each of the 7 bins at a zoom level. */
export function binLabels(zoom: number): string[] {
  return ['1', ...thresholdsAt(zoom).map(formatCount)];
}
