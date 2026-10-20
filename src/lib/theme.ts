import type { Theme } from './basemaps';

/** @returns The theme currently applied to `<html>`. */
export function currentTheme(): Theme {
  return document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark';
}

/**
 * Applies a theme, saves it for later visits and announces it with a `themechange` event.
 * @param next The theme to switch to.
 */
export function setTheme(next: Theme): void {
  document.documentElement.dataset['theme'] = next;
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* storage unavailable: theme applies for this page view only */
  }
  document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
}
