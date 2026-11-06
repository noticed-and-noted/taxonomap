import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const FULL = { lines: 100, statements: 100, functions: 100, branches: 100 };

export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Never read the data a local `pnpm bake` left behind.
    env: { BAKE_DIR: '.cache/unit-tests-bake-nothing' },
    coverage: {
      provider: 'v8',
      // Vue and Astro files are covered by the Playwright journeys, not measured here.
      include: ['src/**/*.ts', 'integrations/**/*.ts'],
      exclude: ['src/**/*.d.ts', '**/types.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
      // Every measured file is fully covered, so any untested line fails the run.
      thresholds: FULL,
    },
  },
});
