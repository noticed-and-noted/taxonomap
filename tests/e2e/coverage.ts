/**
 * Coverage of the journeys (`pnpm test:e2e:coverage`): every page's V8 JS
 * coverage, mapped back to src/ through the e2e build's sourcemaps. Off unless
 * E2E_COVERAGE is set, so ordinary runs pay nothing.
 */
import type { CoverageReportOptions } from 'monocart-coverage-reports';

export const isCoverageOn = Boolean(process.env['E2E_COVERAGE']);

export const coverageOptions: CoverageReportOptions = {
  name: 'Taxonomap journeys',
  outputDir: 'coverage/e2e',
  reports: ['console-summary', 'v8', 'lcovonly', 'json-summary'],
  // Only the site's own bundles, and only our sources inside them (bundles without a sourcemap drop out too).
  entryFilter: (entry) => entry.url.includes('/_astro/'),
  outputFilter: (file) => file.sourcePath.startsWith('src/'),
};
