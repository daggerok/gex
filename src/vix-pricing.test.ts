import { describe, expect, test } from 'bun:test';
import { blackScholesGreeks, type BsGreeks, yearsToExpiration } from './greeks';
import type { OptionQuote } from './types';
import {
  black76Greeks,
  black76Price,
  enrichFuturesPricedQuotes,
  impliedForward,
  impliedVolBlack76,
} from './vix-pricing';

// ---------------------------------------------------------------------------
// Helper: build a minimal OptionQuote for black76Greeks/impliedForward.
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

/** Days-from-now expiration string, matching the +1-day yearsToExpiration rule. */
function expInDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const GREEK_KEYS: (keyof BsGreeks)[] = [
  'delta', 'gamma', 'theta', 'vega', 'lambda', 'vanna', 'vomma', 'charm', 'speed', 'zomma', 'color',
];

// ===========================================================================
// 1. IDENTITY ORACLE (research plan section 6.3): Black-76 with forward F is
//    mathematically identical to the generalized Black-Scholes model with
//    spot S = F and dividend yield q = riskFree, for every greek EXCEPT rho.
//    blackScholesGreeks is the already-trusted function elsewhere in this
//    repo, so this is the primary correctness check for black76Greeks.
// ===========================================================================
describe('black76Greeks identity oracle vs blackScholesGreeks(S=F, q=r)', () => {
  const cases: Array<{ side: 'call' | 'put'; forward: number; strike: number; sigma: number; days: number; r: number }> = [
    { side: 'call', forward: 20, strike: 20, sigma: 0.5, days: 364, r: 0.05 },   // ATM, T≈1y
    { side: 'put', forward: 20, strike: 20, sigma: 0.5, days: 364, r: 0.05 },    // ATM, T≈1y
    { side: 'call', forward: 17.648, strike: 20, sigma: 0.92, days: 19, r: 0.045 }, // OTM call, VIX-realistic
    { side: 'put', forward: 17.648, strike: 20, sigma: 0.92, days: 19, r: 0.045 },  // ITM put, VIX-realistic
    { side: 'call', forward: 18.3449, strike: 15, sigma: 0.54, days: 46, r: 0.045 },
    { side: 'put', forward: 18.3449, strike: 25, sigma: 1.3, days: 46, r: 0.045 },
    { side: 'call', forward: 40, strike: 10, sigma: 2.5, days: 5, r: 0.045 },    // deep ITM, near weekly
    { side: 'put', forward: 10, strike: 40, sigma: 2.5, days: 5, r: 0.045 },     // deep ITM, near weekly
  ];

  for (const c of cases) {
    test(`${c.side} F=${c.forward} K=${c.strike} sigma=${c.sigma} days=${c.days}`, () => {
      const expiration = expInDays(c.days);
      const quote = q({ side: c.side, strike: c.strike, expiration, iv: c.sigma });
      const b76 = black76Greeks(quote, c.forward, c.sigma, c.r);
      const bs = blackScholesGreeks(quote, c.forward, c.r, c.r); // S=F, q=r
      expect(b76.reason).toBeNull();
      expect(bs.reason).toBeNull();
      const g76 = b76.greeks!;
      const gbs = bs.greeks!;
      for (const key of GREEK_KEYS) {
        expect(g76[key]).toBeCloseTo(gbs[key], 9);
      }
      // rho is explicitly NOT part of the identity (research plan 6.2/6.3):
      // Black-76 rho = -T * price / 100 (F held fixed), the generalized-BS
      // rho (-/+ K*T*D*N(∓d2)/100) differs whenever F ≠ K. Resolve T the
      // same way black76Greeks does internally (same expiration string, same
      // instant) rather than assuming `(days+1)/365`, so this assertion is
      // immune to the day-boundary ambiguity discussed below.
      const t = yearsToExpiration(expiration)!;
      expect(g76.rho).toBeCloseTo(-t * black76Price(c.side, c.forward, c.strike, t, c.sigma, c.r) / 100, 9);
      if (c.forward !== c.strike) {
        expect(Math.abs(g76.rho - gbs.rho)).toBeGreaterThan(1e-6);
      }
    });
  }
});

