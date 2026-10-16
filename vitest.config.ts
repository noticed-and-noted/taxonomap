import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Vue and Astro files are covered by the Playwright journeys, not measured here.
      include: ['src/**/*.ts', 'worker/src/**/*.ts', 'functions/**/*.ts', 'integrations/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/lib/data/types.ts', 'src/lib/gbif/types.ts'],
      reporter: ['text-summary', 'html'],
      // Floors a little under the current figures, so coverage cannot quietly slip.
      thresholds: { lines: 80, statements: 78, functions: 75, branches: 70 },
    },
  },
});
