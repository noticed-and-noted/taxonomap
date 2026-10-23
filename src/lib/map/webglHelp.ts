/**
 * Help for turning WebGL back on, per browser, for the notice shown when the map can't draw.
 */

export type BrowserId = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

export interface BrowserHelp {
  id: BrowserId;
  /** How the notice names the browser in running text. */
  name: string;
  steps: string[];
}

export const WEBGL_HELP: BrowserHelp[] = [
  {
    id: 'chrome',
    name: 'Chrome',
    steps: ['Open Settings › System.', 'Turn on “Use graphics acceleration when available”.', 'Relaunch Chrome.'],
  },
  {
    id: 'edge',
    name: 'Edge',
    steps: [
      'Open Settings › System and performance.',
      'Turn on “Use graphics acceleration when available”.',
      'Restart Edge.',
    ],
  },
  {
    id: 'firefox',
    name: 'Firefox',
    steps: [
      'Open Settings › General › Performance.',
      'Untick “Use recommended performance settings”.',
      'Tick “Use hardware acceleration when available”, then restart Firefox.',
    ],
  },
  {
    id: 'safari',
    name: 'Safari',
    steps: [
      'Safari 15 or later is needed.',
      'Update through Software Update (on Mac: System Settings › General; on iPhone or iPad: Settings › General).',
    ],
  },
  {
    id: 'other',
    name: 'this browser',
    steps: [
      'Turn on graphics or hardware acceleration in the browser’s settings.',
      'Update the browser and your graphics drivers, or try another browser.',
    ],
  },
];

/**
 * Guesses the browser from its user agent, for picking which steps to show first.
 * Every browser on iPhone and iPad runs on Safari's engine, so those count as Safari.
 * Android browsers have no acceleration setting, so they get the general steps.
 * @returns `other` when unsure; the notice still offers every browser's steps.
 */
export function detectBrowser(userAgent: string): BrowserId {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'safari';
  if (/Android/.test(userAgent)) return 'other';
  if (/Edg\//.test(userAgent)) return 'edge';
  if (/Firefox\//.test(userAgent)) return 'firefox';
  if (/Chrome\//.test(userAgent)) return 'chrome';
  if (/Safari\//.test(userAgent)) return 'safari';
  return 'other';
}
