/**
 * Which layer draws the hexes: none until the first update, then GBIF's tiles with the cube setting off,
 * and always the cubes with it on, never GBIF: re-querying, nothing drawn on failure or an unsupported
 * taxon, and retrying.
 */
import type { OccurrenceFilter } from '~/lib/gbif';
import type { CubeLayer } from '~/lib/map/cubeLayer';
import { createHexSource, type CubeKit, type HexSourceState } from '~/lib/map/hexSource';
import type { OccLayer } from '~/lib/map/occLayer';
import { cubeQuery, cubeSet } from './helpers/cubes';

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

function setup(initial: { isOn?: boolean; filter?: OccurrenceFilter } = {}) {
  const state = { isOn: initial.isOn ?? true, filter: initial.filter ?? { taxonKey: 212 } };
  const gbifLayers: ReturnType<typeof layer>[] = [];
  const cubeLayers: (ReturnType<typeof layer<CubeLayer>> & { setQuery: ReturnType<typeof vi.fn> })[] = [];
  const failures: (() => void)[] = [];
  const kit: CubeKit = {
    cubes: cubeSet({ partsRead: 100, partsTotal: 10_000, scale: 100 }),
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
    lookup,
    onState: (next) => states.push(next),
  });
  return { source, state, gbifLayers, cubeLayers, failures, loadCubes, states };
}

describe('createHexSource', () => {
  const CUBES = { kind: 'cubes', snapshot: '2026-11-01', partsRead: 100, partsTotal: 10_000 };

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

  it('draws the cubes for every filter with the setting on, never GBIF', async () => {
    const { source, state, gbifLayers, cubeLayers, states } = setup();
    await source.update();
    state.filter = { taxonKeys: [212, 212], hasImage: true, months: [5] };
    await source.update();
    expect(gbifLayers).toHaveLength(0);
    expect(source.layer()).toBe(cubeLayers[0]);
    expect(states).toEqual([CUBES]);
  });

  it('re-queries the cube layer only when the slice changes', async () => {
    const { source, state, cubeLayers } = setup();
    await source.update();
    await source.update();
    state.filter = { taxonKey: 212, year: [2010, 2019] };
    await source.update();
    expect(cubeLayers).toHaveLength(1);
    expect(cubeLayers[0]!.setQuery.mock.calls).toEqual([
      [cubeQuery({ taxa: [{ rank: 'class', taxon: 'Aves' }], year: [2010, 2019] })],
    ]);
  });

  it('draws nothing for a taxon the cubes don’t hold, then the cubes again', async () => {
    const { source, state, gbifLayers, cubeLayers, states } = setup();
    await source.update();
    state.filter = { taxonKey: 1 };
    await source.update();
    expect(cubeLayers[0]!.destroy).toHaveBeenCalled();
    expect(source.layer()).toBeUndefined();
    expect(states.at(-1)).toEqual({ kind: 'cubes-unsupported' });
    state.filter = { taxonKey: 212 };
    await source.update();
    expect(source.layer()).toBe(cubeLayers[1]);
    expect(gbifLayers).toHaveLength(0);
  });

  it('swaps between GBIF and the cubes as the setting changes', async () => {
    const { source, state, gbifLayers, cubeLayers } = setup({ isOn: false });
    await source.update();
    state.isOn = true;
    await source.update();
    expect(gbifLayers[0]!.destroy).toHaveBeenCalled();
    expect(source.layer()).toBe(cubeLayers[0]);
    state.isOn = false;
    await source.update();
    expect(source.layer()).toBe(gbifLayers[1]);
  });

  it('draws nothing when the cubes can’t be opened, until retried', async () => {
    const { source, loadCubes, states, cubeLayers, gbifLayers } = setup();
    loadCubes.mockRejectedValueOnce(new Error('offline'));
    await source.update();
    expect(states.at(-1)).toEqual({ kind: 'cubes-failed' });
    expect(source.layer()).toBeUndefined();
    await source.update();
    expect(loadCubes).toHaveBeenCalledTimes(1);
    await source.retry();
    expect(source.layer()).toBe(cubeLayers[0]);
    expect(gbifLayers).toHaveLength(0);
  });

  it('draws nothing when a cube layer fails to read', async () => {
    const { source, failures, gbifLayers, states } = setup();
    await source.update();
    failures[0]!();
    expect(source.layer()).toBeUndefined();
    expect(gbifLayers).toHaveLength(0);
    expect(states.at(-1)).toEqual({ kind: 'cubes-failed' });
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
