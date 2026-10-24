/** Merge the coverage each worker added into one report, when coverage is on. */
import { MCR } from 'monocart-coverage-reports';
import { coverageOptions, isCoverageOn } from './coverage';

export default async function globalTeardown() {
  if (isCoverageOn) await MCR(coverageOptions).generate();
}
