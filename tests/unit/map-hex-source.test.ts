/**
 * Which layer draws the hexes: none until the first update, then GBIF's tiles unless the cube setting is
 * on and the router finds a cube slice; swapping, re-querying, falling back on failure and retrying.
 */
import type { OccurrenceFilter } from '~/lib/gbif';
import type { CubeLayer } from '~/lib/map/cubeLayer';
import { createHexSource, type CubeKit, type HexSourceState } from '~/lib/map/hexSource';
import type { OccLayer } from '~/lib/map/occLayer';

const layer = <T extends OccLayer>(extra: object = {}) =>
  ({
    collection: vi.fn(),
    cellAt: vi.fn(),
    findCell: vi.fn(),
    levelAt: vi.fn(),
    redraw: vi.fn(),
    destroy: vi.fn(),
    ...extra,
  }) as unknown as T & { destroy: ReturnType<typeof vi.fn> };

function setup(initial: { isOn?: boolean; filter?: OccurrenceFilter; zoom?: number } = {}) {
  const state = { isOn: initial.isOn ?? true, filter: initial.filter ?? { taxonKey: 212 }, zoom: initial.zoom ?? 5 };
  const gbifLayers: ReturnType<typeof layer>[] = [];
  const cubeLayers: (ReturnType<typeof layer<CubeLayer>> & { setQuery: ReturnType<typeof vi.fn> })[] = [];
  const failures: (() => void)[] = [];
  const kit: CubeKit = {
    cubes: { snapshot: '2026-11-01', scale: 100, mapRows: vi.fn(), cellRows: vi.fn(), recordRows: vi.fn() },
    createLayer: (_query, onFailed) => {
      failures.push(onFailed);
      const created = layer<CubeLayer>({ setQuery: vi.fn() }) as (typeof cubeLayers)[number];
      cubeLayers.push(created);
      return created;
    },
  };
  const loadCubes = vi.fn(async () => kit);
  const states: HexSourceState[] = [];
  const lookup = vi.fn(async (key: number) =>
    key === 212 ? { scientificName: 'Aves', rank: 'CLASS' } : { scientificName: 'Abc d', rank: 'SUBSPECIES' },
  );
  const source = createHexSource({
    createGbifLayer: () => {
      const created = layer();
      gbifLayers.push(created);
      return created;
    },
    loadCubes,
    isCubesOn: () => state.isOn,
    filter: () => state.filter,
    zoom: () => state.zoom,
    lookup,
    onState: (next) => states.push(next),
  });
  return { source, state, gbifLayers, cubeLayers, failures, loadCubes, states };
}

describe('createHexSource', () => {
  it('starts no layer until the first update', () => {
    const { source, gbifLayers } = setup();
    expect(source.layer()).toBeUndefined();
    expect(gbifLayers).toHaveLength(0);
  });

  it('draws GBIF’s tiles with the setting off, without loading the cubes', async () => {
    const { source, gbifLayers, loadCubes, states } = setup({ isOn: false });
    await source.update();
    await source.update();
    expect(source.layer()).toBe(gbifLayers[0]);
    expect(gbifLayers).toHaveLength(1);
    expect(loadCubes).not.toHaveBeenCalled();
    expect(states).toEqual([{ kind: 'gbif' }]);
  });

  it('draws the cubes straight away when they can serve the first view', async () => {
    const { source, gbifLayers, cubeLayers, states } = setup();
    await source.update();
    expect(gbifLayers).toHaveLength(0);
    expect(source.layer()).toBe(cubeLayers[0]);
    expect(states).toEqual([{ kind: 'cubes', sampleShare: 0.01 }]);
  });

  it('re-queries the cube layer only when the slice changes', async () => {
    const { source, state, cubeLayers } = setup();
    await source.update();
    await source.update();
    state.filter = { taxonKey: 212, year: [2010, 2019] };
    await source.update();
    expect(cubeLayers).toHaveLength(1);
    expect(cubeLayers[0]!.setQuery.mock.calls).toEqual([[{ rank: 'class', taxon: 'Aves', year: [2010, 2019] }]]);
  });

  it('swaps back to GBIF for a filter the cubes can’t serve, or a taxon they don’t hold', async () => {
    const { source, state, gbifLayers, cubeLayers } = setup();
    await source.update();
    state.filter = { taxonKey: 212, hasImage: true };
    await source.update();
    expect(cubeLayers[0]!.destroy).toHaveBeenCalled();
    expect(source.layer()).toBe(gbifLayers[0]);
    await source.update();
    state.filter = { taxonKey: 1 };
    await source.update();
    expect(gbifLayers).toHaveLength(1);
  });

  it('swaps GBIF’s layer for the cubes once a view calls for them', async () => {
    const { source, state, gbifLayers, cubeLayers } = setup({ zoom: 1 });
    await source.update();
    state.zoom = 5;
    await source.update();
    expect(gbifLayers[0]!.destroy).toHaveBeenCalled();
    expect(source.layer()).toBe(cubeLayers[0]);
  });

  it('falls back to GBIF when the cubes can’t be opened, until retried', async () => {
    const { source, loadCubes, states, cubeLayers } = setup();
    loadCubes.mockRejectedValueOnce(new Error('offline'));
    await source.update();
    expect(states.at(-1)).toEqual({ kind: 'cubes-failed' });
    await source.update();
    expect(loadCubes).toHaveBeenCalledTimes(1);
    await source.retry();
    expect(source.layer()).toBe(cubeLayers[0]);
  });

  it('falls back to GBIF when a cube layer fails to read', async () => {
    const { source, failures, gbifLayers, states } = setup();
    await source.update();
    failures[0]!();
    expect(source.layer()).toBe(gbifLayers[0]);
    expect(states.slice(-2)).toEqual([{ kind: 'cubes-failed' }, { kind: 'cubes-failed' }]);
  });

  it('drops an update that a newer one overtook, failed or not', async () => {
    const { source, state, loadCubes, cubeLayers, states } = setup();
    let finish: (kit: CubeKit) => void = () => {};
    let fail: () => void = () => {};
    const kit = await loadCubes();
    loadCubes.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    loadCubes.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = () => reject(new Error('slow')))));
    const first = source.update();
    const second = source.update();
    state.isOn = false;
    await source.update();
    finish(kit);
    fail();
    await Promise.all([first, second]);
    expect(cubeLayers).toHaveLength(0);
    expect(states).toEqual([{ kind: 'gbif' }]);
  });

  it('stops the drawing layer on destroy', async () => {
    const { source, cubeLayers } = setup();
    source.destroy();
    await source.update();
    source.destroy();
    expect(cubeLayers[0]!.destroy).toHaveBeenCalled();
  });
});
