/** Place search, for both supported providers. */
import { json, stubNetwork } from './helpers/network';

async function geocode(provider?: 'photon') {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (provider) vi.stubEnv('PUBLIC_GEOCODER', provider);
  return import('~/lib/geocode');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('searchPlaces', () => {
  it('does nothing for an empty query', async () => {
    const calls = stubNetwork(() => []);
    const { searchPlaces } = await geocode();
    await expect(searchPlaces('   ')).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('reads Nominatim results, reordering its bounding box', async () => {
    const calls = stubNetwork(() => [
      {
        display_name: 'Edinburgh, City of Edinburgh, Scotland',
        lat: '55.95',
        lon: '-3.19',
        boundingbox: ['55.8', '56.0', '-3.4', '-3.0'],
      },
      { display_name: 'Nowhere', name: 'Nowhere Farm', lat: '1', lon: '2' },
    ]);
    const { searchPlaces } = await geocode();
    expect(await searchPlaces(' edinburgh ')).toEqual([
      {
        name: 'Edinburgh',
        detail: 'City of Edinburgh, Scotland',
        lng: -3.19,
        lat: 55.95,
        bbox: [-3.4, 55.8, -3.0, 56.0],
      },
      { name: 'Nowhere Farm', detail: '', lng: 2, lat: 1 },
    ]);
    expect(calls[0]!.host).toBe('nominatim.openstreetmap.org');
    expect(calls[0]!.searchParams.get('q')).toBe('edinburgh');
  });

  it('reads Photon results, reordering its extent', async () => {
    const calls = stubNetwork(() => ({
      features: [
        {
          geometry: { coordinates: [-3.19, 55.95] },
          properties: { name: 'Edinburgh', state: 'Scotland', country: 'UK', extent: [-3.4, 56.0, -3.0, 55.8] },
        },
        { geometry: { coordinates: [1, 2] }, properties: {} },
      ],
    }));
    const { searchPlaces } = await geocode('photon');
    expect(await searchPlaces('edinburgh')).toEqual([
      { name: 'Edinburgh', detail: 'Scotland, UK', lng: -3.19, lat: 55.95, bbox: [-3.4, 55.8, -3.0, 56.0] },
      { name: 'edinburgh', lng: 1, lat: 2 },
    ]);
    expect(calls[0]!.host).toBe('photon.komoot.io');
  });

  it('throws on a failed response', async () => {
    stubNetwork(() => json({}, 503));
    const { searchPlaces } = await geocode();
    await expect(searchPlaces('x')).rejects.toThrow('geocoder 503');
  });
});
