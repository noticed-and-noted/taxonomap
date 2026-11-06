<script setup lang="ts">
/**
 * Distribution mini-map: the world at zoom 1 (2×2 tiles of GBIF's basemap)
 * with the explorer's hex density layer drawn on a canvas from GBIF's vector
 * tiles, in the ramp picked in map settings. No MapLibre, so species pages
 * stay light. Links to the explorer filtered to the taxon. In cube mode (`cubeTaxon`) the hexes come
 * from the map cube instead of GBIF's tiles; the basemap is still GBIF's imagery.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import type { MiniMapShape } from '~/lib/cubes/miniMap';
import type { CubeTaxon } from '~/lib/cubes/route';
import { gbifBasemapTile, occurrenceTileTemplate } from '~/lib/gbif';
import { hexRecords, homeOffset } from '~/lib/map/occGrid';
import { rampColors, thresholdsAt } from '~/lib/ramp';
import { openedCubes } from '~/stores/cubes';
import { $ramp } from '~/stores/ramp';

const props = defineProps<{
  taxonKey: number;
  label: string;
  /** In cube mode: the taxon as the cubes name it, so the hexes come from the map cube. */
  cubeTaxon?: (CubeTaxon & { kingdom?: string }) | undefined;
}>();

const ZOOM = 1;
const tiles = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;
/** Canvas pixels per tile. */
const TILE_PX = 512;

const canvas = ref<HTMLCanvasElement>();

/** One tile's hexes: rings in tile units (0…extent), the record count and the tile holding its centre (offset in tiles). */
interface Hex {
  rings: { x: number; y: number }[][];
  total: number;
  home: [number, number];
}
interface Tile {
  extent: number;
  hexes: Hex[];
}

async function fetchTile(tileX: number, tileY: number): Promise<Tile | null> {
  const url = occurrenceTileTemplate({ taxonKey: props.taxonKey }, { hexPerTile: 45 }, 'mvt')
    .replace('{z}', String(ZOOM))
    .replace('{x}', String(tileX))
    .replace('{y}', String(tileY));
  let response: Response;
  try {
    response = await fetch(url);
    if (!response.ok && response.status !== 204) throw new Error(String(response.status));
  } catch {
    return null;
  }
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) return null;
  const layer = new VectorTile(new PbfReader(buffer)).layers.occurrence;
  if (!layer) return null;
  const hexes: Hex[] = [];
  for (let index = 0; index < layer.length; index++) {
    const feature = layer.feature(index);
    const rings = feature.loadGeometry();
    hexes.push({ rings, total: hexRecords(feature.properties.total), home: homeOffset(rings[0] ?? [], layer.extent) });
  }
  return { extent: layer.extent, hexes };
}

let loaded: (Tile | null)[] = [];
/** In cube mode, the cells to draw, and the colour level their counts bin at. */
let cubeCells: { shapes: MiniMapShape[]; level: number } | null = null;

/** The taxon's cells from the map cube; none if the cubes can't be read. */
async function loadCubeCells(taxon: NonNullable<typeof props.cubeTaxon>) {
  const [{ miniMapShapes }, cubes] = await Promise.all([import('~/lib/cubes/miniMap'), openedCubes()]);
  return miniMapShapes(cubes, taxon, taxon.kingdom, TILE_PX * 2);
}

/** Draws cube cells, already in canvas pixels. */
function paintCubeCells(context: CanvasRenderingContext2D, colorOf: (count: number) => string) {
  for (const shape of cubeCells?.shapes ?? []) {
    context.beginPath();
    shape.points.forEach(([px, py], index) => (index ? context.lineTo(px, py) : context.moveTo(px, py)));
    context.closePath();
    context.fillStyle = colorOf(shape.total);
    context.fill();
  }
}

