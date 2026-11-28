/**
 * The value `delta` steps from `current`, wrapping round between `first` and `last` (inclusive), so playback loops.
 * @returns A value from `first` to `last`.
 */
export function wrapStep(current: number, delta: number, first: number, last: number): number {
  const span = last - first + 1;
  return first + ((((current - first + delta) % span) + span) % span);
}
