/// <reference types="node" />
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { initialVisibleRange } from './views/chart-range';

describe('initialVisibleRange', () => {
  test('6M of daily bars: oldest ~15% scrolled off, empty space right of the last candle', () => {
    // 125 bars: 107 visible, pad ceil(107 * 0.12) = 13 bars past the last index 124
    expect(initialVisibleRange(125)).toEqual({ from: 17.5, to: 137 });
  });

  test('1M of daily bars keeps the same shape', () => {
    // 21 bars: 18 visible, pad 3
    expect(initialVisibleRange(21)).toEqual({ from: 2.5, to: 23 });
  });

  test('a single bar still gets a pad and never a negative width', () => {
    const r = initialVisibleRange(1);
    expect(r.from).toBe(-0.5);
    expect(r.to).toBeGreaterThan(r.from);
  });
});
