/**
 * The journeys' `test`: every request that leaves the site is answered by the
 * fake world (fake/world.ts) or refused, so no journey depends on GBIF,
 * iNaturalist or the basemaps being up, or on what they hold today. The site
 * is built against the same fake (`pnpm build:e2e`).
 */
import { test as base, expect } from '@playwright/test';
import { MCR } from 'monocart-coverage-reports';
import { coverageOptions, isCoverageOn } from './coverage';
import { answer } from './fake/world';

export const test = base.extend<{ external: string[]; showTour: boolean; seenTour: void; coverage: void }>({
  coverage: [
    async ({ page }, use, testInfo) => {
      if (!isCoverageOn) return use();
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await use();
      const scripts = await page.coverage.stopJSCoverage();
      // A test that skips itself has nothing to add, and MCR refuses an empty list.
      if (testInfo.status !== 'skipped') await MCR(coverageOptions).add(scripts);
    },
    { auto: true },
  ],
  // A fresh browser gets the onboarding tour, which covers the page; journeys skip it unless they test it.
  showTour: [false, { option: true }],
  seenTour: [
    async ({ context, showTour }, use) => {
      if (!showTour) await context.addInitScript(() => localStorage.setItem('tour-seen', '1'));
      await use();
    },
    { auto: true },
  ],
  // Auto: every journey gets it. Tests can read `external` to see what was refused.
  external: [
    async ({ context, baseURL }, use) => {
      const site = new URL(baseURL!).origin;
      /** Requests nothing here answers: refused, and listed for the test to check. */
      const refused: string[] = [];
      await context.route(
        (url) => url.origin !== site,
        async (route) => {
          const url = new URL(route.request().url());
          const out = answer(url);
          if (!out) {
            refused.push(url.href);
            return route.abort('blockedbyclient');
          }
          const body = Buffer.from(out.body);
          const cors = { 'access-control-allow-origin': '*' };
          // Media players ask for byte ranges, and Chrome only lets a sound seek when they're honoured.
          const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers()['range'] ?? '');
          if (!range || out.status !== 200) {
            return route.fulfill({ status: out.status, contentType: out.contentType, body, headers: cors });
          }
          const start = Number(range[1]);
          const end = range[2] ? Number(range[2]) : body.length - 1;
          return route.fulfill({
            status: 206,
            contentType: out.contentType,
            body: body.subarray(start, end + 1),
            headers: { ...cors, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}` },
          });
        },
      );
      await use(refused);
      // A request the fake does not know is a gap in the fake (or a new dependency): fail rather than pass by luck.
      expect(refused, 'requests off the site that the fake world does not answer').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
