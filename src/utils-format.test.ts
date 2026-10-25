/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { fmt, fmtCompact, fmtInt, fmtSignedCompact } from './utils';

// The number formatters are cached for speed, they must give exactly what toLocaleString gave.
describe('fmt and fmtInt keep their output', () => {
  const values = [0, -0, 1, -1, 0.5, 7811.54, -7811.54, 1234567.891, -98765432.1, 1e-7, 0.005, 0.995, 123456789012, 7850];

  test('fmt equals toLocaleString with the same digits, for every digit count', () => {
    for (const v of values) for (const d of [0, 1, 2, 4]) {
      expect(fmt(v, d)).toBe(v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
    }
  });

  test('fmtInt equals the rounded value with thousands separators', () => {
    for (const v of values) expect(fmtInt(v)).toBe(Math.round(v).toLocaleString());
  });

  test('missing and non-finite values stay empty', () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(fmt(v)).toBe('');
      expect(fmtInt(v)).toBe('');
    }
  });

  test('the same formatter can be used again and again with the same result', () => {
    expect([fmt(1234.5), fmt(1234.5), fmt(1234.5, 0), fmt(1234.5)]).toEqual([(1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), (1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), (1234.5).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }), (1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })]);
  });
});

describe('fmtCompact and fmtSignedCompact (moved from GexView to utils, shared with the Board)', () => {
  test('suffixes and signs', () => {
    expect(fmtCompact(2140000000)).toBe('2.14B');
    expect(fmtCompact(-310500000)).toBe('310.50M');
    expect(fmtCompact(999)).toBe('999.00');
    expect(fmtCompact(1.5e12)).toBe('1.50T');
    expect(fmtSignedCompact(2140000000)).toBe('+2.14B');
    expect(fmtSignedCompact(-1500)).toBe('-1.50K');
    expect(fmtSignedCompact(0)).toBe('0.00');
  });
});
