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

/** The list's on-screen box, as left, top, right and bottom. */
function listBox(box: HTMLElement) {
  const { left, right } = box.getBoundingClientRect();
  const { top, bottom } = visibleBounds(box);
  return { left, top, right, bottom };
}

/**
 * Clips the view-transition overlay to the list's on-screen box, so a row's moving photo and name can't draw over
 * the panel. The overlay sits above the whole page, out of reach of the list's own overflow.
 */
function clipTransitionTo({ left, top, right, bottom }: ReturnType<typeof listBox>) {
  const root = document.documentElement;
  root.style.setProperty('--records-clip', `rect(${top}px ${right}px ${bottom}px ${left}px)`);
  root.classList.add('records-transition');
}

/**
 * Runs a DOM update as a view transition clipped to the list.
 * @param box The list's scroll box.
 * @param update Changes the DOM; the transition animates from before it to after.
 * @returns Resolves once the transition has finished and the clip is gone.
 */
export async function startListTransition(box: HTMLElement | undefined, update: () => Promise<void>) {
  const before = box && listBox(box);
  if (before) clipTransitionTo(before);
  // A short list grows or shrinks as a row opens or closes, so the clip covers the list both before and after.
  const updateAndWiden = async () => {
    await update();
    if (!box || !before) return;
    const after = listBox(box);
    clipTransitionTo({
      left: Math.min(before.left, after.left),
      top: Math.min(before.top, after.top),
      right: Math.max(before.right, after.right),
      bottom: Math.max(before.bottom, after.bottom),
    });
  };
  try {
    await document.startViewTransition(updateAndWiden).finished;
  } finally {
    document.documentElement.classList.remove('records-transition');
  }
}
