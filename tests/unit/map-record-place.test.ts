import { describe, expect, it } from 'vitest';
import { INATURALIST_DATASET_KEY, type Occurrence } from '~/lib/gbif';
import { recordPlace } from '~/lib/map/recordPlace';

const BLURRED = 'Coordinate uncertainty increased to 27443m at the request of the observer';

const record = (fields: Partial<Occurrence>) =>
  ({ key: 1, datasetKey: 'other', decimalLongitude: -79.33288, decimalLatitude: 43.75468, ...fields }) as Occurrence;

describe('recordPlace', () => {
  it('is the point for an ordinary record', () => {
    expect(recordPlace(record({}))).toEqual({ type: 'Point', coordinates: [-79.33288, 43.75468] });
  });

  it('is nothing without coordinates', () => {
    const { decimalLatitude: _latitude, ...noLatitude } = record({});
    expect(recordPlace(noLatitude as Occurrence)).toBeNull();
  });

  it('is the 0.2° square an obscured iNaturalist record was hidden in', () => {
    const place = recordPlace(record({ datasetKey: INATURALIST_DATASET_KEY, informationWithheld: BLURRED }));
    expect(place?.type).toBe('Polygon');
    const ring = (place as GeoJSON.Polygon).coordinates[0]!;
    const [west, south] = ring[0]!;
    const [east, north] = ring[2]!;
    expect([west, south, east, north].map((degrees) => Number(degrees!.toFixed(6)))).toEqual([
      -79.4, 43.6, -79.2, 43.8,
    ]);
  });

  it('keeps the point when another dataset withholds information', () => {
    expect(recordPlace(record({ informationWithheld: BLURRED }))?.type).toBe('Point');
  });
});
