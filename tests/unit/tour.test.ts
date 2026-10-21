/** The tour's spotlight path and tip placement. */
import { clipBox, padBox, spotlightPath, tipPosition } from '~/lib/tour';

const viewport = { width: 1000, height: 800 };
const tip = { width: 320, height: 150 };

it('pads a target on every side', () => {
  expect(padBox({ left: 10, top: 20, width: 30, height: 40 })).toEqual({ left: 4, top: 14, width: 42, height: 52 });
});

describe('the spotlight path', () => {
  it('covers the viewport when nothing is spotlit', () => {
    expect(spotlightPath([], viewport)).toBe('M0 0H1000V800H0Z');
  });

  it('cuts a rounded hole per box, shrinking the corners on small boxes', () => {
    const path = spotlightPath(
      [
        { left: 0, top: 0, width: 100, height: 50 },
        { left: 200, top: 200, width: 8, height: 8 },
      ],
      viewport,
    );
    expect(path).toContain('M10 0H90A10 10 0 0 1 100 10');
    expect(path).toContain('M204 200H204A4 4 0 0 1 208 204');
    expect(path.match(/Z/g)).toHaveLength(3);
  });
});

describe('the tip', () => {
  it('sits below a target in the top half, centred and kept on screen', () => {
    expect(tipPosition({ left: 0, top: 10, width: 40, height: 30 }, viewport, tip)).toEqual({ left: 16, top: 52 });
  });

  it('sits above a target in the bottom half', () => {
    expect(tipPosition({ left: 900, top: 700, width: 80, height: 60 }, viewport, tip)).toEqual({
      left: 664,
      bottom: 112,
    });
  });

  it('sits left of a tall side column, or right of it when there is no room', () => {
    expect(tipPosition({ left: 600, top: 12, width: 380, height: 776 }, viewport, tip)).toEqual({ left: 268, top: 36 });
    expect(tipPosition({ left: 100, top: 12, width: 300, height: 776 }, viewport, tip)).toEqual({ left: 412, top: 36 });
  });

  it('treats a full-width tall sheet as a bottom target', () => {
    expect(tipPosition({ left: 0, top: 300, width: 1000, height: 500 }, viewport, tip)).toEqual({
      left: 340,
      bottom: 512,
    });
  });

  it('drops to the column’s bottom when its top would cover another spotlit box', () => {
    const hex = { left: 300, top: 50, width: 30, height: 30 };
    expect(tipPosition({ left: 600, top: 12, width: 380, height: 776 }, viewport, tip, [hex])).toEqual({
      left: 268,
      bottom: 36,
    });
  });

  it('moves to the top of the page when above a phone sheet would cover the hex', () => {
    const phone = { width: 375, height: 812 };
    const sheet = { left: 0, top: 365, width: 375, height: 447 };
    const hex = { left: 150, top: 250, width: 30, height: 30 };
    expect(tipPosition(sheet, phone, { width: 343, height: 150 }, [hex])).toEqual({ left: 16, top: 16 });
  });

  it('keeps its first place when nowhere is clear', () => {
    expect(tipPosition({ left: 0, top: 0, width: 1000, height: 800 }, viewport, tip)).toEqual({
      left: 340,
      bottom: 812,
    });
  });
});

describe('clipping a box to its panel', () => {
  const panel = { left: 800, top: 12, width: 400, height: 776 };

  it('keeps the part inside', () => {
    expect(clipBox({ left: 784, top: 400, width: 432, height: 600 }, panel)).toEqual({
      left: 800,
      top: 400,
      width: 400,
      height: 388,
    });
  });

  it('is null when nothing is inside', () => {
    expect(clipBox({ left: 0, top: 0, width: 100, height: 100 }, panel)).toBeNull();
  });
});