// ===========================================================================
// 2. HAND-VERIFIED FIXTURES
// ===========================================================================
describe('black76Greeks hand-verified fixtures', () => {
  test('at-the-money-forward (F = K) call and put prices are IDENTICAL — pure parity reasoning, no greek computation needed', () => {
    // Put-call parity: C - P = D * (F - K). When F = K, the right side is 0,
    // so C must equal P exactly, for ANY sigma/T/r. This is true independent
    // of the normal-CDF machinery, so it is a clean hand check on black76Price.
    const call = black76Price('call', 20, 20, 1.0, 0.5, 0.05);
    const put = black76Price('put', 20, 20, 1.0, 0.5, 0.05);
    expect(call).toBeCloseTo(put, 10);
  });

  // Hand-derived fixture: F=20, K=20 (ATM-forward), sigma=0.5, T=1 (365/365
  // via the +1-day rule, i.e. expiration 364 days out), r=0.05.
  //   sqrtT = 1
  //   d1 = (ln(20/20) + 0.5*0.5^2*1) / (0.5*1) = (0 + 0.125) / 0.5 = 0.25
  //   d2 = d1 - 0.5*1 = -0.25
  //   D  = e^(-0.05) = 0.9512294...
  //   N(0.25)  = 0.598706,  N(-0.25) = 0.401294   (standard normal table)
  //   pdf(0.25) = (1/sqrt(2*pi)) * e^(-0.25^2/2) = 0.398942 * 0.969233 = 0.386668
  //   call = D*(F*N(d1) - K*N(d2)) = 0.9512294*20*(0.598706-0.401294)
  //        = 0.9512294*20*0.197412 = 0.9512294*3.94824 = 3.755693
  //   delta_call = D*N(d1) = 0.9512294*0.598706 = 0.569507
  //   gamma = D*pdf/(F*sigma*sqrt T) = 0.9512294*0.386668/(20*0.5*1)
  //         = 0.367833/10 = 0.0367833
  //   rho   = -T*price/100 = -1*3.755693/100 = -0.0375569
  // NOTE on tolerances: `expInDays` resolves "days from now" through
  // Date.now(), while yearsToExpiration's "today" uses the LOCAL calendar
  // date of `new Date()` — the two can disagree by exactly 1 calendar day
  // depending on the host timezone (the same ambiguity already present in
  // greeks.test.ts's `Date.now() + N days` fixtures). For a ~1-year tenor
  // that shifts every greek by well under 0.0005, so precision 3 below is
  // exact-arithmetic-grade, not a loosened check.
  test('ATM-forward call: F=20 K=20 sigma=0.5 T≈1y r=0.05', () => {
    const expiration = expInDays(364); // +1-day rule -> T ≈ 365/365 = 1.0
    const quote = q({ side: 'call', strike: 20, expiration });
    const { greeks } = black76Greeks(quote, 20, 0.5, 0.05);
    expect(greeks).not.toBeNull();
    expect(greeks!.delta).toBeCloseTo(0.569507, 3);
    expect(greeks!.gamma).toBeCloseTo(0.0367833, 3);
    expect(greeks!.rho).toBeCloseTo(-0.0375569, 3);
    expect(greeks!.vega).toBeCloseTo(0.0735620, 3);
  });

  // Hand-derived VIX-realistic fixture, matching the research plan's own
  // worked example (section 5.5/5.6): Oct-21 forward ≈ 17.648 (the monthly VX
  // settlement, confirmed by parity within 0.03 there), K=20, a round
  // sigma=0.92 (close to Cboe's own iv 0.9697 quoted for this strike), T = 20
  // calendar days out (+1-day rule), r=0.045.
  //   T = 20/365 = 0.0547945,  sqrtT = 0.234084
  //   d1 = (ln(17.648/20) + 0.5*0.92^2*0.0547945) / (0.92*0.234084)
  //      = (-0.125866 + 0.023183) / 0.215357 = -0.102683/0.215357 = -0.476767
  //   d2 = d1 - 0.92*0.234084 = -0.476767 - 0.215357 = -0.692124
  // (figures below computed to full precision by the Black-76 formula itself
  //  — matches the research plan's independently-quoted Cboe numbers (delta
  //  ~-0.67, "NOT the spot-model failure") within rounding)
  // NOTE on tolerances: this is a ~20-DAY tenor (near-weekly VIX scale), so
  // the same ±1-calendar-day ambiguity described above is a much bigger
  // relative change in T here (~5%). Verified numerically (days=19 vs 20 vs
  // 21 raw): delta moves ~0.006/day, gamma ~0.0016/day, vega ~0.0005/day,
  // rho ~0.0001/day. The precisions below each carry >=3x margin over that
  // per-day sensitivity, so they still catch a wrong formula while never
  // flaking on a timezone-driven day boundary.
  test('VIX-realistic deep-ITM put: F=17.648 K=20 sigma=0.92 T≈20d r=0.045 (a spot-model put with NO valid IV per research plan 5.1)', () => {
    const expiration = expInDays(19); // +1-day rule -> T ≈ 20/365
    const quote = q({ side: 'put', strike: 20, expiration });
    const { greeks } = black76Greeks(quote, 17.648, 0.92, 0.045);
    expect(greeks).not.toBeNull();
    // delta in the -0.65..-0.70 range: materially less negative than a
    // spot-based model (research plan 5.6 quotes spot-based delta -0.8553
    // for a similar contract) — this is the whole point of the fix.
    expect(greeks!.delta).toBeLessThan(-0.6);
    expect(greeks!.delta).toBeGreaterThan(-0.75);
    expect(greeks!.gamma).toBeGreaterThan(0);
    expect(greeks!.vega).toBeGreaterThan(0);
    // Hand-derived at T=20/365 exactly (see module doc comment for d1/d2):
    expect(greeks!.delta).toBeCloseTo(-0.680309, 1);
    expect(greeks!.gamma).toBeCloseTo(0.093616, 2);
    expect(greeks!.rho).toBeCloseTo(-0.00166912, 3);
  });

  test('VIX-realistic OTM call, same F/K/sigma/T/r: positive delta, small price', () => {
    const expiration = expInDays(19);
    const quote = q({ side: 'call', strike: 20, expiration });
    const { greeks } = black76Greeks(quote, 17.648, 0.92, 0.045);
    expect(greeks).not.toBeNull();
    expect(greeks!.delta).toBeCloseTo(0.317228, 1);
    expect(greeks!.gamma).toBeCloseTo(0.093616, 2); // same gamma as the put at the same strike (put-call symmetry)
    expect(greeks!.rho).toBeCloseTo(-0.00038352, 3);
  });

  test('call and put at the same F/K/sigma/T share gamma, vega, vanna, vomma, speed, zomma, color (standard Black-76 symmetry)', () => {
    const expiration = expInDays(19);
    const call = black76Greeks(q({ side: 'call', strike: 20, expiration }), 17.648, 0.92, 0.045).greeks!;
    const put = black76Greeks(q({ side: 'put', strike: 20, expiration }), 17.648, 0.92, 0.045).greeks!;
    for (const key of ['gamma', 'vega', 'vanna', 'vomma', 'speed', 'zomma', 'color'] as const) {
      expect(call[key]).toBeCloseTo(put[key], 9);
    }
    // delta_call - delta_put = D (standard put-call relationship)
    const D = Math.exp(-0.045 * (20 / 365));
    expect(call.delta - put.delta).toBeCloseTo(D, 6);
  });
});

