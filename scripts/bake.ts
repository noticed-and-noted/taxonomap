/** Fetch the data the build bakes into the site and save it to .cache/baked: `pnpm bake`. */
import { bakeProgress, bakeToDisk } from '~/lib/bake';

const BAR_WIDTH = 30;
const REDRAW_MS = 200;

let step = '';

/** The counter the bar follows: the first service with requests still running, else the last one. */
function activeCounter(): { queued: number; done: number } {
  const counters = [...bakeProgress.values()];
  return counters.find((counter) => counter.done < counter.queued) ?? counters.at(-1) ?? { queued: 0, done: 0 };
}

/** One line: the snapshot being baked and each service's finished and queued requests. */
function progressLine(): string {
  const { queued, done } = activeCounter();
  const filled = queued ? Math.round((done / queued) * BAR_WIDTH) : 0;
  const counts = [...bakeProgress].map(([service, counter]) => `${service} ${counter.done}/${counter.queued}`);
  return `[${'#'.repeat(filled)}${'-'.repeat(BAR_WIDTH - filled)}] ${[...counts, step].join(' · ')}`;
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
