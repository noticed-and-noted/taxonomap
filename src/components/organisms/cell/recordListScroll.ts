/**
 * Scrolling and view transitions for the cell's record list. The list scrolls inside a panel body
 * that scrolls too on phones, so "in view" means inside both.
 */

/** The part of the list on screen: the panel body, which scrolls too on phones, may hide either edge. */
function visibleBounds(box: HTMLElement) {
  const boxRect = box.getBoundingClientRect();
  const panelRect = box.parentElement?.closest<HTMLElement>('.overflow-y-auto')?.getBoundingClientRect();
  return {
    top: Math.max(boxRect.top, panelRect?.top ?? -Infinity),
    bottom: Math.min(boxRect.bottom, panelRect?.bottom ?? Infinity),
  };
}

/**
 * Scrolls only the list (not the panel) so `element` is in view: the row animation draws above the
 * list, unclipped, so its end point must be inside the list for it to stay inside.
 * @param box The list's scroll box.
 * @param element A details row; the record's own row just above it is kept in view too.
 */
export function revealInList(box: HTMLElement | undefined, element: HTMLElement | null) {
  if (!element || !box) return;
  const boxRect = box.getBoundingClientRect();
  const { bottom } = visibleBounds(box);
  const rowRect = element.getBoundingClientRect();
  // The record's own row sits just above its details; keep it in view even when the details don't fit.
  const top = (element.previousElementSibling ?? element).getBoundingClientRect().top;
  if (top < boxRect.top) box.scrollTop -= boxRect.top - top;
  else if (rowRect.bottom > bottom) box.scrollTop += Math.min(rowRect.bottom - bottom, top - boxRect.top);
}

/**
 * Clips the view-transition overlay to the list's on-screen box, so a row's moving photo and name can't draw over
 * the panel. The overlay sits above the whole page, out of reach of the list's own overflow.
 * @returns A function that removes the clip.
 */
function clipTransitionToList(box: HTMLElement | undefined) {
  if (!box) return () => {};
  const { left, right } = box.getBoundingClientRect();
  const { top, bottom } = visibleBounds(box);
  const root = document.documentElement;
  root.style.setProperty('--records-clip', `rect(${top}px ${right}px ${bottom}px ${left}px)`);
  root.classList.add('records-transition');
  return () => root.classList.remove('records-transition');
}

/**
 * Runs a DOM update as a view transition clipped to the list.
 * @param box The list's scroll box.
 * @param update Changes the DOM; the transition animates from before it to after.
 * @returns Resolves once the transition has finished and the clip is gone.
 */
export async function startListTransition(box: HTMLElement | undefined, update: () => Promise<void>) {
  const unclip = clipTransitionToList(box);
  try {
    await document.startViewTransition(update).finished;
  } finally {
    unclip();
  }
}
