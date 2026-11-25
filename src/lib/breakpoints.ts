/**
 * The layout's breakpoints as media queries, for script. CSS uses the matching Tailwind
 * breakpoints: `sm` (40rem), `md` (48rem) and `rail` (`--breakpoint-rail`, 62.5rem) in global.css.
 */

/** Phones: the header shows the mark alone, the map collapses its attribution, the tree prefers the icicle. */
export const PHONE_QUERY = '(max-width: 639.98px)';

/** Below this width panels are bottom sheets (ResponsivePanel). */
export const SHEET_QUERY = '(max-width: 767.98px)';

/** From this width panels are side panels: the complement of SHEET_QUERY. */
export const SIDE_PANEL_QUERY = '(min-width: 768px)';

/** Below this width the filter rail is hidden and the filters live in the Filters sheet. */
export const NO_RAIL_QUERY = '(max-width: 999.98px)';
