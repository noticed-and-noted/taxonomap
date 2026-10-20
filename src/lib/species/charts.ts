/** Chart inputs for a species page, shared by the static page and the fallback. */
import { countryName } from '~/lib/format';
import type { SpeciesData } from './data';

export interface PlotBar {
  label: string;
  value: number;
  href?: string;
}

/** Bar-chart data for a species page: top countries and datasets. */
export function speciesCharts(speciesData: SpeciesData): { countries: PlotBar[]; datasets: PlotBar[] } {
  return {
    countries: speciesData.countries.map(([code, count]) => ({ label: countryName(code), value: count })),
    datasets: speciesData.datasets.map((dataset) => ({
      label: dataset.title,
      value: dataset.count,
      href: `https://www.gbif.org/dataset/${dataset.key}`,
    })),
  };
}
