/** The logo's artwork: each viewBox is four numbers and holds what it frames. */
import { LOCKUP, MARK_VIEWBOX } from '~/lib/wordmark';

const UNITS_PER_EM = 104.78;

/** A viewBox as [x, y, width, height]. */
const boxOf = (viewBox: string) => viewBox.split(' ').map(Number);

it('frames the mark and the lockup with four numbers each', () => {
  expect(boxOf(MARK_VIEWBOX)).toHaveLength(4);
  expect(boxOf(LOCKUP.viewBox).every(Number.isFinite)).toBe(true);
});

it('keeps the lockup about one em tall, as Wordmark.astro sizes it', () => {
  const [, , width = 0, height = 0] = boxOf(LOCKUP.viewBox);
  expect(width / UNITS_PER_EM).toBeCloseTo(6.227, 3);
  expect(height / UNITS_PER_EM).toBeCloseTo(1.098, 3);
});

it('draws every part of the lockup', () => {
  expect([LOCKUP.ball, LOCKUP.coil, LOCKUP.leaf, LOCKUP.letters].every((path) => path.startsWith('M'))).toBe(true);
  expect(LOCKUP.coilStrokeWidth).toBeGreaterThan(0);
});
