import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
// Locally, PW_CHANNEL=chrome uses the installed Google Chrome instead of a
// downloaded Chromium build; CI installs Playwright's own browser.
const channel = process.env['PW_CHANNEL'];

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Journeys hit the live GBIF API; allow for its latency under parallel load.
  expect: { timeout: 10_000 },
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...(channel && { channel }) } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...(channel && { channel }) } },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env['CI'],
  },
});
