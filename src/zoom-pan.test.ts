import { describe, expect, test } from 'bun:test';
import { canPanRange, panRange, stepPan, viewDomain } from './zoom-pan';

const base: [number, number] = [0, 100];

describe('panRange', () => {
  test('moves by exactly one step (one strike), whatever the visible width', () => {
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

describe('canPanRange', () => {
  test('false at the edge in that direction only', () => {
    expect(canPanRange([0, 20], base, -1)).toBe(false);
    expect(canPanRange([0, 20], base, 1)).toBe(true);
    expect(canPanRange([80, 100], base, 1)).toBe(false);
    expect(canPanRange([80, 100], base, -1)).toBe(true);
  });
});

describe('viewDomain (value axis)', () => {
  test('no pan = the centered zoom around zero', () => {
    expect(viewDomain([-100, 200], 0.5, 0)).toEqual([-50, 100]);
  });

  test('pan 1 puts the top of the view on the top of the axis, pan -1 the bottom on the bottom', () => {
    expect(viewDomain([-100, 200], 0.5, 1)).toEqual([50, 200]);
    expect(viewDomain([-100, 200], 0.5, -1)).toEqual([-100, 50]);
  });

  test('an axis that starts at zero (AG) cannot move below zero', () => {
    expect(viewDomain([0, 200], 0.5, -1)).toEqual([0, 100]);
    expect(viewDomain([0, 200], 0.5, 1)).toEqual([100, 200]);
  });

  test('zooming out or no zoom ignores the pan', () => {
    expect(viewDomain([-100, 200], 2, 1)).toEqual([-200, 400]);
    expect(viewDomain([-100, 200], 1, -1)).toEqual([-100, 200]);
  });
});

describe('stepPan', () => {
  test('moves by half a step and clamps to [-1, 1]', () => {
    expect(stepPan(0, 1)).toBe(0.5);
    expect(stepPan(0.5, 1)).toBe(1);
    expect(stepPan(1, 1)).toBe(1);
    expect(stepPan(-0.5, -1)).toBe(-1);
    expect(stepPan(-1, -1)).toBe(-1);
  });
});
