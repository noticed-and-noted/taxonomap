<script setup lang="ts">
/**
 * Distribution mini-map: the world at zoom 1 (2×2 tiles of GBIF's basemap)
 * with the explorer's hex density layer drawn on a canvas from GBIF's vector
 * tiles, in the ramp picked in map settings. No MapLibre, so species pages
 * stay light. Links to the explorer filtered to the taxon.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { gbifBasemapTile, isEdgeUrl, markEdgeDown, occurrenceTileTemplate } from '~/lib/gbif';
import { hexRecords, homeOffset } from '~/lib/map/occGrid';
import { rampColors, thresholdsAt } from '~/lib/ramp';
import { $ramp } from '~/stores/ramp';

const props = defineProps<{ taxonKey: number; label: string }>();

const Z = 1;
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

async function fetchTile(x: number, y: number, retried = false): Promise<Tile | null> {
  const url = occurrenceTileTemplate({ taxonKey: props.taxonKey }, { hexPerTile: 45 }, 'mvt')
    .replace('{z}', String(Z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
  let res: Response;
  try {
    res = await fetch(url);
    if (!res.ok && res.status !== 204) throw new Error(String(res.status));
  } catch {
    // Edge failures retry direct.
    if (!retried && isEdgeUrl(url)) {
      markEdgeDown();
      return fetchTile(x, y, true);
    }
    return null;
  }
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) return null;
  const layer = new VectorTile(new PbfReader(buf)).layers.occurrence;
  if (!layer) return null;
  const hexes: Hex[] = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const rings = f.loadGeometry();
    hexes.push({ rings, total: hexRecords(f.properties.total), home: homeOffset(rings[0] ?? [], layer.extent) });
  }
  return { extent: layer.extent, hexes };
}

let loaded: (Tile | null)[] = [];

/** Same bins as the explorer's legend at this zoom. */
function paint() {
  const ctx = canvas.value?.getContext('2d');
  if (!ctx) return;
  const colors = rampColors();
  const bins = thresholdsAt(Z);
  const colorOf = (n: number) => {
    const bin = bins.findIndex((t) => n < t);
    return colors[bin === -1 ? colors.length - 1 : bin]!;
  };
  ctx.clearRect(0, 0, TILE_PX * 2, TILE_PX * 2);
  loaded.forEach((tile, i) => {
    if (!tile) return;
    const [tx, ty] = tiles[i]!;
    const k = TILE_PX / tile.extent;
    for (const hex of tile.hexes) {
      // An edge cell comes in each tile it touches; draw the copy from the tile holding its centre (see mergeHexes).
      const [dx, dy] = hex.home;
      const homeX = (((tx + dx) % 2 ** Z) + 2 ** Z) % 2 ** Z;
      if ((dx || dy) && loaded[tiles.findIndex(([x, y]) => x === homeX && y === ty + dy)]) continue;
      ctx.beginPath();
      for (const ring of hex.rings) {
        ring.forEach((p, j) => {
          const px = tx * TILE_PX + p.x * k;
          const py = ty * TILE_PX + p.y * k;
          if (j) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        });
        ctx.closePath();
      }
      ctx.fillStyle = colorOf(hex.total);
      ctx.fill('evenodd');
    }
  });
}

let unlisten: (() => void) | undefined;
onMounted(async () => {
  unlisten = $ramp.listen(paint);
  loaded = await Promise.all(tiles.map(([x, y]) => fetchTile(x, y)));
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
        <span v-for="([x, y], i) in tiles" :key="i" class="relative block">
          <img
            :src="gbifBasemapTile(Z, x, y, 'dark')"
            alt=""
            loading="lazy"
            class="base-dark absolute inset-0 size-full"
          />
          <img
            :src="gbifBasemapTile(Z, x, y, 'light')"
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
        Explore on the map →
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
