/**
 * Data for the selected hex, with no N+1 calls:
 *  1. one facet request (limit=0): total count, top species, months
 *  2. one image request for all top species (repeated speciesKey), plus at
 *     most one follow-up for species that got no photo
 *  3. names from the baked index; any misses are resolved with one cached
 *     detail call each (at most 10)
 */
import { useStore } from '@nanostores/vue';
import { ref, shallowRef, watch } from 'vue';
import { loadNameIndex, nameIndexWithin } from '~/lib/data/name-index';
import {
  classifyError,
  findImages,
  getSpecies,
  occurrenceFacets,
  type UiErrorKind,
  type UsableImage,
} from '~/lib/gbif';
import { $hexGeometry, $occurrenceFilter } from '~/stores/explorer';

export interface HexSpecies {
  key: number;
  count: number;
  scientificName: string;
  commonName?: string;
  image?: UsableImage;
}

const TOP = 10;

export function useHexSummary() {
  const geometry = useStore($hexGeometry);
  const filter = useStore($occurrenceFilter);

  const loading = ref(false);
  const error = ref<UiErrorKind | null>(null);
  const count = ref<number | null>(null);
  const months = ref<number[]>(Array(12).fill(0));
  const species = shallowRef<HexSpecies[]>([]);
  const imagesLoading = ref(false);
  let seq = 0;

  async function load() {
    const g = geometry.value;
    const mine = ++seq;
    if (!g) {
      count.value = null;
      species.value = [];
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const f = { ...filter.value, geometry: g.wkt };
      const r = await occurrenceFacets(f, ['speciesKey', 'month'], { facetLimit: 12 });
      if (mine !== seq) return;
      count.value = r.count;
      const m = Array(12).fill(0) as number[];
      for (const c of r.facets['month'] ?? []) m[Number(c.name) - 1] = c.count;
      months.value = m;

      const top = (r.facets['speciesKey'] ?? []).slice(0, TOP).map((c) => ({ key: Number(c.name), count: c.count }));
      const idx = await nameIndexWithin();
      const named = await Promise.all(
        top.map(async ({ key, count: n }): Promise<HexSpecies> => {
          const row = idx?.get(key);
          if (row) return { key, count: n, scientificName: row[2], ...(row[3] && { commonName: row[3] }) };
          try {
            const u = await getSpecies(key);
            return { key, count: n, scientificName: u.canonicalName ?? u.scientificName };
          } catch {
            return { key, count: n, scientificName: `Species ${key}` };
          }
        }),
      );
      if (mine !== seq) return;
      species.value = named;
      loading.value = false;
      void loadImages(named, mine);
      // If the index was slow, add common names once it arrives (no extra calls).
      if (!idx) void enrichNames(mine);
    } catch (e) {
      if (mine === seq) {
        error.value = classifyError(e);
        loading.value = false;
      }
    }
  }

  async function enrichNames(mine: number) {
    const idx = await loadNameIndex();
    if (!idx || mine !== seq) return;
    species.value = species.value.map((s) => {
      const common = s.commonName ?? idx.get(s.key)?.[3];
      return common ? { ...s, commonName: common } : s;
    });
  }

  async function loadImages(list: HexSpecies[], mine: number) {
    if (!list.length) return;
    imagesLoading.value = true;
    const byKey = new Map<number, UsableImage>();
    const fetchFor = async (keys: number[], limit: number) => {
      const res = await findImages({ speciesKeys: keys }, { limit });
      // Records carry speciesKey; map each image back to its species.
      for (const img of res.images) {
        const k = img.speciesKey;
        if (k !== undefined && keys.includes(k) && !byKey.has(k)) byKey.set(k, img);
      }
    };
    try {
      const keys = list.map((s) => s.key);
      await fetchFor(keys, 100);
      const missing = keys.filter((k) => !byKey.has(k));
      if (missing.length) await fetchFor(missing, 60);
    } catch {
      /* photos are optional; cards fall back to initials */
    }
    if (mine !== seq) return;
    species.value = species.value.map((s) => {
      const image = byKey.get(s.key);
      return image ? { ...s, image } : s;
    });
    imagesLoading.value = false;
  }

  watch([geometry, () => JSON.stringify(filter.value)], () => void load(), { immediate: true });

  return { loading, error, count, months, species, imagesLoading, reload: load };
}