/** Draws GBIF's tile hexes, each from the tile holding its centre. */
function paintTiles(context: CanvasRenderingContext2D, colorOf: (count: number) => string) {
  loaded.forEach((tile, index) => {
    if (!tile) return;
    const [tileX, tileY] = tiles[index]!;
    const scale = TILE_PX / tile.extent;
    for (const hex of tile.hexes) {
      // An edge cell comes in each tile it touches; draw the copy from the tile holding its centre (see mergeHexes).
      const [dx, dy] = hex.home;
      const homeX = (((tileX + dx) % 2 ** ZOOM) + 2 ** ZOOM) % 2 ** ZOOM;
      if (
        (dx || dy) &&
        loaded[tiles.findIndex(([candidateX, candidateY]) => candidateX === homeX && candidateY === tileY + dy)]
      )
        continue;
      context.beginPath();
      for (const ring of hex.rings) {
        ring.forEach((point, pointIndex) => {
          const px = tileX * TILE_PX + point.x * scale;
          const py = tileY * TILE_PX + point.y * scale;
          if (pointIndex) context.lineTo(px, py);
          else context.moveTo(px, py);
        });
        context.closePath();
      }
      context.fillStyle = colorOf(hex.total);
      context.fill('evenodd');
    }
  });
}

/** Same bins as the explorer's legend at this zoom. */
function paint() {
  const context = canvas.value?.getContext('2d');
  if (!context) return;
  const colors = rampColors();
  const bins = thresholdsAt(cubeCells?.level ?? ZOOM);
  const colorOf = (count: number) => {
    const bin = bins.findIndex((threshold) => count < threshold);
    return colors[bin === -1 ? colors.length - 1 : bin]!;
  };
  context.clearRect(0, 0, TILE_PX * 2, TILE_PX * 2);
  if (cubeCells) {
    paintCubeCells(context, colorOf);
    return;
  }
  paintTiles(context, colorOf);
}

let unlisten: (() => void) | undefined;
onMounted(async () => {
  unlisten = $ramp.listen(paint);
  if (props.cubeTaxon) {
    // Cube mode draws nothing rather than GBIF's tiles when the cubes can't be read.
    cubeCells = await loadCubeCells(props.cubeTaxon).catch(() => ({ shapes: [], level: ZOOM }));
  } else loaded = await Promise.all(tiles.map(([tileX, tileY]) => fetchTile(tileX, tileY)));
  paint();
});
onBeforeUnmount(() => unlisten?.());
</script>

<template>
  <figure class="mini-map">
    <a
      :href="`/?taxon=${taxonKey}`"
      class="group relative block aspect-square overflow-hidden rounded-md border border-border"
      :aria-label="`Open the map of ${label} records`"
    >
      <span class="grid size-full grid-cols-2 grid-rows-2">
        <span v-for="([tileX, tileY], index) in tiles" :key="index" class="relative block">
          <img
            :src="gbifBasemapTile(ZOOM, tileX, tileY, 'dark')"
            crossorigin="anonymous"
            alt=""
            loading="lazy"
            class="base-dark absolute inset-0 size-full"
          />
          <img
            :src="gbifBasemapTile(ZOOM, tileX, tileY, 'light')"
            crossorigin="anonymous"
            alt=""
            loading="lazy"
            class="base-light absolute inset-0 size-full"
          />
        </span>
      </span>
      <canvas
        ref="canvas"
        :width="TILE_PX * 2"
        :height="TILE_PX * 2"
        class="pointer-events-none absolute inset-0 size-full opacity-90"
      />
      <span
        class="absolute bottom-2 right-2 rounded-sm bg-surface/90 px-2 py-1 text-xs text-text shadow-panel transition-colors duration-200 group-hover:bg-accent group-hover:text-accent-contrast"
      >
        Explore on the map <UiIcon name="arrow-right" />
      </span>
    </a>
    <figcaption class="mt-1 text-xs text-subtle">Where {{ label }} has been recorded (all years).</figcaption>
  </figure>
</template>

<style>
/* Unscoped: Vue's :global() would discard the rest of the selector. */
[data-theme='light'] .mini-map .base-dark,
:root:not([data-theme='light']) .mini-map .base-light {
  display: none;
}
</style>
