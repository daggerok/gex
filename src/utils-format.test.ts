/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translations } from './i18n';
import type { DataProvider } from './types';
import { dataAge, errorText, fmt, fmtCompact, fmtDays, fmtGreek, fmtInt, fmtSignedCompact, friendlyError, oiSharePct, UiError } from './utils';

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

describe('UiError (GEX-H8): errors the user reads follow the app language', () => {
  test('English message for logs, the Russian text through errorText and friendlyError', () => {
    const e = new UiError('error.noOptionData', { symbol: 'ZZZ' });
    expect(e.message).toBe('No option data for "ZZZ". Check the ticker symbol.');
    expect(errorText(e, 'ru')).toBe('Нет данных об опционах для «ZZZ». Проверьте тикер.');
    expect(friendlyError(e, { needsProxy: false } as unknown as DataProvider, 'ru')).toBe(errorText(e, 'ru'));
    expect(errorText(new Error('plain'), 'ru')).toBe('plain');
  });

  test('every UiError key thrown in src/ exists in en and ru', () => {
    const files = readdirSync(join(__dirname), { recursive: true })
      .map(String)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|e2e)\.ts$/.test(f));
    const keys = new Set<string>();
    for (const f of files) {
      for (const m of Array.from(readFileSync(join(__dirname, f), 'utf8').matchAll(/new UiError\('([^']+)'/g))) keys.add(m[1]);
    }
    expect(keys.size).toBeGreaterThan(15);
    keys.forEach((k) => {
      expect({ k, en: k in translations.en }).toEqual({ k, en: true });
      expect({ k, ru: k in translations.ru }).toEqual({ k, ru: true });
    });
  });
});

describe('oiSharePct (the OI share next to each expiration)', () => {
  test('one decimal, 100% whole, empty when there is no share', () => {
    expect(oiSharePct(0.064)).toBe('6.4%');
    expect(oiSharePct(0.1234)).toBe('12.3%');
    expect(oiSharePct(1)).toBe('100%');
    expect(oiSharePct(0)).toBe('0.0%');
    expect(oiSharePct(undefined)).toBe('');
    expect(oiSharePct(Number.NaN)).toBe('');
  });
});

describe('fmtGreek: fewer decimals for large values (futures theta fits its Desk column)', () => {
    test('4 decimals below 10, 2 from 10, 0 from 1000; empty for missing', () => {
        expect([0, 0.0049, -0.2764, 1.0831, -9.9999].map((v) => fmtGreek(v))).toEqual(['0.0000', '0.0049', '-0.2764', '1.0831', '-9.9999']);
        expect([-17.71, -17.7100123, 123.456, -1234.5].map((v) => fmtGreek(v))).toEqual(['-17.71', '-17.71', '123.46', '-1235']);
        expect(fmtGreek(null)).toBe('');
        expect(fmtGreek(12.345, 1)).toBe('12.3');
    });
});
