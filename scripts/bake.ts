/** Fetch the data the build bakes into the site and save it to .cache/baked: `pnpm bake`. */
import { bakeToDisk } from '~/lib/bake';

console.log('Baked:', (await bakeToDisk()).join(', '));
