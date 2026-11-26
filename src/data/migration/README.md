# Migration data

Whether a species migrates, matched once to GBIF backbone keys and kept in the repo. It changes rarely, so it isn't fetched or baked: the app reads `migration.json` as a static file. Nothing reads it yet; it's for the Analyse picker's "Migrates" tag.

| File                | Holds                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| `migration.json`    | The lookup the app uses: GBIF taxon key → status, for 3,056 species                    |
| `eol-migration.csv` | Where each entry came from: the EOL name and page, the GBIF key it matched, the source |

## Statuses

| Status          | Meaning                                                   | Species |
| --------------- | --------------------------------------------------------- | ------- |
| `migratory`     | Moves regularly between regions or habitats               | 788     |
| `nonmigratory`  | Doesn't make seasonal journeys                            | 1,943   |
| `partial`       | Sources disagree, or some populations migrate             | 108     |
| `oceanodromous` | Fish that migrate within the sea                          | 174     |
| `amphidromous`  | Fish that move between fresh and salt water, not to breed | 25      |
| `anadromous`    | Fish that live at sea and breed in fresh water (salmon)   | 11      |
| `catadromous`   | Fish that live in fresh water and breed at sea (eels)     | 7       |

When a species has several values, a fish pattern wins, then "migratory" plus "nonmigratory" becomes `partial`.

## Where it came from

- **Archive**: the Encyclopedia of Life's "All trait data", `traits_all.zip`, on Zenodo: https://zenodo.org/records/13305577 (published 2024-08-12; files dated 2024-02-09). Open access, no key; the record states no licence.
- **Rows kept**: traits whose value is EOL's `migratory` or `nonmigratory`, Polytraits' `MIGR_YES` or `MIGR_NO`, or one of the fish patterns. Only `traits.csv`, not `inferred.csv` (traits EOL copies down to lower taxa).
- **Rows dropped**: "diel vertical migration" (a daily up and down in the water, not a seasonal journey) and 24 fern records that use a fish term for something else.
- **Matching**: each name went through GBIF's `species/match` once (strict), keeping exact or fuzzy matches at 90% confidence or more, at species or subspecies rank, and storing the accepted key. 3,056 of 3,078 matched; the 22 left are genera and families (mostly marine worms) and one monkey whose name GBIF now treats as a synonym of a genus.

| Source       | EOL resource | Records | What it is                                                         |
| ------------ | ------------ | ------- | ------------------------------------------------------------------ |
| `ADW`        | 427          | 1,918   | Animal Diversity Web, University of Michigan (animaldiversity.org) |
| `Sibly2012`  | 482          | 823     | Sibly et al. 2012, PNAS supplementary data (birds)                 |
| `EOL-fish`   | 754          | 668     | Fish records with no source given in the export                    |
| `Polytraits` | 406          | 56      | Polytraits, marine bristle worms (polytraits.lifewatchgreece.eu)   |

## Before shipping it

- **Licences are not confirmed.** The export doesn't carry them per record. Check each source's terms; Animal Diversity Web's content is published for non-commercial use. Credit the sources on the data credits.
- **Gaps**: the monarch, painted lady and Arctic tern aren't in it. AVONET (every bird) can be matched the same way and merged in; species with no entry get no tag.
- Nothing a visitor does is sent to EOL or Zenodo; GBIF's matcher was called once, while preparing the file.

## Redoing it

Download `traits_all.zip` from the record above. Stream `trait_bank/traits.csv` through `unzip -p` (Python's `zipfile` rejects its checksum), keep the values above, drop resources 34 and 822, strip HTML from the names, and group by name and page id. Then match each name with `https://api.gbif.org/v1/species/match?strict=true&name=…` under the rules above.
