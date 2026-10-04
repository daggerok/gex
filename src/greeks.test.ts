import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BS_DIVIDEND_YIELD,
  INDEX_DIVIDEND_YIELDS,
  INDEX_SYMBOLS,
  SPX_DIVIDEND_YIELD,
  blackScholesGreeks,
  dividendYieldForSymbol,
} from './greeks';

const root = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Pull the string members out of `const SUPPORTED_INDEX_SYMBOLS = new Set([...])`. */
function proxyIndexSymbols(src: string): string[] {
  const m = /const SUPPORTED_INDEX_SYMBOLS = new Set\(\[([^\]]*)\]\)/.exec(src);
  if (!m) throw new Error('SUPPORTED_INDEX_SYMBOLS not found');
  return [...m[1].matchAll(/"([A-Z]+)"/g)].map((x) => x[1]).sort();
}

describe('index symbols', () => {
  test('INDEX_SYMBOLS is exactly the verified index set', () => {
    expect([...INDEX_SYMBOLS].sort()).toEqual(['DJX', 'NDX', 'RUT', 'SPX', 'XSP']);
  });

  test('every index symbol has its own yield entry', () => {
    expect([...INDEX_SYMBOLS].sort()).toEqual(Object.keys(INDEX_DIVIDEND_YIELDS).sort());
  });

  test('VIX (futures-priced) and OEX (dead chain) are not supported', () => {
    expect(INDEX_SYMBOLS.has('VIX')).toBe(false);
    expect(INDEX_SYMBOLS.has('OEX')).toBe(false);
  });

  test('data/Indices.txt matches INDEX_SYMBOLS', () => {
    const lines = read('data/Indices.txt').split('\n').map((l) => l.trim()).filter(Boolean).sort();
    expect(lines).toEqual([...INDEX_SYMBOLS].sort());
  });

  test('both proxies mirror INDEX_SYMBOLS in SUPPORTED_INDEX_SYMBOLS', () => {
    const expected = [...INDEX_SYMBOLS].sort();
    expect(proxyIndexSymbols(read('scripts/options-local-proxy.ts'))).toEqual(expected);
    expect(proxyIndexSymbols(read('scripts/options-cloudflare-proxy.js'))).toEqual(expected);
  });
});

describe('dividendYieldForSymbol', () => {
  test('per-index yields', () => {
    expect(dividendYieldForSymbol('SPX')).toBe(0.011);
    expect(dividendYieldForSymbol('XSP')).toBe(0.011);
    expect(dividendYieldForSymbol('NDX')).toBe(0.006);
    expect(dividendYieldForSymbol('DJX')).toBe(0.015);
    expect(dividendYieldForSymbol('RUT')).toBe(0.011);
  });

  test('XSP uses the exact S&P 500 yield (XSP = SPX / 10)', () => {
    expect(dividendYieldForSymbol('XSP')).toBe(SPX_DIVIDEND_YIELD);
    expect(dividendYieldForSymbol('XSP')).toBe(dividendYieldForSymbol('SPX'));
  });

  test('indices with different composition do not share the S&P 500 yield', () => {
    expect(dividendYieldForSymbol('NDX')).toBeLessThan(dividendYieldForSymbol('SPX'));
    expect(dividendYieldForSymbol('DJX')).toBeGreaterThan(dividendYieldForSymbol('SPX'));
  });

  test('accepts provider spellings and casing', () => {
    expect(dividendYieldForSymbol('^NDX')).toBe(0.006);
    expect(dividendYieldForSymbol('_DJX')).toBe(0.015);
    expect(dividendYieldForSymbol(' rut ')).toBe(0.011);
  });

  test('equities, unsupported indices and empty input fall back to q=0', () => {
    for (const s of ['AAPL', 'SPY', 'QQQ', 'VIX', 'OEX', '', null, undefined]) {
      expect(dividendYieldForSymbol(s)).toBe(BS_DIVIDEND_YIELD);
    }
  });

  test('all yields are plausible continuous index yields', () => {
    for (const q of Object.values(INDEX_DIVIDEND_YIELDS)) {
      expect(q).toBeGreaterThan(0);
      expect(q).toBeLessThan(0.05);
    }
  });
});

describe('blackScholesGreeks dividend yield', () => {
  const quote = {
    side: 'call' as const,
    strike: 30000,
    expiration: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
    iv: 0.18,
    last: null,
    mid: null,
    bid: null,
    ask: null,
  };

  test('NDX yield gives a higher call delta than wrongly reusing the S&P 500 yield', () => {
    const ndx = blackScholesGreeks(quote, 30800, undefined, dividendYieldForSymbol('NDX')).greeks!;
    const spx = blackScholesGreeks(quote, 30800, undefined, SPX_DIVIDEND_YIELD).greeks!;
    expect(ndx.delta).toBeGreaterThan(spx.delta);
  });
});
