/**
 * First-visit onboarding: whether the guided tour has been seen, and the
 * "Try this" checklist's progress. Both are remembered per browser. The
 * checklist ticks itself from the stores the real actions change, so a tick
 * always means the viewer did the thing.
 */
import { atom, computed } from 'nanostores';
import { $dateRange, $panel, $selectedHex } from './explorer';
import { $nearMode } from './near';
import { $ramp } from './ramp';
import { $treeFocus } from './tree';

const TOUR_KEY = 'tour-seen';
const PROGRESS_KEY = 'try-this';
const HIDDEN_KEY = 'try-this-hidden';
const STORED_TRUE = '1';

export const CHECKLIST = [
  { id: 'search', title: 'Find a species by name', hint: 'Search “puffin” and pick a result' },
  { id: 'hex', title: 'Click a hex', hint: 'See the species and records inside' },
  { id: 'when', title: 'Filter to a decade', hint: 'When, then drag the time slider' },
  { id: 'group', title: 'Narrow to one group', hint: 'What, then pick birds, fungi or similar' },
  { id: 'tree', title: 'Climb the tree of life', hint: 'Open Tree of life and drill down a rank' },
  { id: 'style', title: 'Make it yours', hint: 'Change the map colours or the theme' },
  { id: 'near', title: 'See what’s near you', hint: 'Near me, then use your location or a place' },
] as const;

export type ChecklistId = (typeof CHECKLIST)[number]['id'];

const CHECKLIST_IDS: readonly ChecklistId[] = CHECKLIST.map((item) => item.id);
const isBrowser = typeof window !== 'undefined';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage unavailable (private mode, blocked): treated as a first visit.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage unavailable: progress lasts for this page view only. */
  }
}

function savedProgress(): ChecklistId[] {
  try {
    const parsed: unknown = JSON.parse(read(PROGRESS_KEY) ?? '[]');
    return Array.isArray(parsed) ? CHECKLIST_IDS.filter((id) => parsed.includes(id)) : [];
  } catch {
    // A corrupt saved value: start the checklist afresh.
    return [];
  }
}

/** Whether this browser has finished or skipped the tour. */
export const $tourSeen = atom(isBrowser && read(TOUR_KEY) === STORED_TRUE);
/** The checklist item whose help is on screen, pointing at where to click. */
export const $checklistHint = atom<ChecklistId | null>(null);
/** True while the tour is on screen; its own map changes don't tick the checklist. */
export const $tourOpen = atom(false);
export const $checklistDone = atom<ChecklistId[]>(isBrowser ? savedProgress() : []);
export const $checklistHidden = atom(isBrowser && read(HIDDEN_KEY) === STORED_TRUE);
/**
 * True from the last item's tick until the finish is closed, so the list can
 * celebrate once; in memory only, so it also shows on return from another page.
 */
export const $checklistJustFinished = atom(false);

/** Whether the "Try this" list is on screen: after the tour, unless hidden, and until it is finished and closed. */
export const $checklistShown = computed(
  [$tourSeen, $tourOpen, $checklistHidden, $checklistDone, $checklistJustFinished],
  (tourSeen, tourOpen, isHidden, done, justFinished) =>
    tourSeen && !tourOpen && !isHidden && (done.length < CHECKLIST_IDS.length || justFinished),
);

/**
 * Tick a checklist item (once; ignored while the tour drives the page).
 * @param id The item the viewer just did.
 */
export function markDone(id: ChecklistId): void {
  const done = $checklistDone.get();
  if ($tourOpen.get() || done.includes(id)) return;
  const next = CHECKLIST_IDS.filter((itemId) => itemId === id || done.includes(itemId));
  $checklistDone.set(next);
  write(PROGRESS_KEY, JSON.stringify(next));
  if (next.length === CHECKLIST_IDS.length) $checklistJustFinished.set(true);
}

/** Close the tour for good (finished or skipped); the checklist takes over. */
export function finishTour(): void {
  $tourOpen.set(false);
  $tourSeen.set(true);
  write(TOUR_KEY, STORED_TRUE);
}

/** Show the tour again (from Settings), closing the phone filters sheet it would sit behind. */
export function restartTour(): void {
  try {
    localStorage.removeItem(TOUR_KEY);
  } catch {
    /* Storage unavailable: the tour shows again for this page view only. */
  }
  if ($panel.get() === 'filters') $panel.set('none');
  $tourSeen.set(false);
}

/** Bring a hidden checklist back (from Settings). */
export function showChecklist(): void {
  try {
    localStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* Storage unavailable: the checklist shows again for this page view only. */
  }
  $checklistHidden.set(false);
}

/** Start the checklist over (from Settings): nothing ticked, and shown again. */
export function resetChecklist(): void {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    /* Storage unavailable: the fresh list lasts for this page view only. */
  }
  $checklistDone.set([]);
  $checklistJustFinished.set(false);
  showChecklist();
}

/** Put the checklist away for good. */
export function hideChecklist(): void {
  $checklistHidden.set(true);
  write(HIDDEN_KEY, STORED_TRUE);
}

if (isBrowser) {
  $selectedHex.listen((hex) => hex && markDone('hex'));
  $dateRange.listen((range) => range && markDone('when'));
  $nearMode.listen((isNear) => isNear && markDone('near'));
  $treeFocus.listen((focus) => focus !== null && markDone('tree'));
  $ramp.listen(() => markDone('style'));
  document.addEventListener('themechange', () => markDone('style'));
}
