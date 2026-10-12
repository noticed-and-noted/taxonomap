/**
 * Nano Stores ⇄ query string.
 *
 * The URL is the source of truth: every registered atom is initialised from
 * location.search, writes back on change, and is re-read on popstate and
 * after ClientRouter swaps. Defaults are omitted to keep URLs short.
 *
 * - history 'push' entries (taxon, panel, hex…) create a back-button step.
 * - history 'replace' entries (map view) are throttled and never add steps.
 * - scope 'global' params are carried onto internal navigations, so the
 *   selected taxon follows you from the map to the tree and back.
 */
import { atom, type WritableAtom } from 'nanostores';

export interface UrlCodec<T> {
  key: string;
  default: T;
  parse: (raw: string) => T | undefined;
  serialize: (value: T) => string;
  history?: 'push' | 'replace';
  scope?: 'global' | 'page';
  equals?: (a: T, b: T) => boolean;
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
export function withHistoryMode(mode: 'push' | 'replace', fn: () => void): void {
  const prev = forcedMode;
  forcedMode = mode;
  try {
    fn();
  } finally {
    forcedMode = prev;
  }
}

const isBrowser = () => typeof window !== 'undefined' && typeof history !== 'undefined';

function defaultEquals(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function readValue<T>(codec: UrlCodec<T>, params: URLSearchParams): T {
  const raw = params.get(codec.key);
  if (raw === null) return codec.default;
  const parsed = codec.parse(raw);
  return parsed === undefined ? codec.default : parsed;
}

/** Serialise every registered store into `params` (mutates and returns it). */
export function writeParams(params: URLSearchParams, only?: (c: UrlCodec<unknown>) => boolean): URLSearchParams {
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
  if (!isBrowser()) return;
  const url = new URL(window.location.href);
  const before = url.search;
  writeParams(url.searchParams);
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
  applyingFromUrl = true;
  try {
    for (const { codec, store } of registry.values()) {
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
  // Carry global params (taxon, filters) onto internal navigations.
  document.addEventListener('astro:before-preparation', (e) => {
    const ev = e as Event & { to: URL; navigationType?: string };
    if (ev.navigationType === 'traverse' || ev.to.origin !== window.location.origin) return;
    const missing = (c: UrlCodec<unknown>) => (c.scope ?? 'page') === 'global' && !ev.to.searchParams.has(c.key);
    const to = new URL(ev.to);
    writeParams(to.searchParams, missing);
    ev.to = to;
  });
}

/** Create an atom bound to one query-string key. */
export function urlAtom<T>(codec: UrlCodec<T>): WritableAtom<T> {
  const initial = isBrowser() ? readValue(codec, new URLSearchParams(window.location.search)) : codec.default;
  const store = atom<T>(initial);
  registry.set(codec.key, { codec: codec as UrlCodec<unknown>, store: store as WritableAtom<unknown> });
  store.listen(() => schedule(codec.history ?? 'push'));
  listen();
  return store;
}

/** Build a query string for a link that applies `overrides` on top of current state. */
export function hrefWith(path: string, overrides: Record<string, string | null> = {}): string {
  const params = writeParams(new URLSearchParams(), (c) => (c.scope ?? 'page') === 'global');
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  params.sort();
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
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
  int(key: string, def: number | null, opts: Partial<UrlCodec<number | null>> = {}): UrlCodec<number | null> {
    return {
      key,
      default: def,
      parse: (raw) => (/^-?\d+$/.test(raw) ? Number(raw) : undefined),
      serialize: (v) => String(v),
      ...opts,
    };
  },
  bool(key: string, opts: Partial<UrlCodec<boolean>> = {}): UrlCodec<boolean> {
    return {
      key,
      default: false,
      parse: (raw) => (raw === '1' ? true : raw === '0' ? false : undefined),
      serialize: (v) => (v ? '1' : '0'),
      ...opts,
    };
  },
  enumOf<T extends string>(key: string, values: readonly T[], def: T, opts: Partial<UrlCodec<T>> = {}): UrlCodec<T> {
    return {
      key,
      default: def,
      parse: (raw) => ((values as readonly string[]).includes(raw) ? (raw as T) : undefined),
      serialize: (v) => v,
      ...opts,
    };
  },
  /** Comma-separated set from an allowed list; sorted for stable URLs. */
  setOf<T extends string>(key: string, values: readonly T[], opts: Partial<UrlCodec<T[]>> = {}): UrlCodec<T[]> {
    return {
      key,
      default: [],
      parse: (raw) => {
        const items = raw.split(',').filter((v): v is T => (values as readonly string[]).includes(v));
        return [...new Set(items)].sort();
      },
      serialize: (v) => [...v].sort().join(','),
      ...opts,
    };
  },
  string(key: string, opts: Partial<UrlCodec<string | null>> & { pattern?: RegExp } = {}): UrlCodec<string | null> {
    const { pattern, ...rest } = opts;
    return {
      key,
      default: null,
      parse: (raw) => (!pattern || pattern.test(raw) ? raw : undefined),
      serialize: (v) => v ?? '',
      ...rest,
    };
  },
};
