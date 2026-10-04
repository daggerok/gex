import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BS_DIVIDEND_YIELD,
  FUTURES_PRICED_SYMBOLS,
  INDEX_DIVIDEND_YIELDS,
  INDEX_SYMBOLS,
  SPX_DIVIDEND_YIELD,
  blackScholesGreeks,
  dividendYieldForSymbol,
  enrichQuoteWithModelGreeks,
  enrichQuotesWithModelGreeks,
  isFuturesPricedSymbol,
} from './greeks';
import type { OptionQuote } from './types';

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

// ---------------------------------------------------------------------------
// VIX / VXN harm-reduction fix: VIX options are priced off the futures curve
// per expiration, not spot - this app's Black-Scholes model is the wrong
// model for them (not just imprecise). Cboe's own feed already supplies
// correct 1st-order greeks for VIX; only the model-computed higher-order
// greeks (and, separately, GEX) must be suppressed. See
// .plans/gex-vix-futures-pricing-research.txt for the full investigation.
// ---------------------------------------------------------------------------
describe('futures-priced symbols (VIX, VXN)', () => {
  test('FUTURES_PRICED_SYMBOLS is exactly VIX and VXN', () => {
    expect([...FUTURES_PRICED_SYMBOLS].sort()).toEqual(['VIX', 'VXN']);
  });

  test('isFuturesPricedSymbol accepts provider spellings and casing', () => {
    expect(isFuturesPricedSymbol('VIX')).toBe(true);
    expect(isFuturesPricedSymbol('vix')).toBe(true);
    expect(isFuturesPricedSymbol('^VIX')).toBe(true);
    expect(isFuturesPricedSymbol('_VIX')).toBe(true);
    expect(isFuturesPricedSymbol(' vxn ')).toBe(true);
    expect(isFuturesPricedSymbol('VXN')).toBe(true);
  });

  test('isFuturesPricedSymbol rejects spot-priced indices, equities and empty input', () => {
    for (const s of ['SPX', 'XSP', 'NDX', 'DJX', 'RUT', 'AAPL', 'SPY', '', null, undefined]) {
      expect(isFuturesPricedSymbol(s)).toBe(false);
    }
  });

  /** A quote shaped like what Cboe's own feed supplies for VIX today: real
   *  1st-order greeks (delta/gamma/theta/vega/rho), no higher-order ones. */
  function cboeVixQuote(overrides: Partial<OptionQuote> = {}): OptionQuote {
    return {
      symbol: 'VIX261015C00020000',
      expiration: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      side: 'call',
      strike: 20,
      bid: 0.5, ask: 0.6, mid: 0.55, last: 0.55,
      volume: 10, openInterest: 100,
      iv: 0.9,
      delta: 0.4, gamma: 0.05, theta: -0.01, vega: 0.02, rho: 0.001,
      ...overrides,
    };
  }

  test('enrichQuoteWithModelGreeks(isFuturesPriced=true) leaves Cboe 1st-order greeks untouched and tags futures_priced', () => {
    const q = cboeVixQuote();
    const out = enrichQuoteWithModelGreeks(q, 15.3, BS_DIVIDEND_YIELD, true);
    // Provider-supplied 1st-order greeks: byte-for-byte unchanged.
    expect(out.delta).toBe(q.delta);
    expect(out.gamma).toBe(q.gamma);
    expect(out.theta).toBe(q.theta);
    expect(out.vega).toBe(q.vega);
    expect(out.rho).toBe(q.rho);
    // Higher-order greeks: never filled in by the (wrong, spot-based) model.
    for (const k of ['lambda', 'vanna', 'vomma', 'charm', 'speed', 'zomma', 'color'] as const) {
      expect(out[k] ?? null).toBeNull();
    }
    expect(out.greeksMissingReason).toBe('futures_priced');
  });

  test('enrichQuoteWithModelGreeks(isFuturesPriced=true) never calls the BS model, even with full spot/strike/IV present', () => {
    const q = cboeVixQuote();
    // A real spot (15.3) and a real IV (0.9) are both present, so a non-VIX
    // call would happily fill in BS greeks here. For VIX it must not.
    const out = enrichQuoteWithModelGreeks(q, 15.3, BS_DIVIDEND_YIELD, true);
    expect(out.greeksSource ?? null).not.toBe('black-scholes');
  });

  test('enrichQuoteWithModelGreeks(isFuturesPriced=true) leaves an already fully-enriched quote (static cache) alone', () => {
    const q = cboeVixQuote({ lambda: 1.2, vanna: 0.01, vomma: 0.02, charm: -0.001, speed: 0.0001, zomma: 0.002, color: -0.0005 });
    const out = enrichQuoteWithModelGreeks(q, 15.3, BS_DIVIDEND_YIELD, true);
    expect(out).toBe(q);
  });

  test('enrichQuotesWithModelGreeks: a VIX quote is suppressed, a non-VIX (SPX) quote is completely unaffected', () => {
    const exp = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const vix = cboeVixQuote({ expiration: exp });
    const spx: OptionQuote = {
      symbol: 'SPX261015C06000000',
      expiration: exp,
      side: 'call',
      strike: 6000,
      bid: 50, ask: 51, mid: 50.5, last: 50.5,
      volume: 10, openInterest: 100,
      iv: 0.15, delta: 0.5, gamma: 0.001, theta: -0.3, vega: 1.2, rho: null,
    };

    const [vixOut] = enrichQuotesWithModelGreeks([vix], 15.3, 'VIX');
    expect(vixOut.delta).toBe(vix.delta);
    expect(vixOut.gamma).toBe(vix.gamma);
    expect(vixOut.lambda ?? null).toBeNull();
    expect(vixOut.greeksMissingReason).toBe('futures_priced');

    const [spxOut] = enrichQuotesWithModelGreeks([spx], 6020, 'SPX');
    expect(spxOut.greeksSource).toBe('black-scholes');
    expect(spxOut.lambda).not.toBeNull();
    expect(spxOut.greeksMissingReason ?? null).toBeNull();
  });
});
