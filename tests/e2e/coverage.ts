/**
 * Coverage of the journeys (`pnpm test:e2e:coverage`): every page's V8 JS
 * coverage, mapped back to src/ through the e2e build's sourcemaps. Off unless
 * E2E_COVERAGE is set, so ordinary runs pay nothing.
 *
 * Only components (.vue, .astro) are measured: the unit tests hold every .ts file at
 * 100%, and reaching the same failure and race paths through a browser would need far
 * more journeys for no extra safety.
 */
import type { Page } from '@playwright/test';
import type { CoverageReportOptions, V8CoverageEntry } from 'monocart-coverage-reports';

export const isCoverageOn = Boolean(process.env['E2E_COVERAGE']);

/** `E2E_COVERAGE=report` reports without the floors, for a run of only some journeys. */
export const isFloorChecked = process.env['E2E_COVERAGE'] !== 'report';

/**
 * The least each figure may be. Every line of every component runs in some journey; the
 * functions and branches left are mostly template handlers, unmount hooks and timers that
 * would each need a journey of their own. Raise these as journeys cover more, never lower them.
 */
export const COVERAGE_FLOORS = { lines: 100, statements: 97, functions: 94, branches: 82 };

export const coverageOptions: CoverageReportOptions = {
  name: 'Taxonomap journeys',
  outputDir: 'coverage/e2e',
  reports: ['console-summary', 'v8', 'lcovonly', 'json-summary'],
  // Only the site's own bundles, and only our sources inside them (bundles without a sourcemap drop out too).
  entryFilter: (entry) => entry.url.includes('/_astro/'),
  outputFilter: (file) => file.sourcePath.startsWith('src/') && /\.(vue|astro)$/.test(file.sourcePath),
};

/**
 * Records a page's JS coverage. V8 drops a document's counts once another replaces it, so
 * `snapshot` is called before each page load to keep what has run so far.
 * @returns `snapshot`, and `finish` to take the last one and hand over everything gathered.
 */
export async function startCoverage(page: Page) {
  const start = () => page.coverage.startJSCoverage({ resetOnNavigation: false });
  const entries: V8CoverageEntry[] = [];
  await start();

  /** Keeps the counts so far and starts counting afresh. */
  async function snapshot() {
    entries.push(...((await page.coverage.stopJSCoverage()) as V8CoverageEntry[]));
    await start();
  }

  /** Takes the last snapshot. @returns Every entry gathered, ready for MCR. */
  async function finish() {
    entries.push(...((await page.coverage.stopJSCoverage()) as V8CoverageEntry[]));
    return entries;
  }

  return { snapshot, finish };
}
