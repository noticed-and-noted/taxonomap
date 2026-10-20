/**
 * Place search. Called on submit only, never as you type: Nominatim's usage
 * policy forbids autocomplete. The provider is configurable
 * (PUBLIC_GEOCODER = nominatim | photon, PUBLIC_GEOCODER_URL).
 */
import { env } from '~/lib/env';

export interface Place {
  name: string;
  detail?: string;
  lng: number;
  lat: number;
  /** [west, south, east, north] when the provider returns one. */
  bbox?: [number, number, number, number];
}

const PROVIDER = (env['PUBLIC_GEOCODER'] || 'nominatim') as 'nominatim' | 'photon';
const BASE =
  env['PUBLIC_GEOCODER_URL'] ||
  (PROVIDER === 'photon' ? 'https://photon.komoot.io/api/' : 'https://nominatim.openstreetmap.org/search');

interface NominatimHit {
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; country?: string; state?: string; extent?: [number, number, number, number] };
}

/**
 * Places matching a search text.
 * @param text What the user typed; blank returns no places.
 * @throws Error when the geocoder answers with a failure status.
 */
export async function searchPlaces(text: string, signal?: AbortSignal): Promise<Place[]> {
  const query = text.trim();
  if (!query) return [];
  if (PROVIDER === 'photon') {
    const response = await fetch(`${BASE}?q=${encodeURIComponent(query)}&limit=10&lang=en`, signal ? { signal } : {});
    if (!response.ok) throw new Error(`geocoder ${response.status}`);
    const data = (await response.json()) as { features: PhotonFeature[] };
    return data.features.map((feature) => {
      const [lng, lat] = feature.geometry.coordinates;
      const extent = feature.properties.extent;
      return {
        name: feature.properties.name ?? query,
        ...((feature.properties.state || feature.properties.country) && {
          detail: [feature.properties.state, feature.properties.country].filter(Boolean).join(', '),
        }),
        lng,
        lat,
        // Photon extent is [minLon, maxLat, maxLon, minLat].
        ...(extent && { bbox: [extent[0], extent[3], extent[2], extent[1]] as [number, number, number, number] }),
      };
    });
  }
  const response = await fetch(`${BASE}?q=${encodeURIComponent(query)}&format=jsonv2&limit=10&accept-language=en`, {
    ...(signal && { signal }),
  });
  if (!response.ok) throw new Error(`geocoder ${response.status}`);
  const data = (await response.json()) as NominatimHit[];
  return data.map((hit) => {
    const [south, north, west, east] = (hit.boundingbox ?? []).map(Number);
    const parts = hit.display_name.split(', ');
    return {
      name: hit.name || parts[0] || query,
      detail: parts.slice(1).join(', '),
      lng: Number(hit.lon),
      lat: Number(hit.lat),
      ...([south, north, west, east].every((value) => Number.isFinite(value)) && {
        bbox: [west, south, east, north] as [number, number, number, number],
      }),
    };
  });
}
