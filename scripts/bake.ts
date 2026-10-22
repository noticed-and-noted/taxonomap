/** Fetch the data the build bakes into the site and save it to .cache/baked: `pnpm bake`. */
import { bakeToDisk, lookupProgress } from '~/lib/bake';

const BAR_WIDTH = 30;
const REDRAW_MS = 200;

let step = '';

/** One line: the snapshot being baked and how many of its queued GBIF lookups are done. */
function progressLine(): string {
  const { queued, done } = lookupProgress;
  const filled = queued ? Math.round((done / queued) * BAR_WIDTH) : 0;
  return `[${'#'.repeat(filled)}${'-'.repeat(BAR_WIDTH - filled)}] ${done}/${queued} lookups · ${step}`;
}

/** Redraws the bar in place on a terminal; piped output gets one line per snapshot instead. */
function draw(): void {
  if (process.stdout.isTTY) process.stdout.write(`\r${progressLine()}\x1b[K`);
}

const timer = setInterval(draw, REDRAW_MS);
try {
  const saved = await bakeToDisk((key) => {
    step = key;
    if (!process.stdout.isTTY) console.log(`Baking ${key}…`);
  });
  draw();
  if (process.stdout.isTTY) process.stdout.write('\n');
  console.log('Baked:', saved.join(', '));
} finally {
  clearInterval(timer);
}
