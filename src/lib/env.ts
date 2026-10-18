/**
 * Environment variables for every runtime. Vite (Astro build, dev, browser)
 * exposes import.meta.env, inlining PUBLIC_* values into the client bundle;
 * plain Node scripts and tests fall back to process.env.
 */
export type EnvBag = Record<string, string | undefined>;

// The fallbacks are for runtimes without Vite or Node; tests always have both.
/* v8 ignore next */
const viteEnv = (import.meta as unknown as { env?: EnvBag & { DEV?: boolean } }).env ?? {};
/* v8 ignore next */
const nodeEnv: EnvBag = typeof process !== 'undefined' && typeof process.env === 'object' ? process.env : {};

export const env: EnvBag = { ...nodeEnv, ...viteEnv };

/** True under `astro dev` (smaller baked data, debug hooks). */
export function isDev(): boolean {
  return !!viteEnv.DEV;
}
