import { describe, expect, test } from 'bun:test';
import {
  CONTRACT_MULTIPLIER,
  GAMMA_FLIP_GRID_POINTS,
  GAMMA_FLIP_RANGE_PCT,
  SECOND_WALL_MIN_DISTANCE_PCT,
  computeGexLevels,
  computeGexProfile,
  computeMaxPain,
  computeOiVolumeTotals,
  computePCRatio,
  findCallPutWalls,
  findGammaFlipHypotheticalSpot,
  gexCall,
  gexPut,
  trimZeroBoundaries,
} from './gex';
import type { OptionQuote } from './types';

// Hand-built synthetic fixture (plan section 11). Every expected number below
// was derived by hand from these rows, not read back from the code.
//
// SPOT = 100 and every gamma = 0.01, so per contract:
//   gexCall = 0.01 * OI * 100 * 100 * 100 * 0.01 = 100 * OI
// i.e. netGex(K) = 100 * (callOi(K) - putOi(K)).
const SPOT = 100;
const G = 0.01;
const EXP_A = '2026-10-16';
const EXP_B = '2026-11-20';

function q(
  expiration: string,
  side: 'call' | 'put',
  strike: number,
  openInterest: number | null,
  gamma: number | null = G,
  volume: number | null = null,
): OptionQuote {
  return {
    symbol: `TEST${expiration}${side === 'call' ? 'C' : 'P'}${strike}`,
    expiration,
    side,
    strike,
    bid: null,
    ask: null,
    mid: null,
    last: null,
    volume,
    openInterest,
    iv: null,
    delta: null,
    gamma,
    theta: null,
    vega: null,
  };
}

// Aggregated across both expirations:
//   strike | callOi | putOi | netGex = 100*(c-p) | cumulative
//     90   |   100  |  500  |  -40000            |  -40000
//     95   |   100  |  300  |  -20000            |  -60000
//    100   |   300  |  200  |  +10000            |  -50000
//    105   |  1100  |  100  | +100000            |  +50000
//    106   |   850  |   50  |  +80000            | +130000
//    110   |   350  |   50  |  +30000            | +160000
//    115   |   520  |   20  |  +50000            | +210000
const FIXTURE: OptionQuote[] = [
  q(EXP_A, 'call', 90, 100, G, 10),
  q(EXP_A, 'call', 95, 100, G, 10),
  q(EXP_A, 'call', 100, 200, G, 10),
  q(EXP_B, 'call', 100, 100),
  q(EXP_A, 'call', 105, 600, G, 10),
  q(EXP_B, 'call', 105, 500),
  q(EXP_A, 'call', 106, 850, G, 10),
  q(EXP_B, 'call', 110, 350, G, 10),
  q(EXP_B, 'call', 115, 520, G, 10),
  q(EXP_A, 'put', 90, 300, G, 20),
  q(EXP_B, 'put', 90, 200),
  q(EXP_A, 'put', 95, 300, G, 15),
  q(EXP_A, 'put', 100, 200, G, 0),
  q(EXP_B, 'put', 105, 100),
  q(EXP_A, 'put', 106, 50, G, 0),
  q(EXP_B, 'put', 110, 50, G, 0),
  q(EXP_B, 'put', 115, 20, G, 0),
];

describe('gex constants + per-contract formula (7.1)', () => {
  test('named constants match the spec', () => {
    expect(CONTRACT_MULTIPLIER).toBe(100);
    expect(SECOND_WALL_MIN_DISTANCE_PCT).toBe(0.02);
  });

  test('gexCall = gamma * OI * 100 * spot^2 * 0.01, gexPut is its negation', () => {
    // 0.02 * 10 * 100 * 50^2 * 0.01 = 0.2 * 100 * 2500 * 0.01 = 500
    expect(gexCall(0.02, 10, 50)).toBeCloseTo(500, 9);
    expect(gexPut(0.02, 10, 50)).toBeCloseTo(-500, 9);
    expect(gexCall(G, 1, SPOT)).toBeCloseTo(100, 9);
  });
});

