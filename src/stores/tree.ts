/** Tree-of-life UI state (URL-synced; `taxon` is shared via explorer.ts). */
import { codecs, urlAtom } from './url-sync';

/** Focused (zoomed) node; 0 = all life. */
export const $treeFocus = urlAtom(codecs.int('focus', null));
export const $treeLayout = urlAtom(
  codecs.enumOf('layout', ['auto', 'sunburst', 'icicle'] as const, 'auto', { history: 'replace' }),
);
export const $treeMetric = urlAtom(
  codecs.enumOf('metric', ['records', 'species'] as const, 'records', { history: 'replace' }),
);
/** Count only records inside the current map view. */
export const $treeScope = urlAtom(codecs.bool('scope', { history: 'replace' }));
