import type { Occurrence } from '~/lib/gbif';
import { aboutKey, accuracy, recordDate, recordScientificName, typeCode, typeLabel } from '~/lib/record-fields';

const record = (fields: Partial<Occurrence>) => ({ key: 1, ...fields }) as Occurrence;

describe('record fields', () => {
  it('links to the species, else the taxon the record was named to', () => {
    expect(aboutKey(record({ speciesKey: 5, acceptedTaxonKey: 6, taxonKey: 7 }))).toBe(5);
    expect(aboutKey(record({ acceptedTaxonKey: 6, taxonKey: 7 }))).toBe(6);
    expect(aboutKey(record({ taxonKey: 7 }))).toBe(7);
  });

  it('prefers the accepted species name', () => {
    expect(recordScientificName(record({ species: 'Vulpes vulpes', scientificName: 'Canis vulpes L.' }))).toBe(
      'Vulpes vulpes',
    );
    expect(recordScientificName(record({ scientificName: 'Canis vulpes L.' }))).toBe('Canis vulpes L.');
  });

  it('shows the event date, else the year', () => {
    expect(recordDate(record({ eventDate: '2024-05-06T10:00:00' }))).toBe('2024-05-06');
    expect(recordDate(record({ year: 1999 }))).toBe('1999');
    expect(recordDate(record({}))).toBeUndefined();
  });

  it('codes and labels the basis of record', () => {
    expect(typeCode(record({ basisOfRecord: 'FOSSIL_SPECIMEN' }))).toBe('FOS');
    expect(typeCode(record({}))).toBe('—');
    expect(typeLabel(record({}))).toBe('Unknown');
    expect(typeLabel(record({ basisOfRecord: 'HUMAN_OBSERVATION' }))).toBe('Human observation');
    expect(typeLabel(record({ basisOfRecord: 'NEW_BASIS' as NonNullable<Occurrence['basisOfRecord']> }))).toBe(
      'NEW_BASIS',
    );
  });

  it('notes when the observer blurred the point', () => {
    expect(accuracy(record({}))).toBe('');
    expect(accuracy(record({ coordinateUncertaintyInMeters: 100 }))).toBe('Within 100 m');
    expect(
      accuracy(
        record({
          coordinateUncertaintyInMeters: 100,
          informationWithheld: 'Coordinates obscured at the request of the observer',
        }),
      ),
    ).toBe('Within 100 m · blurred by observer');
  });
});