describe('computeGexProfile (7.2)', () => {
  test('aggregates by strike across expirations, sorted ascending', () => {
    const profile = computeGexProfile([...FIXTURE].reverse(), SPOT);
    expect(profile.map((p) => p.strike)).toEqual([90, 95, 100, 105, 106, 110, 115]);
    const expectedNet = [-40000, -20000, 10000, 100000, 80000, 30000, 50000];
    profile.forEach((p, i) => {
      expect(p.netGex).toBeCloseTo(expectedNet[i], 6);
      expect(p.netGex).toBeCloseTo(p.callGex + p.putGex, 9);
      expect(p.putGex).toBeLessThanOrEqual(0);
    });
    const k105 = profile[3];
    expect(k105.callOi).toBe(1100);
    expect(k105.putOi).toBe(100);
    expect(k105.callGex).toBeCloseTo(110000, 6);
    expect(k105.putGex).toBeCloseTo(-10000, 6);
    expect(k105.callVolume).toBe(10); // EXP_B row has null volume -> 0
    const k90 = profile[0];
    expect(k90.putOi).toBe(500);
    expect(k90.putVolume).toBe(20);
  });

  test('single-expiration slice only sees its own contracts', () => {
    const profile = computeGexProfile(FIXTURE.filter((x) => x.expiration === EXP_A), SPOT);
    // EXP_A only: 105 has no put row, 110/115 rows are all EXP_B.
    expect(profile.map((p) => p.strike)).toEqual([90, 95, 100, 105, 106]);
    const byStrike = new Map(profile.map((p) => [p.strike, p]));
    expect(byStrike.get(105)!.callOi).toBe(600);
    expect(byStrike.get(105)!.netGex).toBeCloseTo(60000, 6);
    expect(byStrike.get(90)!.netGex).toBeCloseTo(-20000, 6); // 100*(100-300)
    expect(byStrike.get(100)!.netGex).toBe(0); // 200 calls vs 200 puts, same gamma
  });

  test('null-gamma quotes are excluded entirely, not treated as gamma 0', () => {
    const withNulls = [
      ...FIXTURE,
      q(EXP_A, 'call', 100, 99999, null, 5000), // existing strike
      q(EXP_A, 'put', 120, 5000, null), // strike with only null-gamma quotes
    ];
    const base = computeGexProfile(FIXTURE, SPOT);
    const profile = computeGexProfile(withNulls, SPOT);
    expect(profile).toEqual(base);
    expect(profile.find((p) => p.strike === 120)).toBeUndefined();
    expect(profile.find((p) => p.strike === 100)!.callOi).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// findGammaFlipHypotheticalSpot (7.3, REWRITTEN): hypothetical-spot
// Black-Scholes recompute against the RAW quotes, not a scan over the
// already-at-real-spot profile. See the function's own doc comment in
// src/gex.ts for the full rationale, citations, and history.
// ---------------------------------------------------------------------------

/** Builds an OptionQuote carrying everything blackScholesGreeks needs (iv +
 *  expiration) so findGammaFlipHypotheticalSpot can actually recompute its
 *  gamma at an arbitrary hypothetical spot. */
function bsQuote(side: 'call' | 'put', strike: number, openInterest: number, iv: number, expiration: string): OptionQuote {
  return {
    symbol: `BS${expiration}${side === 'call' ? 'C' : 'P'}${strike}`,
    expiration,
    side,
    strike,
    bid: null,
    ask: null,
    mid: null,
    last: null,
    volume: null,
    openInterest,
    iv,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
  };
}

/** `daysFromNow` days ahead of "today" (LOCAL calendar date), as the
 *  "YYYY-MM-DD" string yearsToExpiration (src/greeks.ts) expects. Resolved
 *  against the current date at test-run time - not a hardcoded calendar
 *  date - so T stays exactly `(daysFromNow + 1) / 365` (yearsToExpiration's
 *  +1-day floor) regardless of which day the suite runs on, and this
 *  fixture never silently starts failing once a hardcoded date passes. */
function futureIsoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('findGammaFlipHypotheticalSpot (7.3, rewritten: hypothetical-spot Black-Scholes recompute)', () => {
  test('grid constants match the documented methodology (60 points, +/-20%)', () => {
    expect(GAMMA_FLIP_GRID_POINTS).toBe(60);
    expect(GAMMA_FLIP_RANGE_PCT).toBeCloseTo(0.20, 9);
  });

  // Hand-derived fixture: a put at strike 90 (OI 500) and a call at strike
  // 110 (OI 500), both iv = 0.2 and T = 30 calendar days, spot = 100.
  //
  // Black-Scholes gamma has NO side-dependence (blackScholesGreeks computes
  // the same `gamma` expression for a call and a put at the same
  // strike/iv/T - see src/greeks.ts), so as the hypothetical S sweeps from
  // spot*0.8=80 to spot*1.2=120: the put's gamma (and so its NEGATIVE
  // dollar-GEX) peaks near S=90 and dominates at the low end; the call's
  // gamma (POSITIVE dollar-GEX) peaks near S=110 and dominates at the high
  // end. The aggregate total therefore goes from negative to positive
  // exactly once in between.
  //
  // Independently verified (not just "whatever the implementation
  // outputs"): a separate Python reimplementation of the identical
  // closed-form BS gamma (using math.erf directly, NOT src/greeks.ts's
  // Abramowitz-Stegun erf approximation) bisects the TRUE root of
  // total(S) at S ~= 98.9686, and separately confirms that linearly
  // interpolating between the two 60-point/+-20% grid points flanking it
  // (~98.3051 and ~98.9831) lands at ~98.96855 - a ~0.00005 difference from
  // the true root, i.e. this grid is dense enough here for the
  // interpolation error to be negligible.
  const T_DAYS = 29; // yearsToExpiration's +1-day floor makes this T = 30/365
  const IV = 0.2;
  const EXPECTED_CROSSING = 98.9686;

  test('hand-derived two-leg fixture lands the pos crossing within the independently bisected root', () => {
    const exp = futureIsoDate(T_DAYS);
    const combined = [bsQuote('put', 90, 500, IV, exp), bsQuote('call', 110, 500, IV, exp)];

    const result = findGammaFlipHypotheticalSpot(combined, 100);
    expect(result.neg).toBeNull();
    expect(result.pos).not.toBeNull();
    expect(result.pos as number).toBeCloseTo(EXPECTED_CROSSING, 1);
  });

  test('multi-expiration sum: neither leg alone crosses zero - only the genuine combined total across both expirations does', () => {
    // Same two legs as the fixture above, but explicitly on two DIFFERENT
    // expiration strings, proving the crossing comes from summing across
    // every expiration present in `quotes` (same as computeGexProfile),
    // not from reading just one of them.
    const expA = futureIsoDate(T_DAYS);
    const expB = futureIsoDate(T_DAYS + 5); // different expiration, same ballpark T
    const putLeg = [bsQuote('put', 90, 500, IV, expA)];
    const callLeg = [bsQuote('call', 110, 500, IV, expB)];

    // A lone put: BS gamma > 0 everywhere, so its dollar-GEX is negative at
    // every hypothetical S in the sweep - never crosses zero by itself.
    expect(findGammaFlipHypotheticalSpot(putLeg, 100)).toEqual({ pos: null, neg: null });
    // A lone call: positive at every S - never crosses either.
    expect(findGammaFlipHypotheticalSpot(callLeg, 100)).toEqual({ pos: null, neg: null });

    // Only the genuine sum across BOTH expirations crosses zero.
    const combined = findGammaFlipHypotheticalSpot([...putLeg, ...callLeg], 100);
    expect(combined.neg).toBeNull();
    expect(combined.pos).not.toBeNull();
    expect(combined.pos as number).toBeGreaterThan(90);
    expect(combined.pos as number).toBeLessThan(110);
  });

  test('non-finite or non-positive spot -> both null', () => {
    const quotes = [bsQuote('call', 100, 10, IV, futureIsoDate(30))];
    expect(findGammaFlipHypotheticalSpot(quotes, 0)).toEqual({ pos: null, neg: null });
    expect(findGammaFlipHypotheticalSpot(quotes, -5)).toEqual({ pos: null, neg: null });
    expect(findGammaFlipHypotheticalSpot(quotes, NaN)).toEqual({ pos: null, neg: null });
  });

  test('empty quotes, or quotes with no IV (cannot recompute BS gamma at any hypothetical S) -> both null', () => {
    expect(findGammaFlipHypotheticalSpot([], 100)).toEqual({ pos: null, neg: null });
    // iv: null quotes (the plain q() helper below never sets iv, matching
    // FIXTURE) can never resolve a BS gamma at ANY hypothetical S - iv
    // doesn't vary with S - so they are excluded from every grid point,
    // same as computeGexProfile's null-gamma exclusion, just one level up.
    const noIv = [q(EXP_A, 'call', 100, 500), q(EXP_A, 'put', 90, 500)];
    expect(findGammaFlipHypotheticalSpot(noIv, 100)).toEqual({ pos: null, neg: null });
  });

  test('zero open-interest quotes never contribute, regardless of iv', () => {
    const exp = futureIsoDate(T_DAYS);
    const quotes = [bsQuote('call', 110, 0, IV, exp), bsQuote('put', 90, 0, IV, exp)];
    expect(findGammaFlipHypotheticalSpot(quotes, 100)).toEqual({ pos: null, neg: null });
  });

  test('futures-priced quotes (carrying a resolved `forward`) are excluded entirely from the sweep', () => {
    const exp = futureIsoDate(T_DAYS);
    const normal = [bsQuote('put', 90, 500, IV, exp), bsQuote('call', 110, 500, IV, exp)];
    const withForward: OptionQuote[] = normal.map((qx) => ({ ...qx, forward: 50 }));
    // Every quote carries a (nonsensical, deliberately wrong) forward ->
    // all excluded -> no eligible quotes -> both null, same as an empty
    // array, NOT the normal crossing the un-forwarded pair alone produces.
    expect(findGammaFlipHypotheticalSpot(withForward, 100)).toEqual({ pos: null, neg: null });

    // Mixing one forward-carrying (excluded) quote alongside the normal
    // pair must land the EXACT SAME crossing as the normal pair alone - the
    // forward-carrying quote is fully ignored, not just down-weighted.
    const extraForwardNoise: OptionQuote = { ...bsQuote('call', 70, 999999, IV, exp), forward: 12.34 };
    const withNoise = [...normal, extraForwardNoise];
    expect(findGammaFlipHypotheticalSpot(withNoise, 100)).toEqual(findGammaFlipHypotheticalSpot(normal, 100));
  });
});

describe('findCallPutWalls (7.4)', () => {
  test('primary walls + second walls honoring the 2%-of-spot distance', () => {
    // min distance = 0.02 * 100 = 2.
    // callWall = 105 (+100000). Next-highest positive is 106 (+80000), but
    // |106-105| = 1 < 2, so callWall2 = 115 (+50000) instead.
    // putWall = 90 (-40000); putWall2 = 95 (-20000), |95-90| = 5 >= 2.
    expect(findCallPutWalls(computeGexProfile(FIXTURE, SPOT), SPOT)).toEqual({
      callWall: 105,
      putWall: 90,
      callWall2: 115,
      putWall2: 95,
    });
  });

  test('second wall is null when nothing qualifies; ties pick the lowest strike', () => {
    // EXP_A nets: 90:-20000, 95:-20000, 100:0, 105:+60000, 106:+80000.
    // callWall 106; only other positive is 105 (distance 1) -> callWall2 null.
    // 90 and 95 tie at -20000 -> putWall 90, putWall2 95.
    const profile = computeGexProfile(FIXTURE.filter((x) => x.expiration === EXP_A), SPOT);
    expect(findCallPutWalls(profile, SPOT)).toEqual({
      callWall: 106,
      putWall: 90,
      callWall2: null,
      putWall2: 95,
    });
  });

  test('no negative netGex -> put walls null', () => {
    const callsOnly = computeGexProfile(FIXTURE.filter((x) => x.side === 'call'), SPOT);
    const walls = findCallPutWalls(callsOnly, SPOT);
    expect(walls.putWall).toBeNull();
    expect(walls.putWall2).toBeNull();
    expect(walls.callWall).toBe(105); // 1100 calls is the biggest call strike
  });
});

describe('computeMaxPain (7.5)', () => {
  test('picks the strike minimizing total holder payout', () => {
    // payout(90)  = puts 300*5 + 200*10 + 100*15 + 50*16 + 50*20 + 20*25 = 7300
    // payout(95)  = calls 100*5 = 500; puts 200*5 + 100*10 + 50*11 + 50*15 + 20*20 = 3700 -> 4200
    // payout(100) = calls 100*10 + 100*5 = 1500; puts 100*5 + 50*6 + 50*10 + 20*15 = 1600 -> 3100
    // payout(105) = calls 1500 + 1000 + 300*5 = 4000; puts 50*1 + 50*5 + 20*10 = 500 -> 4500
    // payout(106) = calls 1600 + 1100 + 1800 + 1100*1 = 5600; puts 200 + 180 -> 5980
    expect(computeMaxPain(FIXTURE)).toBe(100);
  });

  test('null only for empty input', () => {
    expect(computeMaxPain([])).toBeNull();
    expect(computeMaxPain([q(EXP_A, 'call', 50, 0)])).toBe(50);
  });
});

describe('computePCRatio (7.6)', () => {
  test('by OI and by volume', () => {
    // putOi = 500+300+200+100+50+50+20 = 1220; callOi = 100+100+300+1100+850+350+520 = 3320
    // putVolume = 20+15 = 35; callVolume = 7 * 10 = 70
    const pcr = computePCRatio(FIXTURE);
    expect(pcr.byOi).toBeCloseTo(1220 / 3320, 12);
    expect(pcr.byVolume).toBeCloseTo(0.5, 12);
  });

  test('null when the call-side denominator is 0', () => {
    expect(computePCRatio(FIXTURE.filter((x) => x.side === 'put'))).toEqual({ byOi: null, byVolume: null });
    expect(computePCRatio([q(EXP_A, 'call', 100, 10, G, 0), q(EXP_A, 'put', 100, 5, G, 3)])).toEqual({
      byOi: 0.5,
      byVolume: null,
    });
  });
});

describe('computeOiVolumeTotals', () => {
  test('plain call/put sums, null-gamma and null OI/volume rows included as 0', () => {
    // Same hand sums as the P/C ratio test above.
    expect(computeOiVolumeTotals(FIXTURE)).toEqual({ callOi: 3320, putOi: 1220, callVolume: 70, putVolume: 35 });
    // A null-gamma row still counts (unlike computeGexProfile); null OI counts as 0.
    const extra = [...FIXTURE, q(EXP_A, 'call', 100, 7, null, 2), q(EXP_A, 'put', 100, null, G, null)];
    expect(computeOiVolumeTotals(extra)).toEqual({ callOi: 3327, putOi: 1220, callVolume: 72, putVolume: 35 });
    expect(computeOiVolumeTotals([])).toEqual({ callOi: 0, putOi: 0, callVolume: 0, putVolume: 0 });
  });
});

// ---------------------------------------------------------------------------
// Phase 3 of .plans/gex-vix-futures-pricing-research.txt: a quote carrying
// its own `forward` (VIX/VXN with settings.vixFuturesPricing on and Black-76
// enrichment succeeding, src/vix-pricing.ts) must use THAT forward in place
// of the shared `spot` parameter — section 9's "GEX for VIX" fix. Every test
// above this point passes quotes with no `forward` field at all, so they are
// an implicit regression guard: none of them changed when this file's
// computeGexProfile loop started reading `q.forward ?? spot` per quote.
// ---------------------------------------------------------------------------
describe('computeGexProfile honors a per-quote forward over the shared spot (Phase 3, section 9)', () => {
  // Hand-derived: gexCall(gamma, OI, ref) = gamma * OI * 100 * ref^2 * 0.01.
  // F = 17.648 (the real 2026-10-21 VIX monthly forward from the research
  // plan's 5.5 snapshot). gamma = 0.02 for both legs.
  //   call@20, OI=1000: 0.02 * 1000 * 100 * 17.648^2 * 0.01 = 6229.03808
  //   put@15,  OI=400:  -(0.02 * 400  * 100 * 17.648^2 * 0.01) = -2491.615232
  const F = 17.648;
  const EXP_V = '2026-10-21';

  function vq(side: 'call' | 'put', strike: number, openInterest: number, forward: number | null): OptionQuote {
    return { ...q(EXP_V, side, strike, openInterest, 0.02), forward };
  }

  test('a wildly wrong `spot` argument is ignored once every quote carries its own forward', () => {
    const quotes = [vq('call', 20, 1000, F), vq('put', 15, 400, F)];
    // Pass an obviously-wrong spot (the true app spot for VIX, ~15.31, would
    // already be wrong for this expiration's forward — 999 is deliberately
    // absurd so a bug that still reads `spot` anywhere is impossible to miss).
    const profile = computeGexProfile(quotes, 999);
    const byStrike = new Map(profile.map((p) => [p.strike, p]));
    expect(byStrike.get(20)!.callGex).toBeCloseTo(6229.03808, 3);
    expect(byStrike.get(15)!.putGex).toBeCloseTo(-2491.615232, 3);
    const totalNet = profile.reduce((sum, p) => sum + p.netGex, 0);
    expect(totalNet).toBeCloseTo(6229.03808 - 2491.615232, 3);
  });

  test('a quote without `forward` still falls back to the shared spot (SPX-family path unaffected)', () => {
    // Same two VIX-shaped rows as above, plus one ordinary quote with no
    // `forward` field at all (exactly what every SPX-family/equity quote
    // looks like) sharing a strike with one of them.
    const mixed = [
      vq('call', 20, 1000, F),
      vq('put', 15, 400, F),
      q(EXP_V, 'call', 100, 1, 0.01), // no `forward` -> must use the spot param
    ];
    const profile = computeGexProfile(mixed, 100);
    const byStrike = new Map(profile.map((p) => [p.strike, p]));
    // gexCall(0.01, 1, 100) = 0.01*1*100*100^2*0.01 = 100.
    expect(byStrike.get(100)!.callGex).toBeCloseTo(100, 6);
    // The forward-bearing rows are completely unaffected by spot=100 (would
    // be 0.01*1000*100*100^2*0.01=100000 if spot leaked in instead of 17.648).
    expect(byStrike.get(20)!.callGex).toBeCloseTo(6229.03808, 3);
  });

  test('findCallPutWalls on a forward-priced profile: strikes and signs are exactly as for the shared-spot path', () => {
    // Only two strikes, opposite signs -> each is trivially its own wall.
    const quotes = [vq('call', 20, 1000, F), vq('put', 15, 400, F)];
    const profile = computeGexProfile(quotes, 999); // spot param irrelevant here too
    const walls = findCallPutWalls(profile, F); // caller passes nearest-expiration forward, not spot (section 9)
    expect(walls.callWall).toBe(20);
    expect(walls.putWall).toBe(15);
  });

  test('computeGexLevels end-to-end for a single futures-priced expiration', () => {
    const quotes = [vq('call', 20, 1000, F), vq('put', 15, 400, F)];
    const levels = computeGexLevels(quotes, F); // F used as the "spot" arg (section 9 design)
    expect(levels.callWall).toBe(20);
    expect(levels.putWall).toBe(15);
    expect(levels.totalNetGex).toBeCloseTo(6229.03808 - 2491.615232, 3);
    // gammaFlip: both quotes here carry a resolved `forward` (vq() sets it),
    // i.e. they are the futures-priced (VIX/VXN-shaped) case -
    // findGammaFlipHypotheticalSpot excludes every quote carrying a
    // resolved `forward` entirely (Black-Scholes is the wrong model for
    // them - see its own doc comment in src/gex.ts), so with no eligible
    // quote left, both directions are null here. This is the expected,
    // explicitly out-of-scope behavior for this rework - NOT a regression:
    // real levels for a futures-priced symbol are never shown anyway unless
    // settings.vixFuturesPricing enables a dedicated Black-76 path, and this
    // hypothetical-spot sweep deliberately does not attempt that (flagged in
    // the PR).
    expect(levels.gammaFlipPos).toBeNull();
    expect(levels.gammaFlipNeg).toBeNull();
    expect(levels.gammaFlip).toBeNull();
  });
});

describe('computeGexLevels (7.7)', () => {
  test('assembles every level from one call', () => {
    const levels = computeGexLevels(FIXTURE, SPOT);
    expect(levels.spot).toBe(SPOT);
    // FIXTURE's q() helper never sets `iv` (it only carries a pre-supplied
    // `gamma`, which is all computeGexProfile/findCallPutWalls/computeMaxPain
    // need). findGammaFlipHypotheticalSpot recomputes gamma from `iv` at each
    // hypothetical spot, so a quote with no `iv` can never be priced at ANY
    // hypothetical S and is excluded from the sweep entirely - with every
    // quote excluded, both directions stay null (see findGammaFlipHypothetic
    // alSpot's own dedicated describe block above for the real BS-driven
    // fixture/crossing tests). totalNetGex (210000, asserted below) is
    // positive, so gammaFlip (the derived legacy field) picks gammaFlipPos.
    expect(levels.gammaFlipPos).toBeNull();
    expect(levels.gammaFlipNeg).toBeNull();
    expect(levels.gammaFlip).toBeNull();
    expect(levels.callWall).toBe(105);
    expect(levels.putWall).toBe(90);
    expect(levels.callWall2).toBe(115);
    expect(levels.putWall2).toBe(95);
    expect(levels.maxPain).toBe(100);
    expect(levels.pcRatioOi).toBeCloseTo(1220 / 3320, 12);
    expect(levels.pcRatioVolume).toBeCloseTo(0.5, 12);
    // -40000 - 20000 + 10000 + 100000 + 80000 + 30000 + 50000
    expect(levels.totalNetGex).toBeCloseTo(210000, 6);
  });

  test('empty chain slice', () => {
    expect(computeGexLevels([], SPOT)).toEqual({
      spot: SPOT,
      gammaFlip: null,
      gammaFlipPos: null,
      gammaFlipNeg: null,
      callWall: null,
      putWall: null,
      callWall2: null,
      putWall2: null,
      maxPain: null,
      pcRatioOi: null,
      pcRatioVolume: null,
      totalNetGex: 0,
    });
  });
});

describe('trimZeroBoundaries (GEX tab chart axis trimming, section 8.1 part 3)', () => {
  // Minimal SPX-shaped fixture mirroring the user's own worked example:
  // real (non-zero) data runs 7025..8150, flanked on both sides by strikes
  // where every metric is 0 - 7000 (one below 7025) and 8175/8200 (two above
  // the last real strike, 8150) - at $25 spacing like real SPX chains.
  function point(strike: number, netGex: number, callOi = 0, putOi = 0): { strike: number; netGex: number; callOi: number; putOi: number } {
    return { strike, netGex, callOi, putOi };
  }
  const spxLike = [
    point(6975, 0),
    point(7000, 0), // boundary zero strike that should survive the left trim
    point(7025, -500), // lowest non-zero strike
    point(7050, 1200),
    point(8150, 800), // highest non-zero strike
    point(8175, 0), // boundary zero strike that should survive the right trim
    point(8200, 0),
    point(8225, 0),
  ];

  test('(a) keeps exactly one boundary-zero strike per edge, drops the rest - all metrics selected', () => {
    const trimmed = trimZeroBoundaries(spxLike, ['netGex', 'callOi', 'putOi']);
    // Left edge: 6975 (second zero strike out) is dropped, 7000 (the one
    // adjacent to the first non-zero strike, 7025) survives.
    // Right edge: 8175 is the last strike shown (one past 8150); 8200/8225
    // are dropped entirely, matching the user's exact worked example.
    expect(trimmed.map((p) => p.strike)).toEqual([7000, 7025, 7050, 8150, 8175]);
  });

  test('(b) re-evaluates "zero" against only the live metric selection (Put OI alone, Net GEX not selected)', () => {
    // Every strike (including the "real data" ones) carries the SAME non-zero
    // Net GEX noise - if the check were hardcoded to Net GEX (or looked at
    // every field instead of only the live selection), nothing would ever
    // trim. Only putOi actually distinguishes real strikes from boundary
    // ones here, so a correct, selection-scoped check must still trim
    // exactly like the all-metrics case above.
    const putOiFixture = [
      point(6975, 999, 0, 0),
      point(7000, 999, 0, 0),
      point(7025, 999, 0, 400), // lowest strike with non-zero putOi
      point(7050, 999, 0, 900),
      point(8150, 999, 0, 250), // highest strike with non-zero putOi
      point(8175, 999, 0, 0),
      point(8200, 999, 0, 0),
    ];
    const trimmed = trimZeroBoundaries(putOiFixture, ['putOi']);
    expect(trimmed.map((p) => p.strike)).toEqual([7000, 7025, 7050, 8150, 8175]);

    // Sanity check the scoping the other way too: selecting 'netGex' on this
    // same fixture (where it's uniformly 999, i.e. never zero) must trim
    // nothing at all - confirming the function only looks at the keys it's
    // given, not every numeric field on the point.
    expect(trimZeroBoundaries(putOiFixture, ['netGex']).map((p) => p.strike)).toEqual(putOiFixture.map((p) => p.strike));
  });

  test('entirely-zero profile returns empty (pathological case, no crash)', () => {
    const allZero = [point(100, 0), point(101, 0), point(102, 0)];
    expect(trimZeroBoundaries(allZero, ['netGex'])).toEqual([]);
  });

  test('fewer than 2 points, or no keys, returns the input unchanged', () => {
    const one = [point(100, 5)];
    expect(trimZeroBoundaries(one, ['netGex'])).toEqual(one);
    expect(trimZeroBoundaries(spxLike, [])).toEqual(spxLike);
  });
});
