import { describe, expect, it } from 'vitest';
import { INATURALIST_DATASET_KEY, type Occurrence } from '~/lib/gbif';
import { recordPlace } from '~/lib/map/recordPlace';

const BLURRED = 'Coordinate uncertainty increased to 27443m at the request of the observer';
const POINT: GeoJSON.Point = { type: 'Point', coordinates: [-79.33288, 43.75468] };
const SQUARE_WKT = 'POLYGON ((-79.4 43.7, -79.3 43.7, -79.3 43.8, -79.4 43.8, -79.4 43.7))';

const record = (fields: Partial<Occurrence>) =>
  ({ key: 1, datasetKey: 'other', decimalLongitude: -79.33288, decimalLatitude: 43.75468, ...fields }) as Occurrence;

/** The record's area's outer ring, rounded to 6 places for comparing. */
const outerRing = (fields: Partial<Occurrence>) =>
  (recordPlace(record(fields))!.area as GeoJSON.Polygon).coordinates[0]!.map((position) =>
    position.map((degrees) => Number(degrees.toFixed(6))),
  );

describe('recordPlace', () => {
  it('is the point alone for a record with no uncertainty or footprint', () => {
    expect(recordPlace(record({}))).toEqual({ point: POINT, area: null });
  });

  it('is nothing without coordinates', () => {
    const { decimalLatitude: _latitude, ...noLatitude } = record({});
    expect(recordPlace(noLatitude as Occurrence)).toBeNull();
  });

  it('is the 0.2° square an obscured iNaturalist record was hidden in, without its random point', () => {
    const place = recordPlace(record({ datasetKey: INATURALIST_DATASET_KEY, informationWithheld: BLURRED }));
    expect(place?.point).toBeNull();
    const ring = outerRing({ datasetKey: INATURALIST_DATASET_KEY, informationWithheld: BLURRED });
    expect([...ring[0]!, ...ring[2]!]).toEqual([-79.4, 43.6, -79.2, 43.8]);
  });

  it('prefers the obscured square to a footprint or uncertainty', () => {
    const fields = { datasetKey: INATURALIST_DATASET_KEY, informationWithheld: BLURRED, footprintWKT: SQUARE_WKT };
    expect(outerRing(fields)[0]).toEqual([-79.4, 43.6]);
  });

  it('keeps the point when another dataset withholds information', () => {
    expect(recordPlace(record({ informationWithheld: BLURRED }))?.point).toEqual(POINT);
  });

  it('keeps the point for an iNaturalist record that withholds nothing', () => {
    expect(recordPlace(record({ datasetKey: INATURALIST_DATASET_KEY }))?.point).toEqual(POINT);
  });

  it('draws the uncertainty circle around the point', () => {
    const place = recordPlace(record({ coordinateUncertaintyInMeters: 1000 }));
    expect(place?.point).toEqual(POINT);
    const northmost = Math.max(...outerRing({ coordinateUncertaintyInMeters: 1000 }).map(([, lat]) => lat!));
    expect(northmost).toBeCloseTo(43.75468 + 1 / 110.574, 5);
  });

  it('leaves out an uncertainty circle the dot would cover', () => {
    expect(recordPlace(record({ coordinateUncertaintyInMeters: 30 }))?.area).toBeNull();
  });

  it('prefers the footprint to the uncertainty circle', () => {
    expect(outerRing({ footprintWKT: SQUARE_WKT, coordinateUncertaintyInMeters: 1000 })).toEqual([
      [-79.4, 43.7],
      [-79.3, 43.7],
      [-79.3, 43.8],
      [-79.4, 43.8],
      [-79.4, 43.7],
    ]);
  });

  it('reads a multipolygon footprint, dropping heights', () => {
    const footprintWKT = 'MULTIPOLYGON (((0 0 5, 1 0 5, 1 1 5, 0 0 5)), ((2 2, 3 2, 3 3, 2 2)))';
    const area = recordPlace(record({ footprintWKT }))?.area as GeoJSON.MultiPolygon;
    expect(area.type).toBe('MultiPolygon');
    expect(area.coordinates[1]![0]![1]).toEqual([3, 2]);
  });

  it('reads a footprint tagged with heights or measures', () => {
    for (const tag of ['Z', 'M', 'ZM']) {
      const wkt = `POLYGON ${tag} ((-79.4 43.7 1, -79.3 43.7 1, -79.3 43.8 1, -79.4 43.8 1, -79.4 43.7 1))`;
      expect(recordPlace(record({ footprintWKT: wkt }))?.area?.type).toBe('Polygon');
    }
  });

  it('accepts a footprint in WGS84 however its system is named', () => {
    const systems = [
      'EPSG:4326',
      'urn:ogc:def:crs:EPSG::4326',
      'GEOGCS["WGS 84",DATUM["WGS_1984"]]',
      'EPSG:4258',
      'EPSG:4269',
      'GEOGCS["ETRS89"]',
    ];
    for (const footprintSRS of systems)
      expect(recordPlace(record({ footprintWKT: SQUARE_WKT, footprintSRS }))?.area?.type).toBe('Polygon');
  });

  it('falls back to the circle for a footprint it cannot place', () => {
    const fallsBack = (fields: Partial<Occurrence>) =>
      recordPlace(record({ coordinateUncertaintyInMeters: 1000, ...fields }))?.area?.coordinates[0]?.length;
    const circleLength = fallsBack({});
    expect(fallsBack({ footprintWKT: SQUARE_WKT, footprintSRS: 'EPSG:27700' })).toBe(circleLength);
    expect(fallsBack({ footprintWKT: SQUARE_WKT, footprintSRS: 'PROJCS["WGS 84 / UTM zone 30N"]' })).toBe(circleLength);
    expect(fallsBack({ footprintWKT: 'POLYGON ((400000 100000, 410000 100000, 410000 110000, 400000 100000))' })).toBe(
      circleLength,
    );
    expect(fallsBack({ footprintWKT: 'POLYGON ((0 0, 1 0, 1 1' })).toBe(circleLength);
    expect(fallsBack({ footprintWKT: 'LINESTRING (0 0, 1 1)' })).toBe(circleLength);
    expect(fallsBack({ footprintWKT: 'POLYGON ((0 0, 1 0) 1 1, 0 0))' })).toBe(circleLength);
    expect(fallsBack({ footprintWKT: 'POLYGON ((0 0, 1 0, 1 1, 5))' })).toBe(circleLength);
    expect(fallsBack({ footprintWKT: 'MULTIPOLYGON (((0 0, 1 1)))' })).toBe(circleLength);
  });
});
