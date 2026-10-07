import { describe, expect, test } from 'bun:test';
import { canPanRange, clickStep, panRange, zoomRange } from './zoom-pan';

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
