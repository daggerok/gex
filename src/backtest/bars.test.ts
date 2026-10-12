/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { OhlcBar } from '../types';
import { cutBarsAfter } from './bars';

const bar = (date: string): OhlcBar => ({ time: Date.parse(`${date}T00:00:00Z`) / 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
const bars = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12'].map(bar);

describe('cutBarsAfter', () => {
  test('keeps the bar of the archived day itself and drops the later ones', () => {
    expect(cutBarsAfter(bars, '2026-10-09').map((b) => b.time)).toEqual(bars.slice(0, 3).map((b) => b.time));
  });

  test('a date before the first bar leaves nothing, a date after the last leaves everything', () => {
    expect(cutBarsAfter(bars, '2026-01-01')).toEqual([]);
    expect(cutBarsAfter(bars, '2030-01-01')).toEqual(bars);
  });

  test('a weekend date keeps the Friday bar', () => {
    expect(cutBarsAfter(bars, '2026-10-10').map((b) => b.time)).toEqual(bars.slice(0, 3).map((b) => b.time));
  });

  test('a bad date changes nothing', () => {
    expect(cutBarsAfter(bars, 'nope')).toEqual(bars);
  });
});
