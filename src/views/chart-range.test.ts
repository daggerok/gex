/// <reference types="node" />
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { fromStoredView, loadRangeFor, toStoredView, visibleRangeFor } from './chart-range';

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

describe('stored view (offsets from the last bar)', () => {
  test('round trip: the same window comes back for the same number of bars', () => {
    const r = { from: 100.5, to: 140 };
    expect(fromStoredView(toStoredView(r, 150), 150)).toEqual(r);
  });

  test('stays anchored to the last bar when a new bar arrives: the window moves one bar with it', () => {
    const stored = toStoredView({ from: 100.5, to: 140 }, 150); // [-48.5, -9]
    expect(stored).toEqual([-48.5, -9]);
    expect(fromStoredView(stored, 151)).toEqual({ from: 101.5, to: 141 });
  });
});

describe('the All interval', () => {
  const times = Array.from({ length: 500 }, (_, i) => 1_700_000_000 + i * 86_400);

  test('shows every loaded bar from the first one, with the same empty space on the right as the others', () => {
    const r = visibleRangeFor(times, 'all');
    expect(r.from).toBe(-0.5);
    expect(r.to).toBe(499 + 60); // 12% of 500 bars
    expect(visibleRangeFor(times, '1y').from).toBeGreaterThan(0); // the others cut the older bars off
  });

  test('All asks the proxy for ten years of daily candles (Yahoo max is monthly), the others for one year', () => {
    expect(loadRangeFor('all')).toBe('10y');
    for (const r of ['1mo', '3mo', '6mo', '1y'] as const) expect(loadRangeFor(r)).toBe('1y');
  });
});
