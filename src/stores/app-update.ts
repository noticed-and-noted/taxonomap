/**
 * A newer deploy is ready: holds the action that switches this tab to it, or
 * null while the running version is current. Set by the service worker
 * wiring in BaseLayout, shown by StaleNotice.
 */
import { atom } from 'nanostores';

export const $applyUpdate = atom<(() => void) | null>(null);
