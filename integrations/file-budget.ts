/** Fails the build when the site would break Cloudflare's free-plan limits, or static search has no files to read. */
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { fileBudgetProblems, type BuiltFile } from '../src/lib/name-search/budget';

/** Every file under `outDir`, by its path from the site root. */
async function builtFiles(outDir: string): Promise<BuiltFile[]> {
  const entries = await readdir(outDir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return Promise.all(
    files.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path: `/${relative(outDir, path)}`, bytes: (await stat(path)).size };
    }),
  );
}

/** Astro integration that checks the built files against the limits. */
export default function fileBudget(): AstroIntegration {
  return {
    name: 'taxonomap:file-budget',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const files = await builtFiles(fileURLToPath(dir));
        const problems = fileBudgetProblems(files);
        const hasSearchFiles = files.some((file) => file.path === '/search-data/manifest.json');
        if (process.env['PUBLIC_NAME_SEARCH'] === 'static' && !hasSearchFiles) {
          problems.push('PUBLIC_NAME_SEARCH=static, but there are no search files: run pnpm bake:names first');
        }
        if (problems.length) throw new Error(`File budget: ${problems.join('; ')}`);
        logger.info(`${files.length} files in the site`);
      },
    },
  };
}
