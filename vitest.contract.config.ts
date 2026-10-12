import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Live GBIF contract tests. Excluded from default CI; run with `npm run test:contract`. */
export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/contract/**/*.test.ts'],
    testTimeout: 30_000,
    // Be polite to GBIF: one file at a time.
    fileParallelism: false,
  },
});
