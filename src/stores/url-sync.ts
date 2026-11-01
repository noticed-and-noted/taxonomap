/**
 * Nano Stores ⇄ query string.
 *
 * The URL is the source of truth: every registered atom is initialised from
 * location.search, writes back on change, and is re-read on popstate and
 * after ClientRouter swaps. Defaults are omitted to keep URLs short.
 *
 * - history 'push' entries (taxon, panel, hex…) create a back-button step.
 * - history 'replace' entries (map view) are throttled and never add steps.
 * - scope 'map' params belong to the map page (/). Other pages leave them out
 *   of their URL but keep their values, and they are put back on the way to
 *   the map, so the map comes back as you left it.
 */
import { atom, type WritableAtom } from 'nanostores';

export interface UrlCodec<T> {
  key: string;
  default: T;
  parse: (raw: string) => T | undefined;
  serialize: (value: T) => string;
  history?: 'push' | 'replace';
  scope?: 'map' | 'page';
  equals?: (left: T, right: T) => boolean;
}

interface Entry {
  codec: UrlCodec<unknown>;
  store: WritableAtom<unknown>;
}

const REPLACE_THROTTLE_MS = 300;
const registry = new Map<string, Entry>();
let applyingFromUrl = false;
let pendingPush = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let microtaskQueued = false;
let listening = false;
let forcedMode: 'push' | 'replace' | null = null;

/**
 * Run `fn` with every URL write using `mode` (e.g. animations write with
 * 'replace' so they don't flood the back-button history).
 */
export function withHistoryMode(mode: 'push' | 'replace', callback: () => void): void {
  const previousMode = forcedMode;
  forcedMode = mode;
  try {
    callback();
  } finally {
    forcedMode = previousMode;
  }
}

const isBrowser = () => typeof window !== 'undefined' && typeof history !== 'undefined';
const isMapParam = (codec: UrlCodec<unknown>) => codec.scope === 'map';
const onMap = (path: string) => path === '/';

