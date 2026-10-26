/// <reference types="bun" />
/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  CONTRACT_MULTIPLIER,
  CONTRACT_MULTIPLIER_BY_FUTURES_ROOT,
  contractMultiplier,
  futuresRoot,
  GAMMA_FLIP_GRID_POINTS,
  GAMMA_FLIP_RANGE_PCT,
  NET_GEX_PLUS_MINUS_MIN_DISTANCE_PCT,
  NET_GEX_PLUS_MINUS_DISTANCE_BY_SYMBOL,
  netGexPlusMinusMinDistance,
  computeGexLevels,
  computeGexProfile,
  computeMaxPain,
  computeOiVolumeTotals,
  computePCRatio,
  findMaxAbsGamma,
  findNetGexLevels,
  findSumNetGexLevels,
  findZeroGex,
  atmImpliedVol,
  computeSigmaLevels,
  nearestStrikeTo,
  pcRatioByStrike,
  pointAtPrice,
  sumAbsGamma,
  SUM_NET_GEX_SHARE,
  findGammaFlipHypotheticalSpot,
  gammaFlipSweepCrossings,
  computeBoard,
  boardPeakMarks,
  BOARD_COLUMNS,
  expirationOiShares,
  ivCoverageNearSpot,
  repairImpliedVols,
  GAMMA_FLIP_MIN_IV_COVERAGE,
  nearestGammaFlip,
  gexCall,
  gexBarHalves,
  gexPut,
  trimZeroBoundaries,
} from './gex';
import { blackScholesGamma, setValuationTime } from './greeks';
import { zonedTimeToMs } from './backtest/snapshot';
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
    expect(NET_GEX_PLUS_MINUS_MIN_DISTANCE_PCT).toBe(0.03);
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
    // Absolute Gamma (AG) hand-derived from the same callOi/putOi this file's
    // header comment already derives netGex from: callGex(K) = 100*callOi(K),
    // putGex(K) = -100*putOi(K), so absGamma(K) = |callGex| + |putGex| =
    // 100*(callOi(K) + putOi(K)) - NOT read back from the implementation.
    //   90:  100*(100+500) =  60000      106: 100*(850+50)  =  90000
    //   95:  100*(100+300) =  40000      110: 100*(350+50)  =  40000
    //  100:  100*(300+200) =  50000      115: 100*(520+20)  =  54000
    //  105:  100*(1100+100)= 120000
    const expectedAbsGamma = [60000, 40000, 50000, 120000, 90000, 40000, 54000];
    profile.forEach((p, i) => {
      expect(p.netGex).toBeCloseTo(expectedNet[i], 6);
      expect(p.netGex).toBeCloseTo(p.callGex + p.putGex, 9);
      expect(p.putGex).toBeLessThanOrEqual(0);
      expect(p.absGamma).toBeCloseTo(expectedAbsGamma[i], 6);
      // Sanity invariant (holds by construction for every point, in any
      // profile with mixed call/put activity): AG is the unsigned sum of
      // both sides, netGex is their signed sum, so AG can never be smaller
      // than |netGex| - equality only when one side is entirely 0.
      expect(p.absGamma).toBeGreaterThanOrEqual(Math.abs(p.netGex));
    });
    const k105 = profile[3];
    expect(k105.callOi).toBe(1100);
    expect(k105.putOi).toBe(100);
    expect(k105.callGex).toBeCloseTo(110000, 6);
    expect(k105.putGex).toBeCloseTo(-10000, 6);
    expect(k105.absGamma).toBeCloseTo(120000, 6); // 110000 + |-10000|
    expect(k105.callVolume).toBe(10); // EXP_B row has null volume -> 0
    const k90 = profile[0];
    expect(k90.putOi).toBe(500);
    expect(k90.putVolume).toBe(20);
    expect(k90.absGamma).toBeCloseTo(60000, 6); // |10000| (call) + |-50000| (put)
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

/** Frozen pricing clock (GEX-M1: T is the real time to the 16:00 New York settlement): 16:00 New York on Monday 2026-03-09,
 *  the day after the spring daylight saving switch (the next one is 2026-11-01), so `futureIsoDate(n)` settles exactly n days
 *  later and T = n / 365 whatever day or time zone the suite runs in. */
const CLOCK = zonedTimeToMs(2026, 3, 9, 16, 0);
beforeAll(() => setValuationTime(CLOCK));
afterAll(() => setValuationTime(null));

