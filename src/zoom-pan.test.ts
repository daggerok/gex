import { describe, expect, test } from 'bun:test';
import { canPanRange, chartKeyAction, clickStep, ESCAPE_RUN_MS, panRange, panRangeBy, recordEscape, wheelSteps, zoomRange, zoomRangeAt, zoomStep } from './zoom-pan';

const base: [number, number] = [0, 100];

describe('panRange', () => {
  test('moves by exactly one step, whatever the visible width', () => {
    expect(panRange([40, 60], base, 1, 1)).toEqual([41, 61]);
    expect(panRange([40, 60], base, -1, 1)).toEqual([39, 59]);
    expect(panRange([10, 90], base, 1, 5)).toEqual([15, 95]);
  });

  test('is clamped to the data range and keeps its width', () => {
    expect(panRange([0.5, 20.5], base, -1, 1)).toEqual([0, 20]);
    expect(panRange([79.5, 99.5], base, 1, 1)).toEqual([80, 100]);
    expect(panRange([0, 20], base, -1, 1)).toEqual([0, 20]);
  });
});

describe('clickStep: 1% of the full range', () => {
  test('is a hundredth of the data range width', () => {
    expect(clickStep([0, 100])).toBe(1);
    expect(clickStep([704, 856])).toBeCloseTo(1.52, 9);
    expect(clickStep([7335, 8100])).toBeCloseTo(7.65, 9);
  });
});

describe('zoomStep: 2% of the full range, twice the arrow step', () => {
  test('is double clickStep', () => {
    expect(zoomStep([0, 100])).toBe(2);
    expect(zoomStep([704, 856])).toBeCloseTo(3.04, 9);
    expect(zoomStep([7335, 8100])).toBeCloseTo(2 * clickStep([7335, 8100]), 9);
  });
});

describe('zoomRange: one step per click on each side', () => {
  test('zoom in moves both edges toward the middle, zoom out moves them back', () => {
    expect(zoomRange([40, 60], base, 'in', 1, 3)).toEqual([41, 59]);
    expect(zoomRange([41, 59], base, 'out', 1, 3)).toEqual([40, 60]);
    expect(zoomRange([50, 90], base, 'in', 5, 3)).toEqual([55, 85]);
  });

  test('zoom in stops before the range gets narrower than minWidth', () => {
    expect(zoomRange([40, 45], base, 'in', 1, 3)).toEqual([41, 44]);
    expect(zoomRange([41, 44], base, 'in', 1, 3)).toEqual([41, 44]);
  });

  test('zoom out is clamped to the data and returns null at the full range', () => {
    expect(zoomRange([0.5, 20], base, 'out', 1, 3)).toEqual([0, 21]);
    expect(zoomRange([1, 99], base, 'out', 1, 3)).toBeNull();
    expect(zoomRange([0, 99.5], base, 'out', 1, 3)).toBeNull();
  });
});

describe('canPanRange', () => {
  test('false at the edge in that direction only', () => {
    expect(canPanRange([0, 20], base, -1)).toBe(false);
    expect(canPanRange([0, 20], base, 1)).toBe(true);
    expect(canPanRange([80, 100], base, 1)).toBe(false);
    expect(canPanRange([80, 100], base, -1)).toBe(true);
  });
});

describe('panRangeBy: free shift for the mouse drag', () => {
  test('shifts by any amount and keeps the width', () => {
    expect(panRangeBy([40, 60], base, 7.5)).toEqual([47.5, 67.5]);
    expect(panRangeBy([40, 60], base, -12)).toEqual([28, 48]);
  });

  test('is clamped to the data range', () => {
    expect(panRangeBy([40, 60], base, 100)).toEqual([80, 100]);
    expect(panRangeBy([40, 60], base, -100)).toEqual([0, 20]);
    expect(panRangeBy([0, 20], base, -5)).toEqual([0, 20]);
  });
});

describe('chartKeyAction', () => {
  const k = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

  test('plain Left and Right move the chart, other keys are not ours', () => {
    expect(chartKeyAction(k('ArrowLeft'))).toBe('panLeft');
    expect(chartKeyAction(k('ArrowRight'))).toBe('panRight');
    expect(chartKeyAction(k('ArrowUp'))).toBeNull();
    expect(chartKeyAction(k('a'))).toBeNull();
  });

  test('with Ctrl, Alt or Shift: Right and Up zoom in, Left and Down zoom out', () => {
    for (const mod of ['ctrlKey', 'altKey', 'shiftKey'] as const) {
      expect(chartKeyAction(k('ArrowRight', { [mod]: true }))).toBe('zoomIn');
      expect(chartKeyAction(k('ArrowUp', { [mod]: true }))).toBe('zoomIn');
      expect(chartKeyAction(k('ArrowLeft', { [mod]: true }))).toBe('zoomOut');
      expect(chartKeyAction(k('ArrowDown', { [mod]: true }))).toBe('zoomOut');
    }
    expect(chartKeyAction(k('Enter', { shiftKey: true }))).toBeNull();
  });

  test('the plus and minus keys zoom in and out, with or without Shift (Shift+= types a plus)', () => {
    expect(chartKeyAction(k('+'))).toBe('zoomIn');
    expect(chartKeyAction(k('+', { shiftKey: true }))).toBe('zoomIn');
    expect(chartKeyAction(k('='))).toBe('zoomIn');
    expect(chartKeyAction(k('-'))).toBe('zoomOut');
    expect(chartKeyAction(k('_', { shiftKey: true }))).toBe('zoomOut');
  });

  test('plus and minus with Cmd, Ctrl or Alt are the browser page zoom or special characters, not ours', () => {
    expect(chartKeyAction(k('+', { metaKey: true }))).toBeNull();
    expect(chartKeyAction(k('=', { ctrlKey: true }))).toBeNull();
    expect(chartKeyAction(k('-', { ctrlKey: true }))).toBeNull();
    expect(chartKeyAction(k('-', { altKey: true }))).toBeNull();
  });

  test('Cmd is left to the browser (back and forward)', () => {
    expect(chartKeyAction(k('ArrowLeft', { metaKey: true }))).toBeNull();
    expect(chartKeyAction(k('ArrowRight', { metaKey: true, shiftKey: true }))).toBeNull();
  });
});

