/// <reference types="bun" />
/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BS_DIVIDEND_YIELD,
  GAMMA_INVERSION_MAX_IV,
  GAMMA_INVERSION_MIN_IV,
  GAMMA_INVERSION_TOLERANCE,
  blackScholesGamma,
  impliedVolFromGamma,
  FUTURES_PRICED_SYMBOLS,
  INDEX_DIVIDEND_YIELDS,
  INDEX_SYMBOLS,
  SPX_DIVIDEND_YIELD,
  blackScholesGreeks,
  dividendYieldForSymbol,
  enrichChainResult,
  enrichQuoteWithModelGreeks,
  enrichQuotesWithModelGreeks,
  isFuturesPricedSymbol,
  MIN_MINUTES_TO_EXPIRATION,
  setValuationTime,
  AM_SETTLEMENT_ET,
  isAmSettled,
  isExpired,
  isQuoteExpired,
  optionRoot,
  quoteYearsToExpiration,
  withoutExpiredQuotes,
  yearsToExpiration,
} from './greeks';
import { marketDate, zonedTimeToMs } from './backtest/snapshot';
import type { ChainResult, OptionQuote } from './types';
import { black76Price } from './vix-pricing';

const root = join(__dirname, '..');

/** Frozen pricing clock (GEX-M1: T is the real time to the 16:00 New York settlement): 16:00 New York on Monday 2026-03-09,
 *  the day after the spring daylight saving switch (the next one is 2026-11-01). */
const CLOCK = zonedTimeToMs(2026, 3, 9, 16, 0);
beforeAll(() => setValuationTime(CLOCK));
afterAll(() => setValuationTime(null));

/** Expiration `days + 1` days after the frozen clock: T = (days + 1) / 365, the numbers the hand-derived fixtures were made
 *  with under the old "+1 day" rule. */
function expInDays(days: number): string {
  return new Date(Date.UTC(2026, 2, 9 + days + 1)).toISOString().slice(0, 10);
}
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Pull the string members out of `const SUPPORTED_INDEX_SYMBOLS = new Set([...])`. */
function proxyIndexSymbols(src: string): string[] {
  const m = /const SUPPORTED_INDEX_SYMBOLS = new Set\(\[([^\]]*)\]\)/.exec(src);
  if (!m) throw new Error('SUPPORTED_INDEX_SYMBOLS not found');
  return Array.from(m[1].matchAll(/"([A-Z]+)"/g)).map((x) => x[1]).sort();
}

