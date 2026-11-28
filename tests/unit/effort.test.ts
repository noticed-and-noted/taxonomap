// @vitest-environment jsdom
/** Adjusting Analyse for recording effort: the species' group, shares and rates, and what the map compares with. */
import type { Hex } from '~/lib/map/occGrid';

/** A cell with a total. */
function hex(id: string, total: number): Hex {
  return {
    type: 'Feature',
    properties: { id, total, home: true },
    geometry: { type: 'Polygon', coordinates: [[[0, 0]]] },
  };
}

describe('recordingGroup', () => {
  it('compares a species with its class, in plain words where there are some', async () => {
    const { recordingGroup } = await import('~/lib/analyse/effort');
    expect(recordingGroup({ classKey: 212, class: 'Aves', kingdomKey: 1 })).toEqual({ key: 212, name: 'bird' });
    expect(recordingGroup({ classKey: 9999, class: 'Pauropoda' })).toEqual({ key: 9999, name: 'Pauropoda' });
  });

  it('falls back to the phylum or kingdom, and to none', async () => {
    const { recordingGroup } = await import('~/lib/analyse/effort');
    expect(recordingGroup({ phylumKey: 52, phylum: 'Mollusca', kingdomKey: 1 })).toEqual({ key: 52, name: 'Mollusca' });
    expect(recordingGroup({ kingdomKey: 6 })).toEqual({ key: 6, name: 'related species’' });
    expect(recordingGroup({})).toBeNull();
  });
});

describe('shares and rates', () => {
  it('divides by the baseline, capped at all of it, and is 0 with none', async () => {
    const { shareOf, perMillion } = await import('~/lib/analyse/effort');
    expect(shareOf(5, 20)).toBe(0.25);
    expect(shareOf(30, 20)).toBe(1);
    expect(shareOf(5, 0)).toBe(0);
    expect(perMillion(3, 2_000_000)).toBe(1.5);
    expect(perMillion(3, 0)).toBe(0);
  });

  it('writes shares and rates to two significant figures', async () => {
    const { formatShare, formatRate } = await import('~/lib/analyse/effort');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.00001)).toBe('<0.01%');
    expect(formatShare(0.004213)).toBe('0.42%');
    expect(formatShare(0.1234)).toBe('12%');
    expect(formatRate(0.4213)).toBe('0.42');
    expect(formatRate(1234.6)).toBe('1,235');
  });
});

describe('withShares', () => {
  it("gives each cell its share of the baseline's records in the same cell", async () => {
    const { withShares } = await import('~/lib/map/occLayer');
    const cells = withShares([hex('a', 5), hex('b', 4), hex('c', 0)], [hex('a', 20), hex('c', 0)]);
    expect(cells.map((cell) => cell.properties.share)).toEqual([0.25, 1, 1]);
  });
});

describe('shareFillColor', () => {
  it('steps through the ramp by share', async () => {
    const { shareFillColor } = await import('~/lib/map/style');
    const { SHARE_THRESHOLDS } = await import('~/lib/analyse/effort');
    const expression = shareFillColor() as unknown[];
    expect(expression[0]).toBe('step');
    expect(expression.filter((value) => typeof value === 'number')).toEqual([...SHARE_THRESHOLDS]);
  });
});

describe('the map baseline', () => {
  async function loadStores(search: string) {
    vi.resetModules();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    history.replaceState(null, '', `/${search}`);
    return { ...(await import('~/stores/map-filter')), ...(await import('~/stores/analyse')) };
  }

  it("is the species' group in the same month, only in Migration with the setting on and the group known", async () => {
    const stores = await loadStores('?analyse=1&ak=9515886&ame=1&am=6&ayr=2010-2020');
    expect(stores.$mapBaseline.get()).toBeNull();
    stores.$analyseGroup.set({ key: 212, name: 'birds' });
    expect(stores.$mapBaseline.get()).toEqual({ taxonKey: 212, year: [2010, 2020], months: [6] });
    stores.$analyseView.set('spread');
    expect(stores.$mapBaseline.get()).toBeNull();
    stores.$analyseView.set('migration');
    stores.$migrationEffort.set(false);
    expect(stores.$mapBaseline.get()).toBeNull();
  });

  it('turns both settings off when Analyse is left', async () => {
    const stores = await loadStores('?analyse=1&ame=1&ase=1');
    expect(stores.$spreadEffort.get()).toBe(true);
    stores.$analyseGroup.set({ key: 212, name: 'birds' });
    stores.resetAnalyse();
    expect(stores.$migrationEffort.get()).toBe(false);
    expect(stores.$spreadEffort.get()).toBe(false);
    expect(stores.$analyseGroup.get()).toBeNull();
  });
});
