/** A species' sounds: only openly licensed files, capped, named by country and never by the observer's place text. */
import type { InatSoundObservation } from '~/lib/photos/inat';

const SPAIN_ID = 6774;
const EUROPE_ID = 97391;
const GRIFFON_KEY = 2480389;
const GRIFFON_INAT_ID = 4772;

const resolveInatIds = vi.hoisted(() => vi.fn());
const soundObservations = vi.hoisted(() => vi.fn());
const countryNames = vi.hoisted(() => vi.fn());

vi.mock('~/lib/photos/taxon-photos', () => ({ resolveInatIds }));
vi.mock('~/lib/photos/inat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/photos/inat')>()),
  soundObservations,
  countryNames,
}));

const recording = (id: number, license_code: string | null = 'cc-by'): InatSoundObservation => ({
  id,
  uri: `https://www.inaturalist.org/observations/${id}`,
  place_ids: [EUROPE_ID, SPAIN_ID],
  sounds: [
    {
      file_url: `https://static.inaturalist.org/sounds/${id}.m4a`,
      license_code,
      attribution: `(c) Person ${id}, some rights reserved (CC BY)`,
    },
  ],
});

const griffon = { key: GRIFFON_KEY, rank: 'SPECIES' } as const;

beforeEach(() => {
  resolveInatIds.mockResolvedValue(new Map([[GRIFFON_KEY, GRIFFON_INAT_ID]]));
  countryNames.mockResolvedValue(new Map([[SPAIN_ID, 'Spain']]));
});

afterEach(() => vi.resetAllMocks());

describe('taxonSounds', () => {
  it('credits each recording and names only its country', async () => {
    soundObservations.mockResolvedValue([recording(1)]);
    const { taxonSounds } = await import('~/lib/photos/taxon-sounds');
    expect(await taxonSounds(griffon)).toEqual([
      {
        url: 'https://static.inaturalist.org/sounds/1.m4a',
        licence: 'CC-BY',
        creator: 'Person 1',
        observationUrl: 'https://www.inaturalist.org/observations/1',
        country: 'Spain',
      },
    ]);
  });

  it('skips closed licences and missing files, then caps what is left', async () => {
    const hidden = { ...recording(2), sounds: [{ file_url: null, license_code: 'cc-by' }] };
    soundObservations.mockResolvedValue([
      recording(1, null),
      hidden,
      recording(3),
      recording(4),
      recording(5),
      recording(6),
      recording(7),
    ]);
    const { MAX_SOUNDS, taxonSounds } = await import('~/lib/photos/taxon-sounds');
    const sounds = await taxonSounds(griffon);
    expect(sounds).toHaveLength(MAX_SOUNDS);
    expect(sounds[0]?.creator).toBe('Person 3');
  });

  it('keeps the recordings when the country lookup fails', async () => {
    soundObservations.mockResolvedValue([recording(1)]);
    countryNames.mockRejectedValue(new Error('down'));
    const { taxonSounds } = await import('~/lib/photos/taxon-sounds');
    const [sound] = await taxonSounds(griffon);
    expect(sound?.url).toContain('1.m4a');
    expect(sound?.country).toBeUndefined();
  });

  it('asks for nothing above species rank or without an iNaturalist match', async () => {
    const { taxonSounds } = await import('~/lib/photos/taxon-sounds');
    expect(await taxonSounds({ key: GRIFFON_KEY, rank: 'GENUS' })).toEqual([]);
    resolveInatIds.mockResolvedValue(new Map());
    expect(await taxonSounds(griffon)).toEqual([]);
    expect(soundObservations).not.toHaveBeenCalled();
  });
});
