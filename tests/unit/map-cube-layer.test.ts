/**
 * The cube layer: summing a view's rows into hexes (years, sample scale), loading on each settled view at
 * the zoom's resolution, dropping a load a newer one overtook, failing like the GBIF layer, and finding
 * cells by H3 rather than by geometry.
 */
import { latLngToCell } from 'h3-js';
import type { Map as MlMap } from 'maplibre-gl';
import type { CubeSet, MapRow } from '~/lib/cubes/reader';
import type { CubeQuery } from '~/lib/cubes/route';
import { createCubeLayer, sumCells } from '~/lib/map/cubeLayer';

const WIDTH = 1024;
const HEIGHT = 768;
const birds: CubeQuery = { rank: 'class', taxon: 'Aves', year: null };
const london = (resolution: number) => latLngToCell(51.5, -0.1, resolution);
const row = (cell: string, year: number | null, records: number): MapRow => ({
  kingdom: 'Animalia',
  taxon: 'Aves',
  year,
  cell: BigInt(`0x${cell}`),
  records: BigInt(records),
});

/** A map around London at a zoom, whose canvas spans a box that shrinks as it zooms in. */
function fakeMap(initialZoom: number) {
  let zoom = initialZoom;
  const handlers = new Set<() => void>();
  const map = {
    getZoom: () => zoom,
    getCenter: () => ({ lng: -0.1, lat: 51.5 }),
    getCanvas: () => ({ clientWidth: WIDTH, clientHeight: HEIGHT }),
    unproject: ([pixelX, pixelY]: [number, number]) => {
      const span = 360 / 2 ** zoom;
      return { lng: -0.1 + (pixelX / WIDTH - 0.5) * span, lat: 51.5 - (pixelY / HEIGHT - 0.5) * (span / 2) };
    },
    on: (_name: string, handler: () => void) => void handlers.add(handler),
    off: (_name: string, handler: () => void) => void handlers.delete(handler),
  };
  return {
    map: map as unknown as MlMap,
    zoomTo: (next: number) => (zoom = next),
    moveEnd: () => handlers.forEach((handler) => handler()),
    listening: () => handlers.size,
  };
}

