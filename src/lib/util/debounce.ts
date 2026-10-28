/** Pause after the last keystroke before any search sends a request. */
export const SEARCH_DEBOUNCE_MS = 400;

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  flush(): void;
}

/** Trailing-edge debounce. Searches use `SEARCH_DEBOUNCE_MS`. */
export function debounce<A extends unknown[]>(callback: (...args: A) => void, ms = 250): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  const run = () => {
    timer = undefined;
    if (pending) {
      const args = pending;
      pending = undefined;
      callback(...args);
    }
  };
  const debounced = ((...args: A) => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as Debounced<A>;
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  debounced.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  return debounced;
}

/** Leading + trailing throttle, used for map-move → URL updates. */
export function throttle<A extends unknown[]>(callback: (...args: A) => void, ms: number): (...args: A) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  return (...args: A) => {
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0) {
      last = now;
      callback(...args);
      return;
    }
    pending = args;
    timer ??= setTimeout(() => {
      timer = undefined;
      last = Date.now();
      // Set by the call that started this timer, and only cleared here.
      const args = pending as A;
      pending = undefined;
      callback(...args);
    }, wait);
  };
}
