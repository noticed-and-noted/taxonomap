/** Merge the coverage each worker added into one report, when coverage is on, and hold it to the floors. */
import { MCR } from 'monocart-coverage-reports';
import { assertCoverageFloors, coverageOptions, isCoverageOn, isFloorChecked } from './coverage';

export default async function globalTeardown() {
  if (!isCoverageOn) return;
  await MCR(coverageOptions).generate();
  if (isFloorChecked) await assertCoverageFloors();
}