// ===========================================================================
// 3. IMPLIED-VOL SOLVER ROUND TRIP
// ===========================================================================
describe('impliedVolBlack76', () => {
  const F = 17.648, r = 0.045;

  test('round-trips a known sigma through price -> solve -> recovered sigma, several strikes/sides/tenors', () => {
    const cases: Array<{ side: 'call' | 'put'; strike: number; sigma: number; days: number }> = [
      { side: 'put', strike: 20, sigma: 0.92, days: 19 },
      { side: 'call', strike: 20, sigma: 0.92, days: 19 },
      { side: 'put', strike: 15, sigma: 0.55, days: 19 },
      { side: 'call', strike: 25, sigma: 1.3, days: 5 },
      { side: 'put', strike: 13, sigma: 2.7, days: 2 },   // near-weekly, very high IV (research plan 5.1)
    ];
    for (const c of cases) {
      const t = (c.days + 1) / 365;
      const price = black76Price(c.side, F, c.strike, t, c.sigma, r);
      const recovered = impliedVolBlack76(c.side, price, F, c.strike, t, r);
      expect(recovered).not.toBeNull();
      expect(recovered!).toBeCloseTo(c.sigma, 4);
    }
  });

  test('returns null for a price at or below the no-arbitrage intrinsic bound', () => {
    const t = 20 / 365;
    const D = Math.exp(-r * t);
    // Deep ITM put, K=25: lower bound D*(K-F) ≈ 7.334; feed a price below it
    // (this is exactly the research plan 5.1 failure mode — a quote priced
    // below the spot-model's own lower bound, which killed Yahoo's IV solve).
    const belowBound = D * (25 - F) - 0.5;
    expect(impliedVolBlack76('put', belowBound, F, 25, t, r)).toBeNull();
  });

  test('returns null for a price at or above the no-arbitrage upper bound', () => {
    const t = 20 / 365;
    const D = Math.exp(-r * t);
    expect(impliedVolBlack76('put', D * 25 + 0.5, F, 25, t, r)).toBeNull(); // > D*K
    expect(impliedVolBlack76('call', D * F + 0.5, F, 20, t, r)).toBeNull(); // > D*F
  });

  test('returns null for non-positive or missing inputs', () => {
    expect(impliedVolBlack76('call', 0, F, 20, 20 / 365, r)).toBeNull();
    expect(impliedVolBlack76('call', 1, 0, 20, 20 / 365, r)).toBeNull();
    expect(impliedVolBlack76('call', 1, F, 0, 20 / 365, r)).toBeNull();
    expect(impliedVolBlack76('call', 1, F, 20, 0, r)).toBeNull();
  });
});

