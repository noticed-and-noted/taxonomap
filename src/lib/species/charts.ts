/** Chart inputs for a species page, shared by the static page and the fallback. */
import { countryName } from '~/lib/format';
import type { SpeciesData } from './data';

export interface PlotBar {
  label: string;
  value: number;
  href?: string;
}

export function speciesCharts(d: SpeciesData): { countries: PlotBar[]; datasets: PlotBar[] } {
  return {
    countries: d.countries.map(([c, v]) => ({ label: countryName(c), value: v })),
    datasets: d.datasets.map((ds) => ({
      label: ds.title,
      value: ds.count,
      href: `https://www.gbif.org/dataset/${ds.key}`,
    })),
  };
}
