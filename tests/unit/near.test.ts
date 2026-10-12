// @vitest-environment jsdom
import { checklistCsv } from '~/lib/near/checklist';
import { circleRing, roundLatLng } from '~/lib/gbif/params';
import { __resetUrlSync } from '~/stores/url-sync';

describe('near me', () => {
  beforeEach(() => {
    __resetUrlSync();
    history.replaceState(null, '', '/near');
  });

  it('rounds any location to 3 dp before it is stored', async () => {
    const { $nearAt, setNearLocation } = await import('~/stores/near');
    setNearLocation(51.5073509, -0.1277583);
    expect($nearAt.get()).toEqual({ lat: 51.507, lng: -0.128 });
    expect(roundLatLng(-33.86785, 151.20732)).toEqual({ lat: -33.868, lng: 151.207 });
  });

  it('frames larger radii with lower zooms', async () => {
    const { zoomForRadius } = await import('~/stores/near');
    expect(zoomForRadius(1)).toBeGreaterThan(zoomForRadius(50));
    expect(zoomForRadius(50)).toBeGreaterThanOrEqual(6);
  });

  it('builds a closed circle ring around the rounded centre', () => {
    const ring = circleRing(51.5073509, -0.1277583, 2);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const lats = ring.map((p) => p[1]);
    expect(Math.max(...lats) - 51.507).toBeCloseTo(2 / 110.574, 3);
  });

  it('exports the checklist as CSV with escaping', () => {
    const csv = checklistCsv([
      { key: 1, scientificName: 'Erithacus rubecula', commonName: 'European Robin, "redbreast"', seen: '2026-10-12' },
    ]);
    expect(csv.split('\n')[0]).toBe('gbif_taxon_key,scientific_name,common_name,date_ticked,gbif_url');
    expect(csv).toContain('"European Robin, ""redbreast"""');
    expect(csv).toContain('https://www.gbif.org/species/1');
  });
});
