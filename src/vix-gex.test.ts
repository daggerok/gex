import { describe, expect, test } from 'bun:test';
import { computeGexLevels, computeGexProfile, findCallPutWalls } from './gex';
import { yearsToExpiration } from './greeks';
import type { OptionQuote } from './types';
import { black76Greeks, black76Price, enrichFuturesPricedQuotes } from './vix-pricing';

// ---------------------------------------------------------------------------
// Integration test for Phase 3 of .claude/docs/spec-vix-futures.md
// (section 9 "GEX and chart implications"): a REAL multi-expiration VIX chain
// - built the same way Phase 2's enrichFuturesPricedQuotes tests build one
//   (src/vix-pricing.test.ts: synthetic bid/ask priced exactly off a known
//   forward/sigma via black76Price, so impliedForward/impliedVolBlack76
//   recover them near-exactly) - run through the REAL enrichment pipeline
//   (src/vix-pricing.ts) and then the REAL GEX math (src/gex.ts), confirming
//   gamma exposure is correctly attributed to EACH expiration's own forward,
//   not silently blended into one shared number the way the pre-Phase-3 code
//   (one scalar `spot` for every quote) would have done.
// ---------------------------------------------------------------------------

function q(overrides: Partial<OptionQuote> & { side: 'call' | 'put'; strike: number; expiration: string }): OptionQuote {
  return {
    symbol: `TEST${overrides.expiration}${overrides.side === 'call' ? 'C' : 'P'}${overrides.strike}`,
    bid: null, ask: null, mid: null, last: null,
    volume: null, openInterest: null, iv: null,
    delta: null, gamma: null, theta: null, vega: null,
    ...overrides,
  };
}

function expInDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** A self-consistent two-sided chain for one expiration, priced exactly off
 *  `forward`/`sigma` via Black-76 (same technique as vix-pricing.test.ts's
 *  own `chain()` helper), with open interest attached. */
function chain(expiration: string, forward: number, sigma: number, strikes: number[], r: number, callOi: number, putOi: number): OptionQuote[] {
  const t = yearsToExpiration(expiration)!;
  const out: OptionQuote[] = [];
  for (const strike of strikes) {
    const callPrice = black76Price('call', forward, strike, t, sigma, r);
    const putPrice = black76Price('put', forward, strike, t, sigma, r);
    out.push(q({
      side: 'call', strike, expiration, openInterest: callOi,
      bid: callPrice - 0.005, ask: callPrice + 0.005, mid: callPrice, last: callPrice,
      iv: 0.00001, // garbage provider IV - must never be trusted
    }));
    out.push(q({
      side: 'put', strike, expiration, openInterest: putOi,
      bid: putPrice - 0.005, ask: putPrice + 0.005, mid: putPrice, last: putPrice,
      iv: 2.5, // garbage provider IV, other direction
    }));
  }
  return out;
}