/** `daysFromNow` days after the frozen clock's date, as the "YYYY-MM-DD" string yearsToExpiration expects: T = daysFromNow / 365. */
function futureIsoDate(daysFromNow: number): string {
  return new Date(Date.UTC(2026, 2, 9 + daysFromNow)).toISOString().slice(0, 10);
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
  const T_DAYS = 30; // T = 30/365 on the frozen clock
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

describe('second walls: direction and per-symbol distance', () => {
  // Hand-built profile, only strike + netGex matter to findNetGexLevels.
  const pt = (strike: number, netGex: number) => ({ strike, netGex } as unknown as Parameters<typeof findNetGexLevels>[0][number]);
  // Mirrors the SPY bug: big cluster below the Max Net GEX, small strikes above it.
  const profile = [
    pt(745, -100), pt(767, -500), pt(771, 300), pt(775, 2557), pt(787, 2821),
    pt(788, 37), pt(789, 20), pt(790, 90), pt(793, 36), pt(803, 50),
  ];

  test('Net GEX+ must be above the Max Net GEX, Net GEX- below the Min Net GEX', () => {
    // maxNetGex 787. With minDistance 3: strikes >= 790 -> 790 (+90) beats 793 (+36) and 803 (+50).
    // minNetGex 767 (-500). Below it only 745 (-100) -> netGexMinus 745.
    expect(findNetGexLevels(profile, 775.83, 3)).toEqual({
      maxNetGex: 787, minNetGex: 767, netGexPlus: 790, netGexMinus: 745,
    });
  });

  test('default 3% of spot (23.27) skips 790 and 803, nothing above qualifies -> null', () => {
    // minDistance = 0.03 * 775.83 = 23.2749 -> only strikes >= 810.27 qualify, none in the profile.
    expect(findNetGexLevels(profile, 775.83).netGexPlus).toBeNull();
    // A strike at 812 (+10) is beyond the threshold and is picked.
    expect(findNetGexLevels([...profile, pt(812, 10)], 775.83).netGexPlus).toBe(812);
  });

  test('distance equal to the threshold qualifies (>=)', () => {
    expect(findNetGexLevels(profile, 775.83, 3).netGexPlus).toBe(790);
    // 790 now excluded; 793 (+36) loses to 803 (+50)
    expect(findNetGexLevels(profile, 775.83, 3.01).netGexPlus).toBe(803);
  });

  test('netGexPlusMinusMinDistance: per-symbol usd override, default pct, case-insensitive', () => {
    expect(netGexPlusMinusMinDistance('SPY', 775.83)).toBe(3);
    expect(netGexPlusMinusMinDistance('spy', 775.83)).toBe(3);
    expect(netGexPlusMinusMinDistance('SPX', 7000)).toBeCloseTo(210, 9);
    expect(netGexPlusMinusMinDistance(null, 100)).toBeCloseTo(3, 9);
    expect(netGexPlusMinusMinDistance(undefined, 100)).toBeCloseTo(3, 9);
  });

  test('a pct rule scales with spot', () => {
    expect(netGexPlusMinusMinDistance('TEST_PCT', 800, { ...NET_GEX_PLUS_MINUS_DISTANCE_BY_SYMBOL, TEST_PCT: { pct: 0.005 } })).toBeCloseTo(4, 9);
  });
});

describe('findNetGexLevels (7.4)', () => {
  test('primary walls + second walls honoring the 2%-of-spot distance', () => {
    // min distance = 0.02 * 100 = 2.
    // maxNetGex = 105 (+100000). Next-highest positive is 106 (+80000), but
    // |106-105| = 1 < 2, so netGexPlus = 115 (+50000) instead.
    // minNetGex = 90 (-40000); the only other negative strike is 95, which is
    // ABOVE the Min Net GEX, so netGexMinus = null (Net GEX- must sit below the Min Net GEX).
    expect(findNetGexLevels(computeGexProfile(FIXTURE, SPOT), SPOT)).toEqual({
      maxNetGex: 105,
      minNetGex: 90,
      netGexPlus: 115,
      netGexMinus: null,
    });
  });

  test('second wall is null when nothing qualifies; ties pick the lowest strike', () => {
    // EXP_A nets: 90:-20000, 95:-20000, 100:0, 105:+60000, 106:+80000.
    // maxNetGex 106; only other positive is 105 (distance 1) -> netGexPlus null.
    // 90 and 95 tie at -20000 -> minNetGex 90 (lowest strike); 95 is above it -> netGexMinus null.
    const profile = computeGexProfile(FIXTURE.filter((x) => x.expiration === EXP_A), SPOT);
    expect(findNetGexLevels(profile, SPOT)).toEqual({
      maxNetGex: 106,
      minNetGex: 90,
      netGexPlus: null,
      netGexMinus: null,
    });
  });

  test('no negative netGex -> Min Net GEXs null', () => {
    const callsOnly = computeGexProfile(FIXTURE.filter((x) => x.side === 'call'), SPOT);
    const walls = findNetGexLevels(callsOnly, SPOT);
    expect(walls.minNetGex).toBeNull();
    expect(walls.netGexMinus).toBeNull();
    expect(walls.maxNetGex).toBe(105); // 1100 calls is the biggest call strike
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
// Phase 3 of agentic-workspace docs/repos/gex/spec-vix-futures.md: a quote carrying
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

  test('findNetGexLevels on a forward-priced profile: strikes and signs are exactly as for the shared-spot path', () => {
    // Only two strikes, opposite signs -> each is trivially its own wall.
    const quotes = [vq('call', 20, 1000, F), vq('put', 15, 400, F)];
    const profile = computeGexProfile(quotes, 999); // spot param irrelevant here too
    const walls = findNetGexLevels(profile, F); // caller passes nearest-expiration forward, not spot (section 9)
    expect(walls.maxNetGex).toBe(20);
    expect(walls.minNetGex).toBe(15);
  });

  test('computeGexLevels end-to-end for a single futures-priced expiration', () => {
    const quotes = [vq('call', 20, 1000, F), vq('put', 15, 400, F)];
    const levels = computeGexLevels(quotes, F); // F used as the "spot" arg (section 9 design)
    expect(levels.maxNetGex).toBe(20);
    expect(levels.minNetGex).toBe(15);
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
    // `gamma`, which is all computeGexProfile/findNetGexLevels/computeMaxPain
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
    expect(levels.maxNetGex).toBe(105);
    expect(levels.minNetGex).toBe(90);
    expect(levels.netGexPlus).toBe(115);
    expect(levels.netGexMinus).toBeNull();
    expect(levels.maxPain).toBe(100);
    expect(levels.pcRatioOi).toBeCloseTo(1220 / 3320, 12);
    expect(levels.pcRatioVolume).toBeCloseTo(0.5, 12);
    // -40000 - 20000 + 10000 + 100000 + 80000 + 30000 + 50000
    expect(levels.totalNetGex).toBeCloseTo(210000, 6);
  });

  test('the profile it returns is the one its levels come from (GEX-M3: the view draws it, no second profile)', () => {
    const levels = computeGexLevels(FIXTURE, SPOT);
    expect(levels.profile).toEqual(computeGexProfile(FIXTURE, SPOT));
    expect(levels.maxNetGex).toBe(levels.profile.reduce((best, p) => (p.netGex > best.netGex ? p : best)).strike);
  });

  test('empty chain slice', () => {
    expect(computeGexLevels([], SPOT)).toEqual({
      spot: SPOT,
      profile: [],
      gammaFlip: null,
      gammaFlipPos: null,
      gammaFlipNeg: null,
      gammaFlipIvCoverage: null,
      gammaFlipUnavailable: null,
      maxNetGex: null,
      minNetGex: null,
      netGexPlus: null,
      netGexMinus: null,
      sumNetGexPlus: null,
      sumNetGexMinus: null,
      maxPain: null,
      maxAbsGamma: null,
      zeroGex: null,
      zeroGexZone: null,
      sigma: null,
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

describe('findSumNetGexLevels: 75% of one side\'s net GEX, from spot outward', () => {
  const pt = (strike: number, netGex: number) => ({ strike, netGex } as unknown as Parameters<typeof findSumNetGexLevels>[0][number]);
  // spot 100. Positive at/above spot: 100:+10, 102:+30, 105:+40, 110:+20 (total 100).
  // Negative at/below spot: 98:-100, 95:-60, 90:-40 (total 200 in magnitude).
  const profile = [pt(90, -40), pt(95, -60), pt(98, -100), pt(100, 10), pt(102, 30), pt(105, 40), pt(110, 20)];

  test('the share constant is 75%', () => {
    expect(SUM_NET_GEX_SHARE).toBe(0.75);
  });

  test('high: running sum 10, 40, 80 crosses 75 at 105, low: 100, 160 crosses 150 at 95', () => {
    expect(findSumNetGexLevels(profile, 100)).toEqual({ sumNetGexPlus: 105, sumNetGexMinus: 95 });
  });

  test('the threshold is inclusive (>=): share 0.4 -> target 40 is met exactly at 102', () => {
    expect(findSumNetGexLevels(profile, 100, 0.4).sumNetGexPlus).toBe(102);
    // low side, target 0.5 * 200 = 100 is met exactly at 98
    expect(findSumNetGexLevels(profile, 100, 0.5).sumNetGexMinus).toBe(98);
  });

  test('mass on the wrong side of spot is ignored: a big positive strike below spot changes nothing', () => {
    expect(findSumNetGexLevels([...profile, pt(80, 5000), pt(120, -5000)], 100)).toEqual({ sumNetGexPlus: 105, sumNetGexMinus: 95 });
  });

  test('a side with no mass is null, the other side still works', () => {
    expect(findSumNetGexLevels([pt(98, -100), pt(95, -60)], 100)).toEqual({ sumNetGexPlus: null, sumNetGexMinus: 95 });
    expect(findSumNetGexLevels([pt(102, 30)], 100)).toEqual({ sumNetGexPlus: 102, sumNetGexMinus: null });
    expect(findSumNetGexLevels([], 100)).toEqual({ sumNetGexPlus: null, sumNetGexMinus: null });
  });

  test('share 1 returns the farthest strike with mass', () => {
    expect(findSumNetGexLevels(profile, 100, 1)).toEqual({ sumNetGexPlus: 110, sumNetGexMinus: 90 });
  });
});

describe('pcRatioByStrike: put/call ratios of one strike', () => {
  test('puts divided by calls, by OI and by volume', () => {
    expect(pcRatioByStrike({ callOi: 100, putOi: 150, callVolume: 40, putVolume: 10 })).toEqual({ byOi: 1.5, byVolume: 0.25 });
  });

  test('no call side -> null for that ratio only, the other still works', () => {
    expect(pcRatioByStrike({ callOi: 0, putOi: 150, callVolume: 40, putVolume: 10 })).toEqual({ byOi: null, byVolume: 0.25 });
    expect(pcRatioByStrike({ callOi: 100, putOi: 0, callVolume: 0, putVolume: 10 })).toEqual({ byOi: 0, byVolume: null });
  });

  test('empty strike -> both null', () => {
    expect(pcRatioByStrike({ callOi: 0, putOi: 0, callVolume: 0, putVolume: 0 })).toEqual({ byOi: null, byVolume: null });
  });
});

describe('pointAtPrice: the profile row a level maps to', () => {
  const row = (strike: number) => ({ strike, netGex: strike } as unknown as Parameters<typeof pointAtPrice>[0][number]);
  const profile = [row(100), row(105), row(110)];

  test('a price on a strike is exact', () => {
    expect(pointAtPrice(profile, 105)).toEqual({ point: profile[1], exact: true });
  });

  test('a price between strikes maps to the nearest one, not exact', () => {
    expect(pointAtPrice(profile, 107)).toEqual({ point: profile[1], exact: false });
    expect(pointAtPrice(profile, 108.5)).toEqual({ point: profile[2], exact: false });
  });

  test('a tie goes to the lower strike, outside the range clamps to the edge, empty is null', () => {
    expect(pointAtPrice(profile, 102.5)?.point.strike).toBe(100);
    expect(pointAtPrice(profile, 50)?.point.strike).toBe(100);
    expect(pointAtPrice(profile, 999)?.point.strike).toBe(110);
    expect(pointAtPrice([], 100)).toBeNull();
  });
});

describe('sumAbsGamma: total Absolute Gamma of the profile', () => {
  const row = (netGex: number, absGamma: number) => ({ strike: 1, netGex, absGamma } as unknown as Parameters<typeof sumAbsGamma>[0][number]);

  test('sums |callGex| + |putGex| over all strikes with no call/put cancellation', () => {
    // net +30 and -30 cancel to 0, absolute gamma 50 + 70 = 120 does not
    expect(sumAbsGamma([row(30, 50), row(-30, 70)])).toBe(120);
  });

  test('empty profile -> 0', () => {
    expect(sumAbsGamma([])).toBe(0);
  });
});

describe('findMaxAbsGamma (Max AG)', () => {
  // only strike and absGamma matter here
  const pt = (strike: number, absGamma: number) => ({ strike, absGamma } as unknown as Parameters<typeof findMaxAbsGamma>[0][number]);

  test('the strike with the largest absolute gamma, whatever the sign of its net GEX', () => {
    expect(findMaxAbsGamma([pt(770, 1e9), pt(775, 4e9), pt(780, 2e9)])).toBe(775);
  });

  test('a tie goes to the lowest strike, in any input order', () => {
    expect(findMaxAbsGamma([pt(780, 5), pt(770, 5), pt(775, 5)])).toBe(770);
    expect(findMaxAbsGamma([pt(770, 5), pt(780, 5)])).toBe(770);
  });

  test('an empty profile, or one with no absolute gamma at all, has no Max AG', () => {
    expect(findMaxAbsGamma([])).toBeNull();
    expect(findMaxAbsGamma([pt(770, 0), pt(775, 0)])).toBeNull();
    expect(findMaxAbsGamma([pt(770, NaN)])).toBeNull();
  });

  test('computeGexLevels carries it: the strike whose contracts hold the most gamma', () => {
    // 775 has 10x the open interest of 770 on the call and put side alike, so it also has 10x the absolute gamma
    const q = (strike: number, side: 'call' | 'put', openInterest: number): OptionQuote => ({
      symbol: `X${strike}${side}`, expiration: '2099-01-15', side, strike, bid: 1, ask: 1, mid: 1, last: 1, volume: 0, openInterest, iv: 0.2,
      delta: side === 'call' ? 0.5 : -0.5, gamma: 0.01, theta: 0, vega: 0, rho: 0, greeksSource: 'cboe', greeksMissingReason: null,
    } as unknown as OptionQuote);
    const levels = computeGexLevels([q(770, 'call', 100), q(770, 'put', 100), q(775, 'call', 1000), q(775, 'put', 1000)], 772);
    expect(levels.maxAbsGamma).toBe(775);
  });
});

describe('gexBarHalves (Net GEX view toggle)', () => {
  test('net view: the positive or the negative part of netGex, the other half is 0', () => {
    // fixture strike 105: callGex 110000, putGex -10000 -> netGex 100000 (see computeGexProfile above)
    const k105 = { callGex: 110000, putGex: -10000, netGex: 100000 };
    expect(gexBarHalves(k105, 'net')).toEqual({ pos: 100000, neg: 0 });
    // strike 90: callGex 10000, putGex -50000 -> netGex -40000
    const k90 = { callGex: 10000, putGex: -50000, netGex: -40000 };
    expect(gexBarHalves(k90, 'net')).toEqual({ pos: 0, neg: -40000 });
  });

  test('split view: call GEX up and put GEX down at the same strike, not netted', () => {
    expect(gexBarHalves({ callGex: 110000, putGex: -10000, netGex: 100000 }, 'split')).toEqual({ pos: 110000, neg: -10000 });
    expect(gexBarHalves({ callGex: 10000, putGex: -50000, netGex: -40000 }, 'split')).toEqual({ pos: 10000, neg: -50000 });
  });

  test('split halves of the real profile add up to netGex and span absGamma', () => {
    for (const p of computeGexProfile(FIXTURE, SPOT)) {
      const { pos, neg } = gexBarHalves(p, 'split');
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(neg).toBeLessThanOrEqual(0);
      expect(pos + neg).toBeCloseTo(p.netGex, 9);
      expect(pos - neg).toBeCloseTo(p.absGamma, 9);
    }
  });

  test('a strike where calls and puts cancel shows nothing in the net view but both sides in the split view', () => {
    // fixture EXP_A strike 100: 200 calls vs 200 puts, same gamma -> callGex 20000, putGex -20000, netGex 0
    const k100 = { callGex: 20000, putGex: -20000, netGex: 0 };
    expect(gexBarHalves(k100, 'net')).toEqual({ pos: 0, neg: 0 });
    expect(gexBarHalves(k100, 'split')).toEqual({ pos: 20000, neg: -20000 });
  });
});

describe('findZeroGex (Zero GEX, the owner\'s method)', () => {
  // only strike and netGex matter here
  const pt = (strike: number, netGex: number) => ({ strike, netGex } as unknown as Parameters<typeof findZeroGex>[0][number]);
  const total = (p: ReturnType<typeof pt>[]) => p.reduce((s, x) => s + x.netGex, 0);

  test('positive total: from the Max Net GEX strike down to the first negative strike', () => {
    // max +20 at 105; walking down: 100 (+3) is still positive, 95 (-5) is the first negative strike
    const profile = [pt(90, -10), pt(95, -5), pt(100, 3), pt(105, 20), pt(110, 5)];
    expect(total(profile)).toBe(13);
    expect(findZeroGex(profile, 13)).toEqual({ zeroGex: 95, zeroGexZone: { low: 95, high: 100 } });
  });

  test('negative total: from the Min Net GEX strike up to the first positive strike, zero strikes are walked over', () => {
    // min -30 at 95; walking up: 100 (-5) still negative, 105 (0) neither sign, 110 (+4) the first positive strike
    const profile = [pt(90, 2), pt(95, -30), pt(100, -5), pt(105, 0), pt(110, 4), pt(115, -1)];
    expect(total(profile)).toBe(-30);
    expect(findZeroGex(profile, -30)).toEqual({ zeroGex: 110, zeroGexZone: { low: 100, high: 110 } });
  });

  test('the line sits on the LEFT strike of the zone with a positive total, on the RIGHT strike with a negative one (owner)', () => {
    const up = findZeroGex([pt(90, -10), pt(95, -5), pt(100, 3), pt(105, 20), pt(110, 5)], 13);
    expect(up.zeroGex).toBe(up.zeroGexZone?.low ?? NaN);
    expect(up.zeroGex).toBe(95);
    const down = findZeroGex([pt(90, 2), pt(95, -30), pt(100, -5), pt(105, 0), pt(110, 4), pt(115, -1)], -30);
    expect(down.zeroGex).toBe(down.zeroGexZone?.high ?? NaN);
    expect(down.zeroGex).toBe(110);
  });

  // several sign changes (owner 2026-10-25): the zone with the highest average AG of its two strikes
  const pa = (strike: number, netGex: number, absGamma: number) => ({ strike, netGex, absGamma } as unknown as Parameters<typeof findZeroGex>[0][number]);

  test('one candidate between the walls: the same zone as before, whatever its AG', () => {
    const profile = [pa(90, -30, 1), pa(95, -5, 1), pa(100, 4, 1), pa(105, 10, 1)];
    expect(findZeroGex(profile, -21)).toEqual({ zeroGex: 100, zeroGexZone: { low: 95, high: 100 } });
  });

  test('several candidates walking up (negative total): the highest average AG wins, the line on its right strike', () => {
    // Min Net GEX 95 (-30), Max Net GEX 130 (+20). Candidates: 100->105 avg AG (2+4)/2 = 3, 110->115 (9+7)/2 = 8,
    // 120->125 (1+1)/2 = 1 -> 110/115, line 115. (The SPX case of 2026-10-23 had the same shape: 7750/7755 won.)
    const profile = [pa(95, -30, 5), pa(100, -2, 2), pa(105, 1, 4), pa(110, -6, 9), pa(115, 2, 7), pa(120, -1, 1), pa(125, 1, 1), pa(130, 20, 3)];
    expect(findZeroGex(profile, -15)).toEqual({ zeroGex: 115, zeroGexZone: { low: 110, high: 115 } });
  });

  test('several candidates walking down (positive total): the highest average AG wins, the line on its left strike', () => {
    // Max Net GEX 130 (+30), Min Net GEX 95 (-8). Walking down: 120->115 avg (2+2)/2 = 2, 110->105 (6+8)/2 = 7 -> 105/110
    const profile = [pa(95, -8, 1), pa(100, -1, 1), pa(105, -2, 8), pa(110, 3, 6), pa(115, -1, 2), pa(120, 4, 2), pa(130, 30, 9)];
    expect(findZeroGex(profile, 25)).toEqual({ zeroGex: 105, zeroGexZone: { low: 105, high: 110 } });
  });

  test('equal average AG: the candidate nearest to the starting wall', () => {
    // walking up from 95: 100->105 avg 3 and 110->115 avg 3 -> the first one met
    const profile = [pa(95, -30, 5), pa(100, -2, 2), pa(105, 1, 4), pa(110, -6, 4), pa(115, 2, 2), pa(130, 20, 3)];
    expect(findZeroGex(profile, -15)).toEqual({ zeroGex: 105, zeroGexZone: { low: 100, high: 105 } });
  });

  test('the walk stops at the opposite wall: a sign change beyond it is not a candidate', () => {
    // walking up from 95 to the Max Net GEX at 110; the change 115->120 lies beyond it
    const profile = [pa(95, -30, 1), pa(100, -1, 1), pa(110, 20, 1), pa(115, -1, 50), pa(120, 5, 50)];
    expect(findZeroGex(profile, -7)).toEqual({ zeroGex: 110, zeroGexZone: { low: 100, high: 110 } });
  });

  test('no sign change in the walking direction -> null', () => {
    expect(findZeroGex([pt(90, 1), pt(95, 2), pt(100, 3)], 6)).toEqual({ zeroGex: null, zeroGexZone: null });
    // positive total, the only negative strike is ABOVE the max: walking down never meets it
    expect(findZeroGex([pt(90, 1), pt(95, 9), pt(100, -2)], 8)).toEqual({ zeroGex: null, zeroGexZone: null });
    // negative total, the only positive strike is BELOW the min
    expect(findZeroGex([pt(90, 2), pt(95, -9), pt(100, -1)], -8)).toEqual({ zeroGex: null, zeroGexZone: null });
  });

  test('a tie for the starting strike goes to the lowest strike', () => {
    // +20 at 100 and at 110: starting at 100 gives 90 (zone 90..95); starting at 110 would give 105
    const profile = [pt(90, -5), pt(95, 1), pt(100, 20), pt(105, -1), pt(110, 20)];
    expect(findZeroGex(profile, total(profile))).toEqual({ zeroGex: 90, zeroGexZone: { low: 90, high: 95 } });
    // the mirror case for a negative total: -20 at 100 and at 110, walking up from 100 meets 105 (+1)
    const neg = [pt(100, -20), pt(105, 1), pt(110, -20), pt(115, 3)];
    expect(findZeroGex(neg, total(neg))).toEqual({ zeroGex: 105, zeroGexZone: { low: 100, high: 105 } });
  });

  test('zero total or an empty profile -> null', () => {
    expect(findZeroGex([pt(90, -5), pt(95, 5)], 0)).toEqual({ zeroGex: null, zeroGexZone: null });
    expect(findZeroGex([], 10)).toEqual({ zeroGex: null, zeroGexZone: null });
    expect(findZeroGex([pt(90, 1)], NaN)).toEqual({ zeroGex: null, zeroGexZone: null });
  });

  test('computeGexLevels carries it next to the Gamma Flip, from the real-spot profile', () => {
    // same gamma everywhere, so netGex(K) is proportional to callOi(K) - putOi(K):
    //   95: -100 (puts), 100: +50, 105: +400 (max), total > 0 -> walk down from 105: 100 positive, 95 the first negative
    const q = (strike: number, side: 'call' | 'put', openInterest: number): OptionQuote => ({
      symbol: `X${strike}${side}`, expiration: '2099-01-15', side, strike, bid: 1, ask: 1, mid: 1, last: 1, volume: 0, openInterest, iv: 0.2,
      delta: side === 'call' ? 0.5 : -0.5, gamma: 0.01, theta: 0, vega: 0, rho: 0, greeksSource: 'cboe', greeksMissingReason: null,
    } as unknown as OptionQuote);
    const levels = computeGexLevels([q(95, 'put', 100), q(100, 'call', 50), q(105, 'call', 400)], 100);
    expect(levels.totalNetGex).toBeGreaterThan(0);
    expect(levels.zeroGex).toBe(95);
    expect(levels.zeroGexZone).toEqual({ low: 95, high: 100 });
  });
});

describe('Sigma levels', () => {
  const sq = (expiration: string, side: 'call' | 'put', strike: number, iv: number | null): OptionQuote => ({
    symbol: `X${expiration}${side}${strike}`, expiration, side, strike, bid: 1, ask: 1, mid: 1, last: 1, volume: 0, openInterest: 10, iv,
    delta: 0, gamma: 0.01, theta: 0, vega: 0, rho: 0, greeksSource: 'cboe', greeksMissingReason: null,
  } as unknown as OptionQuote);

  test('nearestStrikeTo: the closest strike, a tie goes to the lower one, nothing for no strikes', () => {
    expect(nearestStrikeTo([90, 95, 100, 105], 101)).toBe(100);
    expect(nearestStrikeTo([105, 95], 100)).toBe(95);
    expect(nearestStrikeTo([], 100)).toBeNull();
    expect(nearestStrikeTo([100], NaN)).toBeNull();
  });

  test('atmImpliedVol: call and put IV averaged per strike, interpolated at spot, placeholder IVs ignored', () => {
    const quotes = [
      sq('E', 'call', 95, 0.30), sq('E', 'put', 95, 0.32), // 0.31
      sq('E', 'call', 100, 0.00001), // a CBOE failed-solve placeholder: below GAMMA_FLIP_MIN_IV, ignored
      sq('E', 'call', 105, 0.20), sq('E', 'put', 105, 0.22), // 0.21
    ];
    expect(atmImpliedVol(quotes, 100)).toBeCloseTo(0.26, 12); // halfway between 0.31 and 0.21
    expect(atmImpliedVol(quotes, 95)).toBeCloseTo(0.31, 12); // on a strike
    expect(atmImpliedVol(quotes, 80)).toBeCloseTo(0.31, 12); // below every strike: the closest one
    expect(atmImpliedVol(quotes, 120)).toBeCloseTo(0.21, 12);
    expect(atmImpliedVol([sq('E', 'put', 100, null)], 100)).toBeNull();
  });

  test('% mode: strikes nearest to spot +/- 1, 2, 3 %, in the order +1 +2 +3 -1 -2 -3', () => {
    const quotes = [90, 95, 97.5, 100, 102.5, 105, 110].map((k) => sq('2099-01-15', 'call', k, null));
    const s = computeSigmaLevels(quotes, 100);
    // 101 -> 100 (1 vs 1.5), 102 -> 102.5, 103 -> 102.5, 99 -> 100, 98 -> 97.5, 97 -> 97.5
    expect(s?.pct.map((l) => [l.side * l.n, l.strike])).toEqual([[1, 100], [2, 102.5], [3, 102.5], [-1, 100], [-2, 97.5], [-3, 97.5]]);
    expect(s?.pct[0].price).toBeCloseTo(101, 12);
    // no usable IV anywhere: no statistical mode
    expect(s?.stat).toBeNull();
    expect(s?.statBasis).toBeNull();
  });

  test('statistical mode: 1 sigma = spot * ATM IV * sqrt(T) of the nearest expiration that is live and has an IV', () => {
    const now = new Date(zonedTimeToMs(2026, 1, 1, 12, 0)); // noon New York, winter time all month
    const strikes = [85, 90, 95, 100, 105, 110, 115];
    const quotes = [
      // expired before `now`: skipped even though it has an IV
      sq('2025-12-01', 'call', 100, 0.9),
      // the nearest live expiration has no usable IV: skipped
      sq('2026-01-10', 'call', 100, null),
      // 2026-01-31: 30 days and 4 hours from noon to the 16:00 settlement (greeks.ts, GEX-M1), ATM IV 0.26 at spot 100
      sq('2026-01-31', 'call', 95, 0.30), sq('2026-01-31', 'put', 95, 0.32),
      sq('2026-01-31', 'call', 105, 0.20), sq('2026-01-31', 'put', 105, 0.22),
      ...strikes.map((k) => sq('2026-01-31', 'call', k, null)),
    ];
    const s = computeSigmaLevels(quotes, 100, now);
    const days = 30 + 4 / 24;
    const move = 100 * 0.26 * Math.sqrt(days / 365); // 7.4746...
    expect(s?.statBasis?.expiration).toBe('2026-01-31');
    expect(s?.statBasis?.days as number).toBeCloseTo(days, 9);
    expect(s?.statBasis?.iv).toBeCloseTo(0.26, 12);
    expect(s?.statBasis?.move).toBeCloseTo(move, 9);
    // +1: 107.47 -> 105 (2.47 vs 2.53), +2: 114.95 -> 115, +3: 122.42 -> 115 (the last strike),
    // -1: 92.53 -> 95 (2.47 vs 2.53), -2: 85.05 -> 85, -3: 77.58 -> 85
    expect(s?.stat?.map((l) => [l.side * l.n, l.strike])).toEqual([[1, 105], [2, 115], [3, 115], [-1, 95], [-2, 85], [-3, 85]]);
    expect(s?.stat?.[1].price).toBeCloseTo(100 + 2 * move, 9);
  });

  test('no strikes or no spot: no Sigma levels; computeGexLevels carries them', () => {
    expect(computeSigmaLevels([], 100)).toBeNull();
    expect(computeSigmaLevels([sq('2099-01-15', 'call', 100, 0.2)], NaN)).toBeNull();
    const levels = computeGexLevels([sq('2099-01-15', 'call', 100, 0.2), sq('2099-01-15', 'call', 101, 0.2)], 100);
    expect(levels.sigma?.pct.map((l) => l.strike)).toEqual([101, 101, 101, 100, 100, 100]);
  });
});

// ---------------------------------------------------------------------------
// GEX-M2 (owner-approved 2026-10-25): the Gamma Flip is the only crossing of the sweep, or the one nearest to spot.
// The old rule picked by the sign of the total net GEX and hid a lone crossing of the other direction (SPX, SPY).
// ---------------------------------------------------------------------------
describe('nearestGammaFlip (GEX-M2)', () => {
  test('no crossing -> null', () => {
    expect(nearestGammaFlip([], 100)).toBeNull();
  });

  test('one crossing is the flip whatever its direction', () => {
    expect(nearestGammaFlip([{ price: 97, direction: 1 }], 100)).toBe(97);
    expect(nearestGammaFlip([{ price: 104, direction: -1 }], 100)).toBe(104);
  });

  test('two crossings: the one nearest to spot, on either side', () => {
    expect(nearestGammaFlip([{ price: 95, direction: 1 }, { price: 106, direction: -1 }], 100)).toBe(95);
    expect(nearestGammaFlip([{ price: 93, direction: 1 }, { price: 103, direction: -1 }], 100)).toBe(103);
    expect(nearestGammaFlip([{ price: 101, direction: -1 }, { price: 108, direction: 1 }], 100)).toBe(101);
  });

  test('equal distance resolves to the lower price', () => {
    expect(nearestGammaFlip([{ price: 96, direction: 1 }, { price: 104, direction: -1 }], 100)).toBe(96);
    expect(nearestGammaFlip([{ price: 104, direction: -1 }, { price: 96, direction: 1 }], 100)).toBe(96);
  });
});

describe('computeGexLevels: Gamma Flip by the GEX-M2 rule', () => {
  const T_DAYS = 30;
  const withGamma = (q: OptionQuote, gamma: number): OptionQuote => ({ ...q, gamma });

  test('a negative total with only a negative -> positive crossing still shows that crossing (the SPX / SPY case)', () => {
    const exp = futureIsoDate(T_DAYS);
    // the sweep crosses once, upward, near 98.97 (fixture of findGammaFlipHypotheticalSpot above); the put's real gamma
    // is larger, so the total net GEX at spot is negative: the old rule picked `neg` (null) and showed no flip
    const quotes = [withGamma(bsQuote('put', 90, 500, 0.2, exp), 0.03), withGamma(bsQuote('call', 110, 500, 0.2, exp), 0.01)];
    const levels = computeGexLevels(quotes, 100);
    expect(levels.totalNetGex).toBeLessThan(0);
    expect(levels.gammaFlipNeg).toBeNull();
    expect(levels.gammaFlipPos as number).toBeCloseTo(98.9686, 1);
    expect(levels.gammaFlip).toBe(levels.gammaFlipPos);
  });

  test('two crossings: the nearer one wins even when the total sign points at the farther one', () => {
    const exp = futureIsoDate(T_DAYS);
    // put 90 / call 102 / put 112: negative -> positive between 90 and 102, positive -> negative between 102 and 112;
    // spot 100 is nearer the first. The total at spot is negative, so the old rule showed the farther `neg`.
    const quotes = [
      withGamma(bsQuote('put', 90, 500, 0.2, exp), 0.03),
      withGamma(bsQuote('call', 102, 500, 0.2, exp), 0.02),
      withGamma(bsQuote('put', 112, 500, 0.2, exp), 0.03),
    ];
    const crossings = gammaFlipSweepCrossings(quotes, 100);
    expect(crossings.map((c) => c.direction)).toEqual([1, -1]);
    const levels = computeGexLevels(quotes, 100);
    expect(levels.totalNetGex).toBeLessThan(0);
    const pos = levels.gammaFlipPos as number;
    const neg = levels.gammaFlipNeg as number;
    expect(pos).toBeGreaterThan(90);
    expect(pos).toBeLessThan(100);
    expect(neg).toBeGreaterThan(102);
    expect(neg).toBeLessThan(112);
    expect(Math.abs(pos - 100)).toBeLessThan(Math.abs(neg - 100));
    expect(levels.gammaFlip).toBe(pos);
  });

  test('no crossing -> no Gamma Flip', () => {
    const exp = futureIsoDate(T_DAYS);
    expect(computeGexLevels([withGamma(bsQuote('put', 90, 500, 0.2, exp), 0.03)], 100).gammaFlip).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Failed-solve IV repair + coverage gate of the Gamma Flip (owner-approved 2026-10-25)
// ---------------------------------------------------------------------------
describe('repairImpliedVols', () => {
  const exp = futureIsoDate(30); // T = 30/365 on the frozen clock
  const T = 30 / 365;
  const q = (side: 'call' | 'put', strike: number, iv: number | null, gamma: number | null = null, oi = 100): OptionQuote => ({ ...bsQuote(side, strike, oi, iv as number, exp), iv, gamma });

  test('a broken IV between two valid IVs of the same side is interpolated in strike (smile)', () => {
    const out = repairImpliedVols([q('call', 90, 0.3), q('call', 100, 0.00001), q('call', 110, 0.2)], 100);
    expect(out[1].iv as number).toBeCloseTo(0.25, 12);
    expect(out[1].ivRepair).toBe('smile');
    expect(out[0]).toEqual(q('call', 90, 0.3)); // valid IVs untouched
  });

  test('no bracket on its side: the valid IV of the other side at the same strike', () => {
    const out = repairImpliedVols([q('call', 100, 0.0002), q('call', 110, 0.2), q('put', 100, 0.22)], 100);
    expect(out[0].iv).toBe(0.22);
    expect(out[0].ivRepair).toBe('otherSide');
  });

  test('nothing to interpolate: the IV whose gamma is the provider gamma', () => {
    const g = blackScholesGamma(100, 100, T, 0.18) as number;
    const out = repairImpliedVols([q('call', 100, 0.00001, g), q('put', 100, null, g)], 100);
    for (const r of out) {
      expect(r.iv as number).toBeCloseTo(0.18, 5);
      expect(r.ivRepair).toBe('gamma');
    }
  });

  test('the gamma inversion takes the root nearest to the expiration ATM IV', () => {
    // ATM IV 15% from a valid pair at strike 100; strike 110 has a broken IV and the gamma of 15% (two roots)
    const g = blackScholesGamma(100, 110, T, 0.15) as number;
    const out = repairImpliedVols([q('call', 100, 0.15), q('put', 100, 0.15), q('call', 110, 0.001, g)], 100);
    expect(out[2].iv as number).toBeCloseTo(0.15, 5);
  });

  test('left alone: no gamma and nothing to interpolate, futures-priced quotes, and the input is never mutated', () => {
    const lone = q('call', 100, 0.00001, null);
    const fut = { ...q('call', 100, 0.00001, 0.05), forward: 101 };
    const input = [lone, fut];
    const out = repairImpliedVols(input, 100);
    expect(out[0]).toBe(lone);
    expect(out[1]).toBe(fut);
    expect(input[0].iv).toBe(0.00001);
    expect(repairImpliedVols(input, NaN)).toEqual(input);
  });
});

describe('ivCoverageNearSpot', () => {
  const exp = futureIsoDate(30);
  const q = (strike: number, iv: number | null, gamma: number | null, oi: number): OptionQuote => ({ ...bsQuote('call', strike, oi, iv as number, exp), iv, gamma });

  test('share of the provider |GEX| within 2% of spot that has a usable IV', () => {
    // in the window (98..102): gamma*OI 0.01*300 = 3 usable, 0.01*100 = 1 broken -> 3 / 4; 105 is outside
    expect(ivCoverageNearSpot([q(100, 0.2, 0.01, 300), q(101, 0.001, 0.01, 100), q(105, 0.001, 0.5, 1000)], 100)).toBeCloseTo(0.75, 12);
  });

  test('null when nothing near spot has a provider gamma and OI', () => {
    expect(ivCoverageNearSpot([q(100, 0.2, null, 300), q(101, 0.2, 0.01, 0)], 100)).toBeNull();
    expect(ivCoverageNearSpot([], 100)).toBeNull();
  });
});

describe('computeGexLevels: Gamma Flip on repaired IVs and the coverage gate', () => {
  const exp = futureIsoDate(30);
  const T = 30 / 365;

  test('broken IVs with a sane provider gamma: repaired from the gamma, the flip is the same as with the true IVs', () => {
    // the fixture of findGammaFlipHypotheticalSpot (put 90 / call 110, 20%, flip ~98.97) plus a small at-the-money pair
    // (it gives the inversion its reference: one root at the money), every IV replaced by a CBOE-style failed solve while
    // the provider gamma is the 20% gamma. Out of the money the 20% root is the LOW one of two, so the reference matters.
    const good = [bsQuote('put', 90, 500, 0.2, exp), bsQuote('call', 110, 500, 0.2, exp), bsQuote('call', 100, 1, 0.2, exp), bsQuote('put', 100, 1, 0.2, exp)]
      .map((x) => ({ ...x, gamma: blackScholesGamma(100, x.strike, T, 0.2) }));
    const broken = good.map((x) => ({ ...x, iv: 0.00001 }));
    expect(findGammaFlipHypotheticalSpot(broken, 100)).toEqual({ pos: null, neg: null }); // without the repair the sweep is blind
    for (const r of repairImpliedVols(broken, 100)) expect(r.iv as number).toBeCloseTo(0.2, 5);
    const levels = computeGexLevels(broken, 100);
    const expected = computeGexLevels(good, 100).gammaFlip as number;
    expect(expected).toBeGreaterThan(97);
    expect(expected).toBeLessThan(101);
    expect(levels.gammaFlip as number).toBeCloseTo(expected, 4);
    expect(levels.gammaFlipUnavailable).toBeNull();
  });

  test('too little of the gamma near spot has a usable IV: no flip, the reason and the coverage are exposed', () => {
    // two crossing legs far from spot with valid IVs, and a large near-spot call with no IV and no gamma inversion
    // possible (gamma far above any Black-Scholes gamma): coverage 0 near spot
    const legs = [bsQuote('put', 90, 500, 0.2, exp), bsQuote('call', 110, 500, 0.2, exp)].map((x) => ({ ...x, gamma: 0.0001 }));
    const nearSpot = { ...bsQuote('call', 100, 5000, 0.00001, exp), gamma: 50 };
    const levels = computeGexLevels([...legs, nearSpot], 100);
    expect(levels.gammaFlipIvCoverage as number).toBeLessThan(GAMMA_FLIP_MIN_IV_COVERAGE);
    expect(levels.gammaFlipUnavailable).toBe('ivCoverage');
    expect(levels.gammaFlip).toBeNull();
    expect(levels.gammaFlipPos).not.toBeNull(); // the sweep itself still ran
  });

  test('the statistical Sigma reads the repaired ATM IV', () => {
    const g = blackScholesGamma(100, 100, T, 0.25) as number;
    const levels = computeGexLevels([{ ...bsQuote('call', 100, 10, 0.00001, exp), gamma: g }, { ...bsQuote('put', 100, 10, 0.00001, exp), gamma: g }], 100);
    expect(levels.sigma?.statBasis?.iv as number).toBeCloseTo(0.25, 5);
  });
});

// ---------------------------------------------------------------------------
// Board (owner 2026-10-25): per-strike table of the selected expirations
// ---------------------------------------------------------------------------
describe('computeBoard', () => {
  const b = (side: 'call' | 'put', strike: number, o: Partial<OptionQuote> = {}): OptionQuote => ({
    symbol: `B${side}${strike}`, expiration: '2026-11-20', side, strike, bid: null, ask: null, mid: null, last: null,
    volume: null, openInterest: null, iv: null, delta: null, gamma: null, theta: null, vega: null, ...o,
  });
  // spot 100: gex per contract unit = gamma * OI * 100 * 100^2 * 0.01 = gamma * OI * 10_000
  const quotes = [
    b('call', 95, { gamma: 0.01, openInterest: 10, delta: 0.7, volume: 5 }),   // callGex +1000
    b('put', 95, { gamma: 0.02, openInterest: 30, delta: -0.3, volume: 7 }),   // putGex -6000 -> net -5000, abs 7000
    b('call', 100, { gamma: 0.03, openInterest: 20, delta: 0.5, volume: 40 }), // +6000
    b('put', 100, { gamma: 0.03, openInterest: 10, delta: -0.5, volume: 2 }),  // -3000 -> net +3000, abs 9000
    b('call', 105, { gamma: null, openInterest: 50, delta: null, volume: 1 }), // no greeks: counts only in OI / volume
    b('put', 105, { gamma: 0.01, openInterest: 5, delta: -0.8 }),               // -500 -> net -500, abs 500
  ];
  const board = computeBoard(quotes, 100);
  const row = (k: number) => board.rows.find((r) => r.strike === k)!;

  test('per strike: net and abs GEX by the gexCall / gexPut convention, null greeks left out, OI and volume of every quote', () => {
    expect(board.rows.map((r) => r.strike)).toEqual([95, 100, 105]);
    expect(row(95).netGex).toBeCloseTo(-5000, 9);
    expect(row(95).absGex).toBeCloseTo(7000, 9);
    expect(row(100).netGex).toBeCloseTo(3000, 9);
    expect(row(105).netGex).toBeCloseTo(-500, 9);
    expect(row(105).absGex).toBeCloseTo(500, 9);
    expect(row(105).callOi).toBe(50);
    expect(row(105).totalOi).toBe(55);
    expect(row(95).totalVolume).toBe(12);
    expect(row(105).putVolume).toBe(0); // null volume is 0 contracts traded
  });

  test('notional delta: dealer long calls, short puts: calls delta x OI x 100 x spot minus puts the same', () => {
    // 95: 0.7*10*100*100 - (-0.3)*30*100*100 = 70_000 + 90_000
    expect(row(95).notionalDelta).toBeCloseTo(160000, 6);
    // 105: the call has no delta (left out), the put -(-0.8)*5*100*100 = 40_000
    expect(row(105).notionalDelta).toBeCloseTo(40000, 6);
  });

  test('call GEX and put GEX halves (the Abs GEX view of the Net GEX column) and the per-strike P/C ratios', () => {
    expect(row(95).callGex).toBeCloseTo(1000, 9);
    expect(row(95).putGex).toBeCloseTo(-6000, 9);
    expect(row(95).callGex + row(95).putGex).toBeCloseTo(row(95).netGex, 9);
    expect(row(95).callGex - row(95).putGex).toBeCloseTo(row(95).absGex, 9);
    expect(row(95).pcRatioOi).toBeCloseTo(3, 12); // 30 / 10
    expect(row(95).pcRatioVolume).toBeCloseTo(7 / 5, 12);
    expect(row(105).pcRatioVolume).toBe(0); // 0 put contracts over 1 call contract
    expect(computeBoard([b('put', 90, { openInterest: 4 })], 100).rows[0].pcRatioOi).toBeNull(); // no call side
    // peaks: call GEX the largest (100: +6000), put GEX the most negative (95: -6000)
    expect(board.peaks.callGex).toEqual([100]);
    expect(board.peaks.putGex).toEqual([95]);
  });

  test('% is the strike Abs GEX over the total Abs GEX', () => {
    expect(row(100).absGexShare).toBeCloseTo(9000 / 16500, 12);
    expect(board.rows.reduce((s, r) => s + r.absGexShare, 0)).toBeCloseTo(1, 12);
  });

  test('peaks: Net GEX marks its largest positive and most negative strike, the others their largest; ATM nearest spot', () => {
    expect(board.peaks.netGex).toEqual([100, 95]);
    expect(board.peaks.absGex).toEqual([100]);
    expect(board.peaks.absGexShare).toEqual([100]);
    expect(board.peaks.totalOi).toEqual([105]);
    expect(board.peaks.callVolume).toEqual([100]);
    expect(board.peaks.notionalDelta).toEqual([95]);
    expect(board.atmStrike).toBe(100);
    expect(computeBoard(quotes, 102.5).atmStrike).toBe(100); // tie between 100 and 105 -> the lower
  });

  test('seconds: the runner-up of each column one rank below its peak, Net GEX and put GEX also on the negative side', () => {
    expect(board.seconds.netGex).toEqual([105]); // one positive strike only (100), the negatives -5000 (95) then -500 (105)
    expect(board.seconds.absGex).toEqual([95]); // 9000 (100), then 7000 (95)
    expect(board.seconds.totalOi).toEqual([95]); // 55 (105), then 40 (95)
    expect(board.seconds.callGex).toEqual([95]); // +6000 (100), then +1000 (95)
    expect(board.seconds.putGex).toEqual([100]); // -6000 (95), then -3000 (100)
    for (const c of BOARD_COLUMNS) for (const k of board.seconds[c]) expect(board.peaks[c]).not.toContain(k);
  });

  test('seconds: a strike tied with the peak is the runner-up; a single value has none', () => {
    const tie = computeBoard([b('call', 90, { openInterest: 7 }), b('call', 110, { openInterest: 7 }), b('call', 100, { openInterest: 3 })], 100);
    expect(tie.peaks.totalOi).toEqual([90]);
    expect(tie.seconds.totalOi).toEqual([110]);
    expect(computeBoard([b('call', 90, { openInterest: 7 })], 100).seconds.totalOi).toEqual([]);
    expect(computeBoard([], 100).seconds.netGex).toEqual([]);
  });

  test('ties go to the lowest strike; no positive value -> no peak; an empty chain is empty', () => {
    const tie = computeBoard([b('call', 90, { openInterest: 7 }), b('call', 110, { openInterest: 7 })], 100);
    expect(tie.peaks.totalOi).toEqual([90]);
    expect(tie.peaks.netGex).toEqual([]); // no gamma at all
    expect(tie.peaks.putOi).toEqual([]);
    const empty = computeBoard([], 100);
    expect(empty.rows).toEqual([]);
    expect(empty.atmStrike).toBeNull();
  });
});

describe('expirationOiShares', () => {
  test('each expiration\'s share of the OI of all loaded expirations', () => {
    const q = (oi: number | null): OptionQuote => ({ symbol: 'x', expiration: 'e', side: 'call', strike: 1, bid: null, ask: null, mid: null, last: null, volume: null, openInterest: oi, iv: null, delta: null, gamma: null, theta: null, vega: null });
    expect(expirationOiShares({ a: [q(30), q(10)], b: [q(60)], c: [q(null)] })).toEqual({ a: 0.4, b: 0.6, c: 0 });
    expect(expirationOiShares({ a: [q(0)] })).toEqual({ a: 0 });
  });
});

describe('boardPeakMarks (Desk scroll marks: the peaks and runner-ups of one expiration)', () => {
  // spot 100, gamma 0.01: gexCall = 0.01 * OI * 100 * 100^2 * 0.01 = 100 * OI, gexPut = -100 * OI
  const e = '2026-01-16';
  const quotes = [
    q(e, 'call', 90, 5, 0.01), q(e, 'put', 90, 40, 0.01), // net -3500 (min, peak)
    q(e, 'call', 95, 10, 0.01), q(e, 'put', 95, 30, 0.01), // net -2000 (runner-up)
    q(e, 'call', 100, 50, 0.01), // net +5000 (max, peak), total OI 50 (peak)
    q(e, 'call', 105, 30, 0.01), q(e, 'put', 105, 15, 0.01), // net +1500 (runner-up), total OI 45 (runner-up)
    q(e, 'call', 110, 1, 0.01), // net +100, nothing
  ];

  test('net GEX: max positive and min negative are peaks, the next ones runner-ups; unmarked strikes are absent', () => {
    const marks = boardPeakMarks(quotes, 100, ['netGex']);
    expect(Array.from(marks.keys())).toEqual([90, 95, 100, 105]);
    expect(marks.get(90)).toEqual({ netGex: -3500, peaks: ['netGex'], seconds: [] });
    expect(marks.get(95)).toEqual({ netGex: -2000, peaks: [], seconds: ['netGex'] });
    expect(marks.get(100)!.peaks).toEqual(['netGex']);
    expect(marks.get(105)!.seconds).toEqual(['netGex']);
    expect(marks.has(110)).toBe(false);
  });

  test('only the given columns count, each listed on its strike', () => {
    const marks = boardPeakMarks(quotes, 100, ['totalOi']);
    expect(Array.from(marks.keys())).toEqual([90, 100]); // total OI: 90 -> 45, 95 -> 40, 100 -> 50, 105 -> 45 (tie to the lowest)
    expect(marks.get(100)).toEqual({ netGex: 5000, peaks: ['totalOi'], seconds: [] });
    expect(marks.get(90)!.seconds).toEqual(['totalOi']);
    const both = boardPeakMarks(quotes, 100, ['netGex', 'totalOi']);
    expect(both.get(100)!.peaks).toEqual(['netGex', 'totalOi']);
    expect(both.get(90)).toEqual({ netGex: -3500, peaks: ['netGex'], seconds: ['totalOi'] });
    expect(boardPeakMarks(quotes, 100, []).size).toBe(0);
  });

  test('the same peaks and runner-ups as computeBoard, a peak is never also the runner-up of its column', () => {
    const board = computeBoard(quotes, 100);
    const marks = boardPeakMarks(quotes, 100, ['netGex', 'absGex', 'callOi']);
    for (const c of ['netGex', 'absGex', 'callOi'] as const) {
      for (const s of board.peaks[c]) expect(marks.get(s)!.peaks).toContain(c);
      for (const s of board.seconds[c]) if (!board.peaks[c].includes(s)) expect(marks.get(s)!.seconds).toContain(c);
    }
    for (const m of Array.from(marks.values())) for (const c of m.peaks) expect(m.seconds).not.toContain(c);
    expect(boardPeakMarks([], 100, ['netGex']).size).toBe(0);
  });
});

describe('contract multiplier per symbol (futures options, TradingView files)', () => {
  test('the table: E-mini / Micro point values, every other symbol 100', () => {
    expect(CONTRACT_MULTIPLIER_BY_FUTURES_ROOT).toEqual({ ES: 50, MES: 5, NQ: 20, MNQ: 2, YM: 5, MYM: 0.5, RTY: 50, M2K: 5 });
    expect(['/ES', 'ES1!', ' /mes ', 'mes1!', '/NQ', 'MNQ1!', '/YM', 'MYM1!', '/RTY', 'M2K1!'].map(contractMultiplier)).toEqual([50, 50, 5, 5, 20, 2, 5, 0.5, 50, 5]);
    expect(['SPX', 'SPY', 'AAPL', null, undefined, ''].map(contractMultiplier)).toEqual([100, 100, 100, 100, 100, 100]);
  });

  test('only the futures forms are futures: a bare ES is the Eversource stock (100 shares), unknown roots stay 100', () => {
    expect(futuresRoot('ES')).toBeNull();
    expect(contractMultiplier('ES')).toBe(100);
    expect(futuresRoot('/CL')).toBeNull();
    expect(futuresRoot('ESZ2026')).toBeNull();
    expect(futuresRoot('M2K1!')).toBe('M2K');
    expect(futuresRoot('/ES')).toBe('ES');
  });

  test('gexCall / gexPut take the multiplier, 100 by default', () => {
    // 0.02 * 10 * 50 * 50^2 * 0.01 = 250
    expect(gexCall(0.02, 10, 50, 50)).toBeCloseTo(250, 9);
    expect(gexPut(0.02, 10, 50, 50)).toBeCloseTo(-250, 9);
    expect(gexCall(0.02, 10, 50)).toBeCloseTo(500, 9);
  });

  test('levels unchanged, every $ value scaled by multiplier / 100 (ES 0.5, NQ 0.2, YM 0.05)', () => {
    const base = computeGexLevels(FIXTURE, SPOT, 'SPX');
    for (const [sym, f] of [['/ES', 0.5], ['NQ1!', 0.2], ['/YM', 0.05]] as const) {
      const lv = computeGexLevels(FIXTURE, SPOT, sym);
      expect([lv.maxNetGex, lv.minNetGex, lv.netGexPlus, lv.netGexMinus, lv.sumNetGexPlus, lv.sumNetGexMinus, lv.maxPain, lv.maxAbsGamma, lv.zeroGex, lv.pcRatioOi])
        .toEqual([base.maxNetGex, base.minNetGex, base.netGexPlus, base.netGexMinus, base.sumNetGexPlus, base.sumNetGexMinus, base.maxPain, base.maxAbsGamma, base.zeroGex, base.pcRatioOi]);
      // 210000 at 100 per point (computeGexLevels (7.7) above)
      expect(lv.totalNetGex).toBeCloseTo(210000 * f, 6);
      lv.profile.forEach((p, i) => expect(p.absGamma).toBeCloseTo(base.profile[i].absGamma * f, 6));
    }
    expect(computeGexLevels(FIXTURE, SPOT, 'ES').totalNetGex).toBeCloseTo(210000, 6);
  });

  test('the Board scales its money columns, not its counts', () => {
    const one = [{ ...q(EXP_A, 'call', 100, 10), delta: 0.5 }];
    const b100 = computeBoard(one, SPOT);
    const b50 = computeBoard(one, SPOT, contractMultiplier('/ES'));
    // gex 0.01 * 10 * 50 * 100^2 * 0.01 = 500 (1000 at 100); delta 0.5 * 10 * 50 * 100 = 25000
    expect(b50.rows[0].netGex).toBeCloseTo(500, 9);
    expect(b100.rows[0].netGex).toBeCloseTo(1000, 9);
    expect(b50.rows[0].notionalDelta).toBeCloseTo(25000, 9);
    expect(b50.rows[0].totalOi).toBe(10);
    expect(b50.rows[0].absGexShare).toBe(1);
  });
});