function defaultEquals(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function readValue<T>(codec: UrlCodec<T>, params: URLSearchParams): T {
  const raw = params.get(codec.key);
  if (raw === null) return codec.default;
  const parsed = codec.parse(raw);
  return parsed === undefined ? codec.default : parsed;
}

/** Serialise every registered store into `params` (mutates and returns it). */
export function writeParams(params: URLSearchParams, only?: (codec: UrlCodec<unknown>) => boolean): URLSearchParams {
  for (const { codec, store } of registry.values()) {
    if (only && !only(codec)) continue;
    const value = store.get();
    const eq = codec.equals ?? defaultEquals;
    if (eq(value, codec.default)) params.delete(codec.key);
    else params.set(codec.key, codec.serialize(value));
  }
  params.sort();
  return params;
}

function flush(): void {
  flushTimer = undefined;
  microtaskQueued = false;
  // Only scheduled in a browser (see schedule).
  const url = new URL(window.location.href);
  const before = url.search;
  writeParams(url.searchParams, onMap(url.pathname) ? undefined : (codec) => !isMapParam(codec));
  if (url.search === before) {
    pendingPush = false;
    return;
  }
  // Keep Astro's ClientRouter history state intact.
  const state: unknown = history.state;
  if (pendingPush) history.pushState(state, '', url);
  else history.replaceState(state, '', url);
  pendingPush = false;
}

function schedule(requested: 'push' | 'replace'): void {
  if (!isBrowser() || applyingFromUrl) return;
  const mode = forcedMode ?? requested;
  if (mode === 'push') {
    pendingPush = true;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    if (!microtaskQueued) {
      microtaskQueued = true;
      queueMicrotask(flush);
    }
    return;
  }
  if (!flushTimer && !microtaskQueued) flushTimer = setTimeout(flush, REPLACE_THROTTLE_MS);
}

/** Re-read all stores from the current URL without writing back. */
export function syncFromUrl(search = isBrowser() ? window.location.search : ''): void {
  const params = new URLSearchParams(search);
  const mapToo = !isBrowser() || onMap(window.location.pathname);
  applyingFromUrl = true;
  try {
    for (const { codec, store } of registry.values()) {
      if (!mapToo && isMapParam(codec)) continue;
      const next = readValue(codec, params);
      if (!(codec.equals ?? defaultEquals)(next, store.get())) store.set(next);
    }
  } finally {
    applyingFromUrl = false;
  }
}

function listen(): void {
  if (listening || !isBrowser()) return;
  listening = true;
  window.addEventListener('popstate', () => syncFromUrl());
  document.addEventListener('astro:after-swap', () => syncFromUrl());
  // Put the map's params back on internal navigations to the map.
  document.addEventListener('astro:before-preparation', (event) => {
    const navigationEvent = event as Event & { to: URL; navigationType?: string };
    if (
      navigationEvent.navigationType === 'traverse' ||
      navigationEvent.to.origin !== window.location.origin ||
      !onMap(navigationEvent.to.pathname)
    )
      return;
    const missing = (codec: UrlCodec<unknown>) => isMapParam(codec) && !navigationEvent.to.searchParams.has(codec.key);
    const to = new URL(navigationEvent.to);
    writeParams(to.searchParams, missing);
    navigationEvent.to = to;
  });
}

/** Create an atom bound to one query-string key. */
export function urlAtom<T>(codec: UrlCodec<T>): WritableAtom<T> {
  const fromUrl = isBrowser() && (codec.scope !== 'map' || onMap(window.location.pathname));
  const initial = fromUrl ? readValue(codec, new URLSearchParams(window.location.search)) : codec.default;
  const store = atom<T>(initial);
  registry.set(codec.key, { codec: codec as UrlCodec<unknown>, store: store as WritableAtom<unknown> });
  store.listen(() => schedule(codec.history ?? 'push'));
  listen();
  return store;
}

/** Build a query string for a link that applies `overrides` on top of current state. */
export function hrefWith(path: string, overrides: Record<string, string | null> = {}): string {
  const params = writeParams(new URLSearchParams(), isMapParam);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  params.sort();
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

/** Test helper. */
export function __resetUrlSync(): void {
  registry.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  pendingPush = false;
  microtaskQueued = false;
}

/* ---------- Codecs ---------- */

export const codecs = {
  int(
    key: string,
    defaultValue: number | null,
    options: Partial<UrlCodec<number | null>> = {},
  ): UrlCodec<number | null> {
    return {
      key,
      default: defaultValue,
      parse: (raw) => (/^-?\d+$/.test(raw) ? Number(raw) : undefined),
      serialize: (value) => String(value),
      ...options,
    };
  },
  bool(key: string, options: Partial<UrlCodec<boolean>> = {}): UrlCodec<boolean> {
    return {
      key,
      default: false,
      parse: (raw) => (raw === '1' ? true : raw === '0' ? false : undefined),
      serialize: (value) => (value ? '1' : '0'),
      ...options,
    };
  },
  enumOf<T extends string>(
    key: string,
    values: readonly T[],
    defaultValue: T,
    options: Partial<UrlCodec<T>> = {},
  ): UrlCodec<T> {
    return {
      key,
      default: defaultValue,
      parse: (raw) => ((values as readonly string[]).includes(raw) ? (raw as T) : undefined),
      serialize: (value) => value,
      ...options,
    };
  },
  /** Comma-separated set from an allowed list; sorted for stable URLs. */
  setOf<T extends string>(key: string, values: readonly T[], options: Partial<UrlCodec<T[]>> = {}): UrlCodec<T[]> {
    return {
      key,
      default: [],
      parse: (raw) => {
        const items = raw.split(',').filter((value): value is T => (values as readonly string[]).includes(value));
        return [...new Set(items)].sort();
      },
      serialize: (value) => [...value].sort().join(','),
      ...options,
    };
  },
  /** Comma-separated set of integers in [min, max], numeric order, at most `limit` items. */
  intSet(
    key: string,
    { min = -Infinity, max = Infinity, limit = Infinity }: { min?: number; max?: number; limit?: number } = {},
    options: Partial<UrlCodec<number[]>> = {},
  ): UrlCodec<number[]> {
    return {
      key,
      default: [],
      parse: (raw) => {
        const items = raw
          .split(',')
          .filter((value) => /^-?\d+$/.test(value))
          .map(Number)
          .filter((value) => value >= min && value <= max);
        return [...new Set(items)].sort((left, right) => left - right).slice(0, limit);
      },
      serialize: (value) => [...value].sort((left, right) => left - right).join(','),
      ...options,
    };
  },
  /** Comma-separated set of strings matching `pattern`, sorted for stable URLs, at most `limit` items. */
  stringSet(
    key: string,
    { pattern, limit = Infinity }: { pattern: RegExp; limit?: number },
    options: Partial<UrlCodec<string[]>> = {},
  ): UrlCodec<string[]> {
    return {
      key,
      default: [],
      parse: (raw) => [...new Set(raw.split(',').filter((value) => pattern.test(value)))].sort().slice(0, limit),
      serialize: (value) => [...value].sort().join(','),
      ...options,
    };
  },
  string(key: string, options: Partial<UrlCodec<string | null>> & { pattern?: RegExp } = {}): UrlCodec<string | null> {
    const { pattern, ...rest } = options;
    return {
      key,
      default: null,
      parse: (raw) => (!pattern || pattern.test(raw) ? raw : undefined),
      serialize: (value) => value ?? '',
      ...rest,
    };
  },
};