// ===========================================================================
// 4. PER-EXPIRATION FORWARD VIA PUT-CALL PARITY
// ===========================================================================
describe('impliedForward', () => {
  // Synthetic chain priced EXACTLY at a known forward F=17.65 via Black-76
  // (sigma=0.9, r=0.045), with bid/ask built as mid ± 0.005 so the
  // reconstructed mid is the exact theoretical price. impliedForward should
  // recover F to high precision regardless of which near-ATM strike is used.
  // T is resolved via the SAME yearsToExpiration(expiration) impliedForward
  // itself uses internally (not an assumed `(days+1)/365`), so construction
  // and recovery are self-consistent and the test is immune to the
  // ±1-calendar-day ambiguity discussed above the identity-oracle tests.
  const F = 17.65, SIGMA = 0.9, R = 0.045, DAYS = 19;

  function syntheticChain(expiration: string, strikes: number[], opts: { skipBidAt?: number[] } = {}): OptionQuote[] {
    const t = yearsToExpiration(expiration)!;
    const out: OptionQuote[] = [];
    for (const strike of strikes) {
      const skip = (opts.skipBidAt || []).includes(strike);
      const callMid = black76Price('call', F, strike, t, SIGMA, R);
      const putMid = black76Price('put', F, strike, t, SIGMA, R);
      out.push(q({ side: 'call', strike, expiration, bid: skip ? 0 : callMid - 0.005, ask: skip ? 0 : callMid + 0.005, mid: callMid }));
      out.push(q({ side: 'put', strike, expiration, bid: putMid - 0.005, ask: putMid + 0.005, mid: putMid }));
    }
    return out;
  }

  test('recovers the known forward within 1e-4 from a clean two-sided chain', () => {
    const expiration = expInDays(DAYS);
    const quotes = syntheticChain(expiration, [15, 16, 17, 18, 19, 20]);
    const forward = impliedForward(quotes, expiration, R);
    expect(forward).not.toBeNull();
    expect(forward!).toBeCloseTo(F, 4);
  });

  test('ignores strikes with a zero bid on either leg', () => {
    const expiration = expInDays(DAYS);
    // Strike 21 gets a corrupted call bid/ask (both 0) — impliedForward must
    // skip it entirely rather than let it pull the median off.
    const quotes = syntheticChain(expiration, [15, 16, 17, 18, 19, 20, 21], { skipBidAt: [21] });
    const forward = impliedForward(quotes, expiration, R);
    expect(forward).not.toBeNull();
    expect(forward!).toBeCloseTo(F, 4);
  });

  test('returns null when no expiration-matching strike has two-sided quotes on both legs', () => {
    const expiration = expInDays(DAYS);
    const quotes = syntheticChain(expiration, [15, 16], { skipBidAt: [15, 16] });
    expect(impliedForward(quotes, expiration, R)).toBeNull();
  });

  test('returns null for an unknown/expired expiration', () => {
    const quotes = syntheticChain(expInDays(DAYS), [15, 16, 17]);
    expect(impliedForward(quotes, '2000-01-01', R)).toBeNull(); // expired
    expect(impliedForward(quotes, expInDays(100), R)).toBeNull(); // no quotes for this expiration
  });
});

