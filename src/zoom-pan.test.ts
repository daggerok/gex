import { describe, expect, test } from 'bun:test';
import { canPanRange, chartKeyAction, clickStep, panRange, panRangeBy, zoomRange, zoomStep } from './zoom-pan';

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

  test('Cmd is left to the browser (back and forward)', () => {
    expect(chartKeyAction(k('ArrowLeft', { metaKey: true }))).toBeNull();
    expect(chartKeyAction(k('ArrowRight', { metaKey: true, shiftKey: true }))).toBeNull();
  });
});
