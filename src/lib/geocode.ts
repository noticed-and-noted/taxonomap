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

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const query = q.trim();
  if (!query) return [];
  if (PROVIDER === 'photon') {
    const res = await fetch(`${BASE}?q=${encodeURIComponent(query)}&limit=5&lang=en`, signal ? { signal } : {});
    if (!res.ok) throw new Error(`geocoder ${res.status}`);
    const data = (await res.json()) as { features: PhotonFeature[] };
    return data.features.map((f) => {
      const [lng, lat] = f.geometry.coordinates;
      const e = f.properties.extent;
      return {
        name: f.properties.name ?? query,
        ...((f.properties.state || f.properties.country) && {
          detail: [f.properties.state, f.properties.country].filter(Boolean).join(', '),
        }),
        lng,
        lat,
        // Photon extent is [minLon, maxLat, maxLon, minLat].
        ...(e && { bbox: [e[0], e[3], e[2], e[1]] as [number, number, number, number] }),
      };
    });
  }
  const res = await fetch(`${BASE}?q=${encodeURIComponent(query)}&format=jsonv2&limit=5&accept-language=en`, {
    ...(signal && { signal }),
  });
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  const data = (await res.json()) as NominatimHit[];
  return data.map((h) => {
    const [s, n, w, e] = (h.boundingbox ?? []).map(Number);
    const parts = h.display_name.split(', ');
    return {
      name: h.name || parts[0] || query,
      detail: parts.slice(1).join(', '),
      lng: Number(h.lon),
      lat: Number(h.lat),
      ...([s, n, w, e].every((v) => Number.isFinite(v)) && {
        bbox: [w, s, e, n] as [number, number, number, number],
      }),
    };
  });
}