describe('index symbols', () => {
  test('INDEX_SYMBOLS is exactly the verified index set', () => {
    expect(Array.from(INDEX_SYMBOLS).sort()).toEqual(['DJX', 'NDX', 'RUT', 'SPX', 'XSP']);
  });

  test('every index symbol has its own yield entry', () => {
    expect(Array.from(INDEX_SYMBOLS).sort()).toEqual(Object.keys(INDEX_DIVIDEND_YIELDS).sort());
  });

  test('VIX (futures-priced) and OEX (dead chain) are not supported', () => {
    expect(INDEX_SYMBOLS.has('VIX')).toBe(false);
    expect(INDEX_SYMBOLS.has('OEX')).toBe(false);
  });

  test('api/Indices.txt matches INDEX_SYMBOLS', () => {
    const lines = read('api/Indices.txt').split('\n').map((l) => l.trim()).filter(Boolean).sort();
    expect(lines).toEqual(Array.from(INDEX_SYMBOLS).sort());
  });

  test('the local proxy mirrors INDEX_SYMBOLS in SUPPORTED_INDEX_SYMBOLS', () => {
    const expected = Array.from(INDEX_SYMBOLS).sort();
    expect(proxyIndexSymbols(read('scripts/options-local-proxy.ts'))).toEqual(expected);
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
    expiration: expInDays(90),
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
// agentic-workspace docs/repos/gex/spec-vix-futures.md for the full investigation.
// ---------------------------------------------------------------------------
describe('futures-priced symbols (VIX, VXN)', () => {
  test('FUTURES_PRICED_SYMBOLS is exactly VIX and VXN', () => {
    expect(Array.from(FUTURES_PRICED_SYMBOLS).sort()).toEqual(['VIX', 'VXN']);
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
      expiration: expInDays(30),
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
    const exp = expInDays(30);
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

// ---------------------------------------------------------------------------
// PHASE 2: wiring settings.vixFuturesPricing into enrichQuotesWithModelGreeks
// / enrichChainResult. The toggle's OWN default (false) must reproduce
// exactly what shipped in Phase 1 — see agentic-workspace docs/repos/gex/spec-vix-futures.md
// sections 7-9 and src/vix-pricing.ts for the per-expiration
// Black-76 math this dispatches to when the toggle is on.
// ---------------------------------------------------------------------------
describe('vixFuturesPricing toggle wiring (Phase 2)', () => {
  function cboeVixQuote(overrides: Partial<OptionQuote> = {}): OptionQuote {
    return {
      symbol: 'VIX261015C00020000',
      expiration: expInDays(30),
      side: 'call',
      strike: 20,
      bid: 0.5, ask: 0.6, mid: 0.55, last: 0.55,
      volume: 10, openInterest: 100,
      iv: 0.9,
      delta: 0.4, gamma: 0.05, theta: -0.01, vega: 0.02, rho: 0.001,
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // REGRESSION: toggle OFF (explicit, and the parameter's own default) must
  // be byte-for-byte identical to the pre-Phase-2 suppressed behavior — the
  // exact fixture and assertions from the "futures-priced symbols" describe
  // block above, just with the 4th argument spelled out explicitly so a
  // reviewer can see this is testing the toggle, not relying on an implicit
  // default.
  // -------------------------------------------------------------------------
  test('toggle OFF (explicit false): VIX quote is suppressed exactly as before this PR; non-VIX (SPX) unaffected', () => {
    const exp = expInDays(30);
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

    const [vixOff] = enrichQuotesWithModelGreeks([vix], 15.3, 'VIX', false);
    const [vixDefault] = enrichQuotesWithModelGreeks([vix], 15.3, 'VIX'); // no 4th arg at all
    expect(vixOff).toEqual(vixDefault); // explicit false === omitted (default)
    expect(vixOff.delta).toBe(vix.delta);
    expect(vixOff.gamma).toBe(vix.gamma);
    expect(vixOff.theta).toBe(vix.theta);
    expect(vixOff.vega).toBe(vix.vega);
    expect(vixOff.rho).toBe(vix.rho);
    expect(vixOff.iv).toBe(vix.iv); // NOT re-solved when the toggle is off
    expect(vixOff.forward ?? null).toBeNull(); // no Black-76 path reached at all
    for (const k of ['lambda', 'vanna', 'vomma', 'charm', 'speed', 'zomma', 'color'] as const) {
      expect(vixOff[k] ?? null).toBeNull();
    }
    expect(vixOff.greeksMissingReason).toBe('futures_priced');

    // Non-VIX quote: completely unaffected by the toggle's value, either way.
    const [spxOff] = enrichQuotesWithModelGreeks([spx], 6020, 'SPX', false);
    const [spxOn] = enrichQuotesWithModelGreeks([spx], 6020, 'SPX', true);
    expect(spxOff).toEqual(spxOn);
    expect(spxOff.greeksSource).toBe('black-scholes');
    expect(spxOff.lambda).not.toBeNull();
    expect(spxOff.forward ?? null).toBeNull();
  });

  test('enrichChainResult: toggle OFF reproduces the pre-Phase-2 summary (fallbackSource black-scholes, cboeMatched counts provider 1st-order)', () => {
    const exp = expInDays(30);
    const result: ChainResult = {
      symbol: 'VIX',
      underlyingPrice: 15.3,
      expirations: [exp],
      quotes: [cboeVixQuote({ expiration: exp })],
    };
    const off = enrichChainResult(result, false);
    const omitted = enrichChainResult(result); // no 2nd arg at all
    expect(off).toEqual(omitted);
    expect(off.greeks?.fallbackSource).toBe('black-scholes');
    expect(off.greeks?.cboeMatched).toBe(1);
    expect(off.quotes[0].greeksMissingReason).toBe('futures_priced');
  });

  // -------------------------------------------------------------------------
  // Toggle ON: dispatches to the real per-expiration Black-76 path.
  // A self-consistent chain, priced exactly off a known forward/sigma via
  // black76Price (same technique as src/vix-pricing.test.ts), so the market
  // prices actually respect no-arbitrage bounds at every strike.
  // -------------------------------------------------------------------------
  function syntheticVixChain(expiration: string, forward: number, sigma: number, strikes: number[]): OptionQuote[] {
    const t = yearsToExpiration(expiration)!;
    const out: OptionQuote[] = [];
    for (const strike of strikes) {
      const callPrice = black76Price('call', forward, strike, t, sigma, 0.045);
      const putPrice = black76Price('put', forward, strike, t, sigma, 0.045);
      out.push({
        symbol: `VIXC${strike}`, expiration, side: 'call', strike,
        bid: callPrice - 0.005, ask: callPrice + 0.005, mid: callPrice, last: callPrice,
        volume: 10, openInterest: 50, iv: 0.00001, // garbage provider iv — must be ignored
        delta: null, gamma: null, theta: null, vega: null,
      });
      out.push({
        symbol: `VIXP${strike}`, expiration, side: 'put', strike,
        bid: putPrice - 0.005, ask: putPrice + 0.005, mid: putPrice, last: putPrice,
        volume: 10, openInterest: 50, iv: 2.5, // garbage provider iv, other direction
        delta: null, gamma: null, theta: null, vega: null,
      });
    }
    return out;
  }

  test('toggle ON: a VIX quote with a resolvable forward gets REAL Black-76 greeks, not the suppressed state', () => {
    const exp = expInDays(19);
    const quotes = syntheticVixChain(exp, 17.648, 0.92, [16, 17, 18, 19, 20]);
    const [sample] = enrichQuotesWithModelGreeks(quotes, 15.3, 'VIX', true);
    expect(sample.greeksSource).toBe('black-76');
    expect(sample.greeksMissingReason ?? null).toBeNull();
    expect(sample.forward).not.toBeNull();
    expect(sample.forward!).toBeCloseTo(17.648, 1);
    expect(sample.delta).not.toBeNull();
    expect(sample.lambda).not.toBeNull();
    // Garbage provider iv (0.00001 / 2.5) must be gone, replaced by a solved one.
    expect(sample.iv).not.toBe(0.00001);
    expect(sample.iv).not.toBe(2.5);
    expect(sample.iv!).toBeCloseTo(0.92, 1);
  });

  test('enrichChainResult: toggle ON reports fallbackSource black-76 and counts black-76 rows as computed', () => {
    const exp = expInDays(19);
    const quotes = syntheticVixChain(exp, 17.648, 0.92, [16, 17, 18, 19, 20]);
    const result: ChainResult = { symbol: 'VIX', underlyingPrice: 15.3, expirations: [exp], quotes };
    const on = enrichChainResult(result, true);
    expect(on.greeks?.fallbackSource).toBe('black-76');
    expect(on.greeks?.computed).toBe(quotes.length);
    expect(on.greeks?.missing).toBe(0);
  });

  test('two VIX expirations in the same enrichChainResult call get DIFFERENT forwards (section 9: no shared spot)', () => {
    const expA = expInDays(19);
    const expB = expInDays(201);
    const quotes = [
      ...syntheticVixChain(expA, 17.648, 0.92, [16, 17, 18, 19, 20]),
      ...syntheticVixChain(expB, 20.417, 0.40, [16, 17, 18, 19, 20]),
    ];
    const result: ChainResult = { symbol: 'VIX', underlyingPrice: 15.3, expirations: [expA, expB], quotes };
    const on = enrichChainResult(result, true);
    const a18 = on.quotes.find((q) => q.expiration === expA && q.side === 'call' && q.strike === 18)!;
    const b18 = on.quotes.find((q) => q.expiration === expB && q.side === 'call' && q.strike === 18)!;
    expect(a18.forward!).toBeCloseTo(17.648, 1);
    expect(b18.forward!).toBeCloseTo(20.417, 1);
    expect(Math.abs(a18.forward! - b18.forward!)).toBeGreaterThan(2);
    expect(Math.abs(a18.delta! - b18.delta!)).toBeGreaterThan(0.05);
    expect(on.greeks?.computed).toBe(quotes.length);
  });
});

// ---------------------------------------------------------------------------
// GREP-BASED PARITY: every call site that needs to forward
// settings.vixFuturesPricing actually does. Mirrors the existing
// "both proxies mirror INDEX_SYMBOLS" parity test above — this is the
// equivalent check for "did I miss updating one spot" on the toggle,
// specifically called out as worth having given how easy that is to miss.
// ---------------------------------------------------------------------------
describe('vixFuturesPricing call-site parity', () => {
  const loaderSrc = read('src/providers/loader.ts');
  const mainSrc = read('src/main.tsx');
  const chainSrc = read('src/gex-chain.ts');

  test('every enrichChainResult / enrichQuotesWithModelGreeks call in providers/loader.ts forwards vixFuturesPricing', () => {
    const calls = loaderSrc
      .split('\n')
      .filter((l) => /\b(enrichChainResult|enrichQuotesWithModelGreeks)\(/.test(l));
    // Sanity: there really are calls to check — if this count ever drops to
    // 0 the loop below would pass vacuously and hide a real regression.
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const line of calls) {
      expect(line).toContain('vixFuturesPricing');
    }
  });

  test('every loader entry point that can enrich (getBulk/putBulk/loadMeta/loadExpiration) accepts vixFuturesPricing', () => {
    for (const sig of [
      'export async function getBulk(providerId: string, symbol: string, vixFuturesPricing: boolean = false)',
      'export async function putBulk(providerId: string, result: ChainResult, vixFuturesPricing: boolean = false)',
      'export async function loadMeta(provider: DataProvider, symbol: string, ctx: ProviderContext, vixFuturesPricing: boolean = false)',
      'export async function loadExpiration(provider: DataProvider, symbol: string, expiration: string, ctx: ProviderContext, vixFuturesPricing: boolean = false)',
    ]) {
      expect(loaderSrc).toContain(sig);
    }
  });

  test('main.tsx (and gex-chain.ts for the bulk read) pass settings.vixFuturesPricing to every loadMeta/loadExpiration/getBulk call site', () => {
    for (const snippet of [
      'await loadMeta(p, sym, ctx, settings.vixFuturesPricing)',
      'await loadExpiration(provider, meta.symbol, exp, ctxFor(settings, provider, ac.signal), settings.vixFuturesPricing)',
      'useGexQuotesByExp(meta, provider, settings.vixFuturesPricing, expData, chainSymbol)',
    ]) {
      expect(mainSrc).toContain(snippet);
    }
    expect(chainSrc).toContain('getBulk(provider.id, meta.symbol, vixFuturesPricing)');
    // Sanity: exactly one real call site each (ignoring comments/changelog
    // prose, which also mention these names) — if a second call site is
    // ever added without updating this test, this count check (not the
    // .toContain calls above) is what catches the silent gap.
    const codeLines = mainSrc.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l));
    const countCalls = (re: RegExp) => codeLines.filter((l) => re.test(l)).length;
    expect(countCalls(/\bloadMeta\(/)).toBe(1);
    // two: loadChain, and the background prefetch of every expiration for lazy providers
    expect(countCalls(/\bloadExpiration\(/)).toBe(2);
    const prefetchLine = codeLines.filter((l) => /\bloadExpiration\(/.test(l) && l.includes('settings.vixFuturesPricing'));
    expect(prefetchLine.length).toBe(2);
    expect(countCalls(/\bgetBulk\(/)).toBe(0); // the bulk read lives in gex-chain.ts since GEX-H1
    expect(chainSrc.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l) && /\bgetBulk\(/.test(l)).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// IV from the provider gamma (repair of failed-solve IVs, owner-approved 2026-10-25)
// ---------------------------------------------------------------------------
describe('blackScholesGamma / impliedVolFromGamma', () => {
  const T = 30 / 365;

  test('blackScholesGamma is the gamma of blackScholesGreeks', () => {
    const exp = expInDays(29); // T = 30/365
    const full = blackScholesGreeks({ side: 'call', strike: 105, expiration: exp, iv: 0.2, last: null, mid: null, bid: null, ask: null }, 100);
    expect(blackScholesGamma(100, 105, 30 / 365, 0.2) as number).toBeCloseTo(full.greeks?.gamma as number, 12);
    expect(blackScholesGamma(100, 105, 0, 0.2)).toBeNull();
    expect(blackScholesGamma(100, 105, T, 0)).toBeNull();
  });

  test('at the money there is one root: the gamma of 20% gives back 20%', () => {
    const g = blackScholesGamma(100, 100, T, 0.2) as number;
    expect(impliedVolFromGamma(100, 100, T, g) as number).toBeCloseTo(0.2, 6);
  });

  test('out of the money two vols share a gamma: the one nearest to the reference wins, else the higher one', () => {
    // strike 110, T 30 days: gamma peaks near sigma * sqrt(T) = ln(110/100) -> sigma ~ 0.33; 0.15 sits on the rising side
    const g = blackScholesGamma(100, 110, T, 0.15) as number;
    expect(impliedVolFromGamma(100, 110, T, g, 0.16) as number).toBeCloseTo(0.15, 6);
    const high = impliedVolFromGamma(100, 110, T, g) as number;
    expect(high).toBeGreaterThan(0.4);
    expect(blackScholesGamma(100, 110, T, high) as number).toBeCloseTo(g, 9);
  });

  test('a gamma a little above any Black-Scholes gamma gives the closest vol, far above it gives null', () => {
    let peak = 0;
    for (let s = 0.05; s < 3; s *= 1.01) peak = Math.max(peak, blackScholesGamma(100, 110, T, s) as number);
    const near = impliedVolFromGamma(100, 110, T, peak * 1.1) as number;
    expect(near).not.toBeNull();
    expect(blackScholesGamma(100, 110, T, near) as number).toBeCloseTo(peak, 6);
    expect(impliedVolFromGamma(100, 110, T, peak * (1 + GAMMA_INVERSION_TOLERANCE) * 1.5)).toBeNull();
    expect(impliedVolFromGamma(100, 110, T, 0)).toBeNull();
  });

  test('the result stays within 5% .. 300%', () => {
    const g = blackScholesGamma(100, 100, T, 0.01) as number; // a 1% vol: far more gamma than 5% can give
    expect(impliedVolFromGamma(100, 100, T, g)).toBeNull();
    const r = impliedVolFromGamma(100, 100, T, blackScholesGamma(100, 100, T, 0.06) as number) as number;
    expect(r).toBeGreaterThanOrEqual(GAMMA_INVERSION_MIN_IV);
    expect(r).toBeLessThanOrEqual(GAMMA_INVERSION_MAX_IV);
  });
});

// ---------------------------------------------------------------------------
// Time to expiration (GEX-M1, owner-approved 2026-10-25; New York day, GEX-L2)
// ---------------------------------------------------------------------------
describe('yearsToExpiration: real time to the 16:00 New York settlement', () => {
  const HOUR = 1 / (365 * 24);
  const ny = (y: number, m: number, d: number, h: number, min = 0) => new Date(zonedTimeToMs(y, m, d, h, min));

  test('0DTE at 15:00 New York is one hour, not a day (the old "+1 day" rule gave 1/365)', () => {
    expect(yearsToExpiration('2026-10-23', ny(2026, 10, 23, 15)) as number).toBeCloseTo(HOUR, 12);
    expect(yearsToExpiration('2026-10-23', ny(2026, 10, 23, 9, 30)) as number).toBeCloseTo(6.5 * HOUR, 12);
  });

  test('1DTE and a week out count the real hours to the settlement', () => {
    expect(yearsToExpiration('2026-10-23', ny(2026, 10, 22, 12)) as number).toBeCloseTo(28 * HOUR, 12);
    expect(yearsToExpiration('2026-10-30', ny(2026, 10, 23, 16)) as number).toBeCloseTo(7 / 365, 12);
  });

  test('15-minute floor up to the settlement, null after 16:00 on the expiration day (batch 4) and from the next day', () => {
    expect(MIN_MINUTES_TO_EXPIRATION).toBe(15);
    const floor = 0.25 * HOUR;
    expect(yearsToExpiration('2026-10-23', ny(2026, 10, 23, 15, 50)) as number).toBeCloseTo(floor, 12);
    // exactly at the settlement (a day archive valued at the 16:00 close) the floor still holds
    expect(yearsToExpiration('2026-10-23', ny(2026, 10, 23, 16)) as number).toBeCloseTo(floor, 12);
    // after it the options expiring today are over, no floor for them
    expect(yearsToExpiration('2026-10-23', ny(2026, 10, 23, 16, 1))).toBeNull();
    expect(yearsToExpiration('2026-10-23', ny(2026, 10, 23, 23, 59))).toBeNull();
    expect(yearsToExpiration('2026-10-23', ny(2026, 10, 24, 0, 1))).toBeNull();
    expect(yearsToExpiration('not-a-date', ny(2026, 10, 23, 12))).toBeNull();
  });

  test('the day is the New York one, whatever the browser time zone (GEX-L2)', () => {
    // 2026-10-23 19:45 UTC is 15:45 in New York: the 10-23 expiration has 15 minutes left, though a browser in Europe
    // already shows the evening
    expect(yearsToExpiration('2026-10-23', new Date(Date.UTC(2026, 9, 23, 19, 45))) as number).toBeCloseTo(0.25 * HOUR, 12);
    // 2026-10-23 03:00 UTC is 2026-10-22 23:00 in New York: 17 hours to the 16:00 settlement of the 23rd
    expect(yearsToExpiration('2026-10-23', new Date(Date.UTC(2026, 9, 23, 3))) as number).toBeCloseTo(17 * HOUR, 12);
  });

  test('across the autumn daylight saving switch a week is 7 days and 1 hour (16:00 EDT -> 16:00 EST)', () => {
    expect(yearsToExpiration('2026-11-06', ny(2026, 10, 30, 16)) as number).toBeCloseTo(7 / 365 + HOUR, 12);
  });
});

describe('AM-settled SPX, NDX and RUT monthlies and expired quotes (batch 4, owner 2026-10-25)', () => {
  const HOUR = 1 / (365 * 24);
  const ny = (y: number, m: number, d: number, h: number, min = 0) => new Date(zonedTimeToMs(y, m, d, h, min));
  // 2026-11-20 is the 3rd Friday of November
  const spx = { expiration: '2026-11-20', symbol: 'SPX261120C06000000' };
  const spxw = { expiration: '2026-11-20', symbol: 'SPXW261120C06000000' };

  test('the option root tells SPX (AM) from SPXW (PM)', () => {
    expect(optionRoot('SPXW261026C06000000')).toBe('SPXW');
    expect(optionRoot('SPX261120P05500000')).toBe('SPX');
    expect(optionRoot('BRK.B261120C00500000')).toBe('BRK.B');
    expect(optionRoot('garbage')).toBe('');
    expect(isAmSettled(spx.symbol)).toBe(true);
    expect(isAmSettled(spxw.symbol)).toBe(false);
    expect(isAmSettled('SPY261120C00600000')).toBe(false);
    expect(isAmSettled(undefined)).toBe(false);
    expect(AM_SETTLEMENT_ET).toEqual({ hour: 9, minute: 30 });
  });

  test('NDX and RUT monthlies are AM-settled too, their NDXP and RUTW twins are not (owner 2026-10-25)', () => {
    expect(isAmSettled('NDX261120C21000000')).toBe(true);
    expect(isAmSettled('RUT261120P02400000')).toBe(true);
    expect(isAmSettled('NDXP261120C21000000')).toBe(false);
    expect(isAmSettled('RUTW261120P02400000')).toBe(false);
    expect(isAmSettled('QQQ261120C00500000')).toBe(false);
    expect(isAmSettled('IWM261120C00200000')).toBe(false);
    const ndx = { expiration: '2026-11-20', symbol: 'NDX261120C21000000' };
    const ndxp = { expiration: '2026-11-20', symbol: 'NDXP261120C21000000' };
    const rut = { expiration: '2026-11-20', symbol: 'RUT261120P02400000' };
    const rutw = { expiration: '2026-11-20', symbol: 'RUTW261120P02400000' };
    expect(quoteYearsToExpiration(ndx, ny(2026, 11, 20, 9, 20)) as number).toBeCloseTo(0.25 * HOUR, 12);
    expect(quoteYearsToExpiration(rut, ny(2026, 11, 20, 9, 31))).toBeNull();
    expect(quoteYearsToExpiration(ndxp, ny(2026, 11, 20, 15)) as number).toBeCloseTo(HOUR, 12);
    expect(withoutExpiredQuotes([ndx, ndxp, rut, rutw], ny(2026, 11, 20, 10))).toEqual([ndxp, rutw]);
  });

  test('an AM-settled quote counts to 9:30 New York and is over after it, its SPXW twin to 16:00', () => {
    expect(quoteYearsToExpiration(spx, ny(2026, 11, 19, 16)) as number).toBeCloseTo(17.5 * HOUR, 12);
    expect(quoteYearsToExpiration(spx, ny(2026, 11, 20, 9, 20)) as number).toBeCloseTo(0.25 * HOUR, 12);
    expect(quoteYearsToExpiration(spx, ny(2026, 11, 20, 9, 31))).toBeNull();
    expect(quoteYearsToExpiration(spxw, ny(2026, 11, 20, 9, 31)) as number).toBeCloseTo((6.5 * 60 - 1) / 60 * HOUR, 12);
    // no symbol: PM settlement
    expect(quoteYearsToExpiration({ expiration: '2026-11-20' }, ny(2026, 11, 20, 15)) as number).toBeCloseTo(HOUR, 12);
  });

  test('isExpired (a date) uses 16:00; isQuoteExpired also drops an AM quote after 9:30', () => {
    expect(isExpired('2026-11-20', ny(2026, 11, 20, 12))).toBe(false);
    expect(isExpired('2026-11-20', ny(2026, 11, 20, 16))).toBe(false);
    expect(isExpired('2026-11-20', ny(2026, 11, 20, 16, 1))).toBe(true);
    expect(isExpired('2026-11-19', ny(2026, 11, 20, 1))).toBe(true);
    expect(isExpired('bad', ny(2026, 11, 20, 1))).toBe(false);
    expect(isQuoteExpired(spx, ny(2026, 11, 20, 9, 30))).toBe(false);
    expect(isQuoteExpired(spx, ny(2026, 11, 20, 9, 31))).toBe(true);
    expect(isQuoteExpired(spxw, ny(2026, 11, 20, 9, 31))).toBe(false);
    expect(isQuoteExpired(spxw, ny(2026, 11, 20, 16, 1))).toBe(true);
    // an SPX quote of a later expiration is not touched on another day's morning
    expect(isQuoteExpired({ expiration: '2026-12-18', symbol: 'SPX261218C06000000' }, ny(2026, 11, 20, 10))).toBe(false);
  });

  test('withoutExpiredQuotes keeps the live quotes in order', () => {
    const later = { expiration: '2026-11-27', symbol: 'SPXW261127C06000000' };
    expect(withoutExpiredQuotes([spx, spxw, later], ny(2026, 11, 20, 10))).toEqual([spxw, later]);
    expect(withoutExpiredQuotes([spx, spxw, later], ny(2026, 11, 20, 16, 30))).toEqual([later]);
    expect(withoutExpiredQuotes([spx, spxw, later], ny(2026, 11, 20, 9))).toEqual([spx, spxw, later]);
  });

  test('blackScholesGreeks says expired for an AM quote after 9:30 (valuation time of a backtest)', () => {
    setValuationTime(zonedTimeToMs(2026, 11, 20, 10, 0));
    try {
      const base = { side: 'call' as const, strike: 6000, expiration: '2026-11-20', iv: 0.2, last: null, mid: null, bid: null, ask: null };
      expect(blackScholesGreeks({ ...base, symbol: spx.symbol }, 6000).reason).toBe('expired');
      expect(blackScholesGreeks({ ...base, symbol: spxw.symbol }, 6000).reason).toBeNull();
    } finally {
      setValuationTime(CLOCK);
    }
  });
});

describe('market clock helpers', () => {
  test('zonedTimeToMs: New York wall time in summer and winter', () => {
    expect(zonedTimeToMs(2026, 10, 23, 16, 0)).toBe(Date.UTC(2026, 9, 23, 20, 0));
    expect(zonedTimeToMs(2026, 12, 4, 16, 0)).toBe(Date.UTC(2026, 11, 4, 21, 0));
    expect(zonedTimeToMs(2026, 11, 1, 16, 0)).toBe(Date.UTC(2026, 10, 1, 21, 0)); // the switch day itself
  });

  test('marketDate is the New York calendar date (not the trading day)', () => {
    expect(marketDate(new Date(Date.UTC(2026, 9, 24, 2)))).toBe('2026-10-23');
    expect(marketDate(new Date(Date.UTC(2026, 9, 24, 5)))).toBe('2026-10-24'); // a Saturday stays Saturday
  });
});