function setup(
  options: {
    zoom?: number;
    rows?: MapRow[];
    scale?: number;
    isEmpty?: (hex: { properties: { total: number } }) => boolean;
  } = {},
) {
  const mapRows = vi.fn<CubeSet['mapRows']>(async () => options.rows ?? []);
  const callbacks = { onCells: vi.fn(), onLevel: vi.fn(), onProgress: vi.fn(), onFailed: vi.fn() };
  const fake = fakeMap(options.zoom ?? 5);
  const cubes: CubeSet = {
    snapshot: '2026-11-01',
    scale: options.scale ?? 1,
    mapRows,
    cellRows: vi.fn(),
    recordRows: vi.fn(),
  };
  const layer = createCubeLayer(fake.map, {
    ...callbacks,
    ...(options.isEmpty && { isEmpty: options.isEmpty }),
    cubes,
    query: birds,
  });
  return { layer, mapRows, fake, ...callbacks };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const totals = (onCells: ReturnType<typeof vi.fn>) =>
  (onCells.mock.lastCall![0] as GeoJSON.FeatureCollection).features.map((feature) => feature.properties!['total']);

describe('sumCells', () => {
  const rows = [row('8a', 2010, 2), row('8a', 2015, 3), row('8b', null, 4), row('8b', 2030, 1)];

  it('sums every year without a range, and scales a sample up', () => {
    expect([...sumCells(rows, birds, 1.5)]).toEqual([
      ['8a', 8],
      ['8b', 8],
    ]);
  });

  it('keeps only the range’s years, dropping undated rows', () => {
    expect([...sumCells(rows, { ...birds, year: [2012, 2020] }, 1)]).toEqual([['8a', 3]]);
  });
});

describe('createCubeLayer', () => {
  it('loads the view’s cells at the zoom’s resolution and draws them as hexes', async () => {
    const { mapRows, onCells, onLevel, onProgress } = setup({ rows: [row(london(4), 2020, 7)], scale: 2 });
    await settle();
    expect(onLevel).toHaveBeenCalledWith(5);
    const [query, resolution, ranges] = mapRows.mock.lastCall!;
    expect([query, resolution]).toEqual([birds, 4]);
    expect(ranges!.length).toBeGreaterThan(0);
    expect(totals(onCells)).toEqual([14]);
    expect(onProgress.mock.calls).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it('reads the whole world when zoomed out', async () => {
    const { mapRows } = setup({ zoom: 1 });
    await settle();
    expect(mapRows.mock.lastCall![2]).toBeNull();
  });

  it('loads again after each move, at a new resolution once the zoom calls for one', async () => {
    const { mapRows, onLevel, fake } = setup();
    await settle();
    fake.moveEnd();
    fake.zoomTo(7);
    fake.moveEnd();
    await settle();
    expect(mapRows.mock.calls.map((call) => call[1])).toEqual([4, 4, 5]);
    expect(onLevel.mock.calls).toEqual([[5], [6]]);
  });

  it('drops a load that a newer one overtook', async () => {
    const { mapRows, onCells, fake } = setup();
    await settle();
    let finishFirst: (rows: MapRow[]) => void = () => {};
    mapRows.mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)));
    mapRows.mockResolvedValueOnce([row(london(4), 2020, 2)]);
    fake.moveEnd();
    fake.moveEnd();
    await settle();
    finishFirst([row(london(4), 2020, 99)]);
    await settle();
    expect(totals(onCells)).toEqual([2]);
  });

  it('reports a failed read once, leaving the drawn cells up, and ignores a failure a newer load overtook', async () => {
    const { mapRows, onCells, onFailed, fake } = setup();
    await settle();
    onCells.mockClear();
    let failFirst: () => void = () => {};
    mapRows.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (failFirst = () => reject(new Error('gone')))),
    );
    mapRows.mockRejectedValueOnce(new Error('gone'));
    fake.moveEnd();
    fake.moveEnd();
    await settle();
    failFirst();
    await settle();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onCells).not.toHaveBeenCalled();
  });

  it('switches to another taxon or years without a new layer', async () => {
    const { layer, mapRows } = setup();
    await settle();
    layer.setQuery({ ...birds, year: [2000, 2010] });
    await settle();
    expect(mapRows.mock.lastCall![0]).toEqual({ ...birds, year: [2000, 2010] });
  });

  it('finds the cell under a point by H3, loaded or not, at any level', async () => {
    const { layer } = setup({ rows: [row(london(4), 2020, 3)] });
    await settle();
    expect(layer.cellAt([-0.1, 51.5])?.properties.total).toBe(3);
    expect(layer.cellAt([100, 10])).toBeUndefined();
    expect((await layer.findCell([-0.1, 51.5], 5))?.properties.total).toBe(3);
    expect((await layer.findCell([-0.1, 51.5], 6))?.properties).toEqual({
      id: london(5),
      total: 0,
      home: true,
      h3: london(5),
    });
    expect((await layer.findCell([100, 10], 5))?.properties.total).toBe(0);
  });

  it('gives the colour level a zoom would show, and leaves out cells known to be empty', async () => {
    const { layer } = setup({
      rows: [row(london(4), 2020, 3), row(latLngToCell(48.9, 2.3, 4), 2020, 1)],
      isEmpty: (hex) => hex.properties.total === 1,
    });
    await settle();
    expect([layer.levelAt(1, 0), layer.levelAt(7, 0)]).toEqual([2, 6]);
    expect(layer.collection().features.map((feature) => feature.properties?.['total'])).toEqual([3]);
  });

  it('redraws on request and stops on destroy', async () => {
    const { layer, onCells, mapRows, fake } = setup();
    await settle();
    layer.redraw();
    expect(onCells).toHaveBeenCalledTimes(2);
    layer.destroy();
    expect(fake.listening()).toBe(0);
    expect(mapRows).toHaveBeenCalledTimes(1);
  });
});
