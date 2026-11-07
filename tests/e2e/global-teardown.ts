/** Merge the coverage each worker added into one report, when coverage is on, and hold it to the floors. */
import { readFile } from 'node:fs/promises';
import { MCR } from 'monocart-coverage-reports';
import { COVERAGE_FLOORS, coverageOptions, isCoverageOn, isFloorChecked } from './coverage';

type Metric = keyof typeof COVERAGE_FLOORS;

export default async function globalTeardown() {
  if (!isCoverageOn) return;
  await MCR(coverageOptions).generate();
  if (!isFloorChecked) return;
  const summary = JSON.parse(await readFile(`${coverageOptions.outputDir}/coverage-summary.json`, 'utf8')) as {
    total: Record<Metric, { pct: number }>;
  };
  const short = (Object.keys(COVERAGE_FLOORS) as Metric[]).filter(
    (metric) => summary.total[metric].pct < COVERAGE_FLOORS[metric],
  );
  if (short.length) {
    const detail = short.map((metric) => `${metric} ${summary.total[metric].pct}% < ${COVERAGE_FLOORS[metric]}%`);
    throw new Error(`E2E coverage fell below its floor: ${detail.join(', ')}`);
  }
}
