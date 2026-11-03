import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Where a run keeps what it needs to resume. Outside `public/`, so none of it ships. */
const CHECKPOINT_DIR = '.cache/name-search';

/** What a run saved as `name`, or `fallback` when it hasn't yet. */
export async function readCheckpoint<Saved>(name: string, fallback: Saved): Promise<Saved> {
  try {
    return JSON.parse(await readFile(join(CHECKPOINT_DIR, `${name}.json`), 'utf8')) as Saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

/** Saves `content` as `name` for a later run. */
export async function writeCheckpoint(name: string, content: unknown): Promise<void> {
  const file = join(CHECKPOINT_DIR, `${name}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(content));
}
