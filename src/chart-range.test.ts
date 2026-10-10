/// <reference types="node" />
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { visibleRangeFor } from './views/chart-range';

const DAY = 86_400;
/** `n` consecutive daily bars ending at day 1000. */
const days = (n: number) => Array.from({ length: n }, (_, i) => (1000 - (n - 1 - i)) * DAY);

describe('visibleRangeFor', () => {
  test('6M of 250 loaded bars: only the last ~6 months count, oldest ~15% of those scroll off, pad on the right', () => {
    // 250 bars, last 183 days + the bar on the cutoff = 184 in range, 157 visible, pad ceil(157 * 0.12) = 19
    expect(visibleRangeFor(days(250), '6mo')).toEqual({ from: 250 - 157 - 0.5, to: 249 + 19 });
  });

  test('a shorter range zooms in further, a longer one shows more of the same loaded history', () => {
    const t = days(366);
    const one = visibleRangeFor(t, '1mo');
    const six = visibleRangeFor(t, '6mo');
    const year = visibleRangeFor(t, '1y');
    expect(one.from).toBeGreaterThan(six.from);
    expect(six.from).toBeGreaterThan(year.from);
  });

  test('less history than the range shows everything that is loaded', () => {
    // 21 bars, range 6M: all 21 in range, 18 visible, pad 3
    expect(visibleRangeFor(days(21), '6mo')).toEqual({ from: 2.5, to: 23 });
  });

  test('a single bar still gets a pad and never a negative width', () => {
    const r = visibleRangeFor([1000 * DAY], '6mo');
    expect(r.from).toBe(-0.5);
    expect(r.to).toBeGreaterThan(r.from);
  });
});
