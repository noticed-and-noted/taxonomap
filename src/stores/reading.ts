/**
 * Reading and display preferences (accessibility settings), remembered per
 * browser. Each one is written onto <html> as a data attribute that
 * global.css styles. An inline script in BaseLayout.astro applies the saved
 * values before first paint and on each client-side swap, so it must read the
 * same key and attribute names as this file.
 */
import { atom } from 'nanostores';

export const READING_KEY = 'reading';

export const TEXT_SIZES = [
  { id: 'normal', label: 'A', name: 'Normal' },
  { id: 'large', label: 'A+', name: 'Large' },
  { id: 'larger', label: 'A++', name: 'Larger' },
] as const;

export type TextSize = (typeof TEXT_SIZES)[number]['id'];

export interface ReadingPrefs {
  textSize: TextSize;
  noItalics: boolean;
  wideSpacing: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_READING: ReadingPrefs = {
  textSize: 'normal',
  noItalics: false,
  wideSpacing: false,
  reduceMotion: false,
};

function saved(): ReadingPrefs {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(READING_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_READING;
    const stored = parsed as Partial<ReadingPrefs>;
    return {
      textSize: TEXT_SIZES.some((size) => size.id === stored.textSize) ? (stored.textSize as TextSize) : 'normal',
      noItalics: stored.noItalics === true,
      wideSpacing: stored.wideSpacing === true,
      reduceMotion: stored.reduceMotion === true,
    };
  } catch {
    // Storage blocked or a corrupt value: start from the defaults.
    return DEFAULT_READING;
  }
}

export const $reading = atom<ReadingPrefs>(typeof window === 'undefined' ? DEFAULT_READING : saved());

/** Set or clear one data attribute on <html>. */
function toggleAttribute(name: string, value: string | false) {
  const root = document.documentElement;
  if (value === false) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

function apply(prefs: ReadingPrefs) {
  toggleAttribute('data-text-size', prefs.textSize !== 'normal' && prefs.textSize);
  toggleAttribute('data-no-italics', prefs.noItalics && '');
  toggleAttribute('data-wide-spacing', prefs.wideSpacing && '');
  toggleAttribute('data-reduce-motion', prefs.reduceMotion && '');
}

/**
 * Change some reading preferences, keeping the rest.
 * @param change The preferences to change.
 */
export function setReading(change: Partial<ReadingPrefs>) {
  const next = { ...$reading.get(), ...change };
  apply(next);
  try {
    localStorage.setItem(READING_KEY, JSON.stringify(next));
  } catch {
    /* Storage unavailable (private mode, blocked): keep the in-memory choice. */
  }
  $reading.set(next);
}

/** Whether to skip animation: the system setting, or the viewer's choice here. */
export function prefersReducedMotion(): boolean {
  return $reading.get().reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