describe('recordEscape: runs of Escape presses within a second', () => {
  test('a single press is a run of one', () => {
    expect(recordEscape([], 1000)).toEqual([1000]);
  });

  test('presses within a second build up the run', () => {
    const r1 = recordEscape([], 1000);
    const r2 = recordEscape(r1, 1400);
    const r3 = recordEscape(r2, 1900);
    expect(r2).toEqual([1000, 1400]);
    expect(r3).toEqual([1000, 1400, 1900]);
  });

  test('a press more than a second after the earlier ones starts the run again', () => {
    expect(recordEscape([1000, 1400], 1400 + ESCAPE_RUN_MS + 1)).toEqual([1400 + ESCAPE_RUN_MS + 1]);
  });

  test('the window slides: the oldest press drops out when it is too old', () => {
    // 0, 600, 1300: at 1300 the press at 0 is 1300 ms old and drops out, 600 stays
    expect(recordEscape([0, 600], 1300)).toEqual([600, 1300]);
    // the press exactly ESCAPE_RUN_MS old still counts
    expect(recordEscape([0], ESCAPE_RUN_MS)).toEqual([0, ESCAPE_RUN_MS]);
  });
});

describe('zoomRangeAt: zoom anchored at the cursor', () => {
  test('frac 0.5 is the middle, same as zoomRange with the per-edge step', () => {
    expect(zoomRangeAt([40, 60], base, 'in', 1, 3, 0.5)).toEqual(zoomRange([40, 60], base, 'in', 1, 3));
    expect(zoomRangeAt([40, 60], base, 'out', 1, 3, 0.5)).toEqual(zoomRange([40, 60], base, 'out', 1, 3));
  });

  test('the strike under the cursor stays where it is: the nearer edge moves less', () => {
    // cursor at 25% of [40, 60] = strike 45, total change 4 -> left edge +1, right edge -3
    expect(zoomRangeAt([40, 60], base, 'in', 2, 3, 0.25)).toEqual([41, 57]);
    const [a, b] = zoomRangeAt([40, 60], base, 'in', 2, 3, 0.25)!;
    expect((45 - a) / (b - a)).toBeCloseTo(0.25, 9);
    // cursor on the left edge: that edge stays, the right edge takes the whole change; mirrored on the right
    expect(zoomRangeAt([40, 60], base, 'in', 2, 3, 0)).toEqual([40, 56]);
    expect(zoomRangeAt([40, 60], base, 'in', 2, 3, 1)).toEqual([44, 60]);
  });

  test('zoom out is clamped to the data and returns null at the full range', () => {
    expect(zoomRangeAt([1, 20], base, 'out', 2, 3, 0.1)![0]).toBeCloseTo(0.6, 9);
    expect(zoomRangeAt([1, 20], base, 'out', 2, 3, 0.1)![1]).toBeCloseTo(23.6, 9);
    expect(zoomRangeAt([1, 20], base, 'out', 2, 3, 0)).toEqual([1, 24]);
    expect(zoomRangeAt([0.5, 20], base, 'out', 2, 3, 1)).toEqual([0, 20]);
    expect(zoomRangeAt([1, 99], base, 'out', 2, 3, 0.5)).toBeNull();
  });

  test('zoom in stops at the minimum width, frac outside 0..1 is clamped', () => {
    expect(zoomRangeAt([40, 44], base, 'in', 2, 3, 0.5)).toEqual([40, 44]);
    expect(zoomRangeAt([40, 60], base, 'in', 2, 3, 7)).toEqual([44, 60]);
  });
});

describe('wheelSteps', () => {
  test('scrolling down zooms in (positive steps), up zooms out (negative)', () => {
    expect(wheelSteps(0, 100, false, 50)).toEqual({ steps: 2, acc: 0 });
    expect(wheelSteps(0, -100, false, 50)).toEqual({ steps: -2, acc: 0 });
  });

  test('small smooth-scroll deltas add up until they pass the threshold', () => {
    let r = { steps: 0, acc: 0 };
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) { r = wheelSteps(r.acc, 12, false, 50); seen.push(r.steps); }
    expect(seen.reduce((s, x) => s + x, 0)).toBe(2); // 120 px = 2 steps, 20 px left over
    expect(r.acc).toBe(20);
  });

  test('a pinch (Ctrl held) is the opposite sign: pinch out zooms in', () => {
    expect(wheelSteps(0, -100, true, 50)).toEqual({ steps: 2, acc: 0 });
    expect(wheelSteps(0, 100, true, 50)).toEqual({ steps: -2, acc: 0 });
  });
});