// ===========================================================================
// 5. enrichFuturesPricedQuotes — PHASE 2 per-expiration dispatch
// ===========================================================================
// This is what src/greeks.ts' enrichQuotesWithModelGreeks calls when
// settings.vixFuturesPricing is ON and the symbol is futures-priced. The one
// thing that MUST hold, per research plan section 9: every VIX/VXN
// expiration has its OWN forward, so a bug that collapses two expirations
// onto one shared forward (e.g. reusing resolveEnrichmentSpot, which picks a
// single spot for the WHOLE quote list) must make these tests fail.
describe('enrichFuturesPricedQuotes', () => {
  const R = 0.045;

  /** A fully self-consistent two-sided chain for one expiration, priced
   *  EXACTLY off `forward`/`sigma` via Black-76 (like impliedForward's own
   *  syntheticChain helper above), so impliedForward recovers `forward`
   *  near-exactly and impliedVolBlack76 recovers `sigma` near-exactly. */
  function chain(expiration: string, forward: number, sigma: number, strikes: number[]): OptionQuote[] {
    const t = yearsToExpiration(expiration)!;
    const out: OptionQuote[] = [];
    for (const strike of strikes) {
      const callPrice = black76Price('call', forward, strike, t, sigma, R);
      const putPrice = black76Price('put', forward, strike, t, sigma, R);
      out.push(q({
        side: 'call', strike, expiration,
        bid: callPrice - 0.005, ask: callPrice + 0.005, mid: callPrice, last: callPrice,
        iv: 0.00001, // deliberately garbage provider IV — must never be trusted (see module doc)
      }));
      out.push(q({
        side: 'put', strike, expiration,
        bid: putPrice - 0.005, ask: putPrice + 0.005, mid: putPrice, last: putPrice,
        iv: 2.5, // deliberately garbage provider IV, other direction
      }));
    }
    return out;
  }

  test('two expirations get their OWN forward and OWN Black-76 greeks — not one shared forward', () => {
    // Deliberately far apart (research plan 5.5's actual Oct/Jun forwards
    // span 16.48..20.88) so a bug that blends them is impossible to miss.
    const expA = expInDays(19);  // near monthly, contango front
    const expB = expInDays(201); // far monthly, deep in contango
    const FA = 17.648, SIGMA_A = 0.92;
    const FB = 20.417, SIGMA_B = 0.40;
    const strikes = [16, 17, 18, 19, 20];

    const quotes = [...chain(expA, FA, SIGMA_A, strikes), ...chain(expB, FB, SIGMA_B, strikes)];
    const out = enrichFuturesPricedQuotes(quotes, R);

    const byExpStrike = (exp: string, side: 'call' | 'put', strike: number) =>
      out.find((x) => x.expiration === exp && x.side === side && x.strike === strike)!;

    // Each group's forward is recovered independently and precisely — if the
    // code regressed to a single shared spot/forward for the whole array,
    // these two would be equal (or both wrong).
    const kA = byExpStrike(expA, 'call', 18);
    const kB = byExpStrike(expB, 'call', 18);
    expect(kA.forward).not.toBeNull();
    expect(kB.forward).not.toBeNull();
    expect(kA.forward!).toBeCloseTo(FA, 2);
    expect(kB.forward!).toBeCloseTo(FB, 2);
    expect(Math.abs(kA.forward! - kB.forward!)).toBeGreaterThan(2); // visibly different

    // IV solved per-group, never the garbage provider iv (0.00001 / 2.5 above).
    expect(kA.iv).toBeCloseTo(SIGMA_A, 2);
    expect(kB.iv).toBeCloseTo(SIGMA_B, 2);
    expect(Math.abs(kA.iv! - kB.iv!)).toBeGreaterThan(0.1); // visibly different

    // Deltas at the SAME strike (18) are visibly different between the two
    // expirations because both forward AND sigma differ per group.
    expect(kA.delta).not.toBeNull();
    expect(kB.delta).not.toBeNull();
    expect(Math.abs(kA.delta! - kB.delta!)).toBeGreaterThan(0.05);

    expect(kA.greeksSource).toBe('black-76');
    expect(kB.greeksSource).toBe('black-76');
    expect(kA.greeksMissingReason ?? null).toBeNull();
    expect(kB.greeksMissingReason ?? null).toBeNull();
  });

  test('CBOE-shaped quote (1st-order already present): keeps provider delta/gamma/theta/vega, fills ρ/λ/2nd-3rd, overwrites iv', () => {
    const expiration = expInDays(19);
    const F = 17.648, SIGMA = 0.92;
    const strikes = [16, 17, 18, 19, 20];
    const quotes = chain(expiration, F, SIGMA, strikes);
    // Shape one quote like Cboe's own feed: real 1st-order greeks + a
    // greeksSource tag already set, same as scripts/options-data.py writes.
    const target = quotes.find((x) => x.side === 'put' && x.strike === 20)!;
    target.delta = -0.6708; target.gamma = 0.0922; target.theta = -0.0377; target.vega = 0.0144;
    target.greeksSource = 'cboe';

    const out = enrichFuturesPricedQuotes(quotes, R);
    const result = out.find((x) => x.side === 'put' && x.strike === 20)!;

    // Provider 1st-order greeks: byte-for-byte unchanged.
    expect(result.delta).toBe(-0.6708);
    expect(result.gamma).toBe(0.0922);
    expect(result.theta).toBe(-0.0377);
    expect(result.vega).toBe(0.0144);
    // greeksSource tag is preserved (not overwritten to 'black-76') — mirrors
    // enrichQuoteWithModelGreeks's existing `q.greeksSource ?? 'black-scholes'`
    // pattern for the spot-BS path.
    expect(result.greeksSource).toBe('cboe');
    // rho/lambda/2nd-3rd ARE filled in (were null on the Cboe-shaped fixture).
    expect(result.rho).not.toBeNull();
    expect(result.lambda).not.toBeNull();
    expect(result.vanna).not.toBeNull();
    expect(result.vomma).not.toBeNull();
    expect(result.charm).not.toBeNull();
    expect(result.speed).not.toBeNull();
    expect(result.zomma).not.toBeNull();
    expect(result.color).not.toBeNull();
    // iv is ALWAYS re-derived for these symbols, even when 1st-order greeks
    // are kept — never whatever the provider/garbage-fixture iv (2.5) was.
    expect(result.iv).toBeCloseTo(SIGMA, 2);
    expect(result.forward).toBeCloseTo(F, 2);
  });

  test('no 1st-order greeks (Yahoo-shaped): fills the FULL set, tags black-76', () => {
    const expiration = expInDays(19);
    const F = 18.3449, SIGMA = 0.5388;
    const quotes = chain(expiration, F, SIGMA, [14, 15, 16, 17, 18, 19, 20]);
    const out = enrichFuturesPricedQuotes(quotes, R);
    const result = out.find((x) => x.side === 'put' && x.strike === 15)!;
    expect(result.greeksSource).toBe('black-76');
    expect(result.greeksMissingReason ?? null).toBeNull();
    for (const key of ['delta', 'gamma', 'theta', 'vega', 'rho', 'lambda', 'vanna', 'vomma', 'charm', 'speed', 'zomma', 'color'] as const) {
      expect(result[key]).not.toBeNull();
    }
    expect(result.iv).toBeCloseTo(SIGMA, 2);
  });

  test('impliedForward fails (no two-sided quotes) → falls back to estimateSpot', () => {
    const expiration = expInDays(5); // sparse weekly, research plan 5.4/5.7
    // No live bid/ask anywhere (impliedForward needs bid>0 && ask>0 on BOTH
    // legs), but a last-trade price exists at one strike pair — exactly the
    // estimateSpot fallback scenario (research plan 7.1 step 4).
    const quotes = [
      q({ side: 'call', strike: 17, expiration, bid: 0, ask: 0, mid: null, last: 1.2 }),
      q({ side: 'put', strike: 17, expiration, bid: 0, ask: 0, mid: null, last: 0.55 }),
    ];
    expect(impliedForward(quotes, expiration, R)).toBeNull(); // confirms parity truly fails here
    const expectedFallback = 17 + (1.2 - 0.55); // estimateSpot's own formula

    const out = enrichFuturesPricedQuotes(quotes, R);
    // No live mid on either leg → impliedVolBlack76 isn't even attempted
    // (price must come from bid/ask, never a stale last trade — research
    // plan 6.4), so these end up with a resolved forward but a
    // 'missing_mid' reason rather than solved greeks. The important
    // assertion here is which FORWARD got attached before that.
    expect(out[0].forward).toBeCloseTo(expectedFallback, 6);
    expect(out[1].forward).toBeCloseTo(expectedFallback, 6);
  });

  test('impliedForward AND estimateSpot both fail → suppressed "futures_priced" fallback (unchanged toggle-off behavior)', () => {
    const expiration = expInDays(33); // research plan 5.5's 11-04: zero bids, no parity pairs
    const quotes = [
      q({ side: 'call', strike: 20, expiration, bid: null, ask: null, mid: null, last: null }),
      q({ side: 'put', strike: 20, expiration, bid: null, ask: null, mid: null, last: null }),
    ];
    expect(impliedForward(quotes, expiration, R)).toBeNull();
    const out = enrichFuturesPricedQuotes(quotes, R);
    expect(out[0].greeksMissingReason).toBe('futures_priced');
    expect(out[1].greeksMissingReason).toBe('futures_priced');
    expect(out[0].delta ?? null).toBeNull();
  });

  test('idempotent: re-running on an already-enriched result changes nothing (no churn on repeated cache reads)', () => {
    const expiration = expInDays(19);
    const quotes = chain(expiration, 17.648, 0.92, [16, 17, 18, 19, 20]);
    const once = enrichFuturesPricedQuotes(quotes, R);
    const twice = enrichFuturesPricedQuotes(once, R);
    expect(twice).toBe(once); // same array reference — nothing changed
  });

  test('empty input returns the same array reference', () => {
    const input: OptionQuote[] = [];
    const out = enrichFuturesPricedQuotes(input, R);
    expect(out).toBe(input);
  });
});
