import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
// Locally, PW_CHANNEL=chrome uses the installed Google Chrome, or PW_CHROMIUM a
// Chromium binary, instead of Playwright's own download; CI installs Playwright's.
const channel = process.env['PW_CHANNEL'];
const executablePath = process.env['PW_CHROMIUM'];
const browser = { ...(channel && { channel }), ...(executablePath && { launchOptions: { executablePath } }) };

export default defineConfig({
  testDir: 'tests/e2e',
  // The site must be built against the fake world first: `npm run build:e2e`.
  globalSetup: './tests/e2e/global-setup.ts',
  // Journeys are CPU-bound (software WebGL), not network-bound: the default of half the cores as workers is the fastest.
  fullyParallel: true,
  // Map pages render WebGL in software on CI runners; give a busy machine room. Passing checks don't wait for it.
  expect: { timeout: 10_000 },
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Recording a trace costs every test; record one only when a failure is retried.
    trace: 'on-first-retry',
    // A service worker would carry its caches from page to page; only the offline journey needs one.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...browser } },
    // Phones run only the journeys whose layout differs there (tagged @mobile).
    { name: 'mobile', grep: /@mobile/, use: { ...devices['Pixel 7'], ...browser } },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env['CI'],
  },
});
