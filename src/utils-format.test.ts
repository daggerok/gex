/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { dataAge, fmt, fmtCompact, fmtDays, fmtInt, fmtSignedCompact } from './utils';

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

describe('fmtDays', () => {
  test('two decimals below a day, one from a day on, empty for a non-number', () => {
    expect(fmtDays(4 / 24)).toBe('0.17');
    expect(fmtDays(15 / 1440)).toBe('0.01');
    expect(fmtDays(30 + 4 / 24)).toBe('30.2');
    expect(fmtDays(1)).toBe('1.0');
    expect(fmtDays(NaN)).toBe('');
  });
});

describe('dataAge (GEX-H4)', () => {
  const ny = (iso: string) => new Date(iso);
  test('a file of today is current, shown at its New York time', () => {
    expect(dataAge('2026-10-23T15:45:10.120000-04:00', '2026-10-23', ny('2026-10-23T16:10:00-04:00'))).toEqual({ at: '2026-10-23 15:45', day: '2026-10-23', daysOld: 0, stale: false });
  });

  test("Friday's close is not stale over the weekend or before Monday's open", () => {
    const fri = '2026-10-23T16:45:00-04:00';
    expect(dataAge(fri, '2026-10-23', ny('2026-10-25T12:00:00-04:00'))?.stale).toBe(false);
    expect(dataAge(fri, '2026-10-23', ny('2026-10-26T09:00:00-04:00'))?.stale).toBe(false);
    expect(dataAge(fri, '2026-10-23', ny('2026-10-26T10:00:00-04:00'))).toEqual({ at: '2026-10-23 16:45', day: '2026-10-23', daysOld: 3, stale: true });
  });

  test('a weeks old file (the review case: AAPL of 10-05 opened on 10-24)', () => {
    expect(dataAge('2026-10-05T18:30:00-04:00', '2026-10-05', ny('2026-10-24T12:00:00-04:00'))).toEqual({ at: '2026-10-05 18:30', day: '2026-10-05', daysOld: 18, stale: true });
  });

  test('without a date the trading day of updated counts; nothing readable -> null', () => {
    expect(dataAge('2026-10-23T08:00:00-04:00', null, ny('2026-10-23T12:00:00-04:00'))).toEqual({ at: '2026-10-23 08:00', day: '2026-10-22', daysOld: 1, stale: true });
    expect(dataAge(null, '2026-10-23')).toBeNull();
    expect(dataAge('garbage', null)).toBeNull();
  });
});