describe('GEX for a multi-expiration VIX chain (Phase 3, section 9)', () => {
  const R = 0.045;
  // Deliberately far apart, like the research plan's own real snapshot (5.5:
  // forwards spanning 16.48..20.88 across the listed expirations) and like
  // Phase 2's own enrichFuturesPricedQuotes test.
  const expA = expInDays(19);  // near monthly, contango front
  const expB = expInDays(201); // far monthly, deep in contango
  const FA = 17.648, SIGMA_A = 0.92;
  const FB = 20.417, SIGMA_B = 0.40;
  const strikes = [16, 17, 18, 19, 20]; // same strike grid on both expirations
  const CALL_OI = 1000, PUT_OI = 500;

  test('each expiration is enriched with its own forward and gamma (sanity check before the GEX assertions)', () => {
    const rawA = chain(expA, FA, SIGMA_A, strikes, R, CALL_OI, PUT_OI);
    const rawB = chain(expB, FB, SIGMA_B, strikes, R, CALL_OI, PUT_OI);
    const enrichedA = enrichFuturesPricedQuotes(rawA, R);
    const enrichedB = enrichFuturesPricedQuotes(rawB, R);
    for (const arr of [enrichedA, enrichedB]) {
      for (const qq of arr) {
        expect(qq.forward).not.toBeNull();
        expect(qq.gamma).not.toBeNull();
        expect(qq.greeksSource).toBe('black-76');
      }
    }
    expect(enrichedA[0].forward).toBeCloseTo(FA, 2);
    expect(enrichedB[0].forward).toBeCloseTo(FB, 2);
  });

  test('combined profile at a shared strike equals the SUM of each expiration\'s own independently-computed contribution', () => {
    const rawA = chain(expA, FA, SIGMA_A, strikes, R, CALL_OI, PUT_OI);
    const rawB = chain(expB, FB, SIGMA_B, strikes, R, CALL_OI, PUT_OI);
    const enrichedA = enrichFuturesPricedQuotes(rawA, R);
    const enrichedB = enrichFuturesPricedQuotes(rawB, R);
    // The REAL multi-expiration call: both expirations enriched TOGETHER in
    // one array, exactly like gexQuotesByExp flattened for 2+ selected
    // expirations in src/use-gex-levels.ts.
    const combined = enrichFuturesPricedQuotes([...rawA, ...rawB], R);

    // An absurd `spot` argument: every quote here carries its own `forward`,
    // so computeGexProfile must never fall back to it - if it did, this
    // value would show up in the result and the assertions below would fail.
    const ABSURD_SPOT = 1;

    const profileCombined = computeGexProfile(combined, ABSURD_SPOT);
    const profileA = computeGexProfile(enrichedA, ABSURD_SPOT);
    const profileB = computeGexProfile(enrichedB, ABSURD_SPOT);

    for (const strike of strikes) {
      const combinedPoint = profileCombined.find((p) => p.strike === strike)!;
      const aPoint = profileA.find((p) => p.strike === strike)!;
      const bPoint = profileB.find((p) => p.strike === strike)!;
      expect(combinedPoint.callGex).toBeCloseTo(aPoint.callGex + bPoint.callGex, 6);
      expect(combinedPoint.putGex).toBeCloseTo(aPoint.putGex + bPoint.putGex, 6);
      expect(combinedPoint.netGex).toBeCloseTo(aPoint.netGex + bPoint.netGex, 6);
      expect(combinedPoint.callOi).toBe(CALL_OI * 2);
      expect(combinedPoint.putOi).toBe(PUT_OI * 2);
    }

    // The two expirations' contributions at the SAME strike (18) are visibly
    // different - different forward -> different gamma -> different GEX.
    // A bug that blended the two forwards (or reused one shared `spot`)
    // would make these collapse toward each other instead.
    const aAt18 = profileA.find((p) => p.strike === 18)!;
    const bAt18 = profileB.find((p) => p.strike === 18)!;
    expect(Math.abs(aAt18.callGex - bAt18.callGex)).toBeGreaterThan(1000);

    // Hand-verified arithmetic (same rigor as gex.test.ts's FIXTURE comment):
    // gexCall(gamma, OI, F) = gamma * OI * 100 * F^2 * 0.01 = gamma * OI * F^2.
    // Black-76 gamma at K=18, computed directly from the INPUT forward/sigma
    // (not solved back), per .claude/docs/spec-vix-futures.md 6.2:
    //   gammaA(F=17.648, sigma=0.92, T=20/365) = 0.104696440...
    //   gammaB(F=20.417, sigma=0.40, T=202/365) = 0.054377089...
    // so with OI=1000 on both call legs:
    //   gexCall_A(18) = 0.104696440 * 1000 * 17.648^2 = 32607.9057...
    //   gexCall_B(18) = 0.054377089 * 1000 * 20.417^2 = 22667.3011...
    // The solved-back IV (via impliedVolBlack76, bisection, 1e-6 price
    // tolerance) recovers the input sigma to within ~1e-5, so the actual
    // enriched gamma matches this hand calculation to within a fraction of a
    // percent - verified with a relative tolerance below, not an exact digit
    // count, precisely because it goes through the IV solver (unlike the
    // gex.test.ts single-expiration test, which sets gamma directly).
    const t18A = yearsToExpiration(expA)!;
    const t18B = yearsToExpiration(expB)!;
    const sigmaA18 = enrichedA.find((x) => x.side === 'call' && x.strike === 18)!.iv!;
    const sigmaB18 = enrichedB.find((x) => x.side === 'call' && x.strike === 18)!.iv!;
    expect(sigmaA18).toBeCloseTo(SIGMA_A, 3);
    expect(sigmaB18).toBeCloseTo(SIGMA_B, 3);
    const expectedGexA18 = black76Greeks(q({ side: 'call', strike: 18, expiration: expA }), FA, SIGMA_A, R).greeks!.gamma * CALL_OI * FA * FA;
    const expectedGexB18 = black76Greeks(q({ side: 'call', strike: 18, expiration: expB }), FB, SIGMA_B, R).greeks!.gamma * CALL_OI * FB * FB;
    expect(expectedGexA18).toBeCloseTo(32607.9057, 2);
    expect(expectedGexB18).toBeCloseTo(22667.3011, 2);
    const relErrA = Math.abs(aAt18.callGex - expectedGexA18) / expectedGexA18;
    const relErrB = Math.abs(bAt18.callGex - expectedGexB18) / expectedGexB18;
    expect(relErrA).toBeLessThan(0.01);
    expect(relErrB).toBeLessThan(0.01);
    expect(t18A).toBeGreaterThan(0);
    expect(t18B).toBeGreaterThan(0);
  });

  test('computeGexLevels / findCallPutWalls on the combined chain: walls and gamma flip are sane, not NaN/blended garbage', () => {
    const rawA = chain(expA, FA, SIGMA_A, strikes, R, CALL_OI, PUT_OI);
    const rawB = chain(expB, FB, SIGMA_B, strikes, R, CALL_OI, PUT_OI);
    const combined = enrichFuturesPricedQuotes([...rawA, ...rawB], R);

    // Section 9 design decision: the caller (src/use-gex-levels.ts) passes
    // the nearest selected expiration's OWN forward as the "spot" argument,
    // not the true spot VIX index - exercised here directly.
    const levels = computeGexLevels(combined, FA);
    expect(levels.totalNetGex).toBeCloseTo(
      computeGexProfile(combined, FA).reduce((sum, p) => sum + p.netGex, 0),
      6,
    );
    // Every strike here has far more call OI (1000) than put OI (500) and a
    // realistic positive Black-76 gamma on both sides, so every strike's
    // netGex is positive on both expirations -> no sign crossing -> no flip.
    // (Still a meaningful check: a bug that corrupted one expiration's
    // forward/gamma into NaN or a wildly wrong sign would either throw or
    // produce a flip/walls inconsistent with "more calls than puts
    // everywhere", and this assertion would catch the NaN case outright.)
    expect(Number.isFinite(levels.totalNetGex)).toBe(true);
    expect(levels.totalNetGex).toBeGreaterThan(0);
    expect(levels.callWall).not.toBeNull();
    expect(levels.putWall).toBeNull(); // no strike is net-negative

    const walls = findCallPutWalls(computeGexProfile(combined, FA), FA);
    expect(walls.callWall).not.toBeNull();
    expect(Number.isFinite(walls.callWall!)).toBe(true);
  });
});
