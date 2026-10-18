import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const FULL = { lines: 100, statements: 100, functions: 100, branches: 100 };

export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Vue and Astro files are covered by the Playwright journeys, not measured here.
      include: ['src/**/*.ts', 'functions/**/*.ts', 'integrations/**/*.ts'],
      exclude: ['src/**/*.d.ts', '**/types.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: {
        // Floors a little under the current figures, so coverage cannot quietly slip.
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
        // The libraries, stores, endpoints and Pages Functions are fully covered.
        'src/lib/**': FULL,
        'src/stores/**': FULL,
        'src/pages/**': FULL,
        'functions/**': FULL,
      },
    },
  },
});
