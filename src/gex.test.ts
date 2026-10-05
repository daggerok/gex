import { describe, expect, test } from 'bun:test';
import {
  CONTRACT_MULTIPLIER,
  SECOND_WALL_MIN_DISTANCE_PCT,
  computeGexLevels,
  computeGexProfile,
  computeMaxPain,
  computeOiVolumeTotals,
  computePCRatio,
  findCallPutWalls,
  findGammaFlip,
  findGammaFlipCrossings,
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

// Minimal helper for findGammaFlip tests that only care about the netGex
// column - the function never reads callGex/putGex/OI/volume, so the other
// fields are filler.
function gp(strike: number, netGex: number): import('./types').GexPoint {
  return { strike, callGex: 0, putGex: 0, netGex, callOi: 0, putOi: 0, callVolume: 0, putVolume: 0 };
}

describe('findGammaFlip (7.3, redefined: the LAST profile zero-crossing, not a cumulative sum)', () => {
  test('normal case: anchors to the real bar immediately following the single crossing, no interpolation', () => {
    // FIXTURE's per-strike (NOT cumulative) netGex: -40000@90, -20000@95,
    // +10000@100, +100000@105, +80000@106, +30000@110, +50000@115.
    // Only one sign change in the whole profile: 95 (-20000) -> 100 (+10000),
    // a neg -> pos transition, so pos is the only non-null side. The flip is
    // the real bar that follows the transition, strike 100 itself - not an
    // interpolated fractional value between 95 and 100.
    const expected = 100;
    const profile = computeGexProfile(FIXTURE, SPOT);
    expect(findGammaFlipCrossings(profile, SPOT)).toEqual({ pos: expected, neg: null });
    // totalNetGex = 210000 (positive, see computeGexLevels test below), so
    // the legacy collapse picks gammaFlipPos.
    expect(findGammaFlip(profile, SPOT)).toBe(expected);
  });

  test('single expiration slice: an exact netGex === 0 strike bridging a sign change is itself the flip', () => {
    // EXP_A-only per-strike netGex: -20000@90, -20000@95, 0@100, +60000@105,
    // +80000@106 (hand-derived: strike 100 has call OI 200 vs put OI 200 at
    // the same gamma, so callGex + putGex nets to exactly 0 there).
    // 100 sits between -20000 (@95) and +60000 (@105) - an exact-zero strike
    // bridging a sign change IS the crossing (see findGammaFlipCrossings'
    // doc comment), so the flip is exactly 100, no interpolation. The
    // transition is neg -> pos, so pos = 100 and neg stays null (only one
    // crossing exists in this slice).
    const profile = computeGexProfile(FIXTURE.filter((x) => x.expiration === EXP_A), SPOT);
    expect(profile.find((p) => p.strike === 100)!.netGex).toBe(0);
    expect(findGammaFlipCrossings(profile, SPOT)).toEqual({ pos: 100, neg: null });
    expect(findGammaFlip(profile, SPOT)).toBe(100);
  });

  test('an exact netGex === 0 strike NOT bridging a sign change is not a crossing', () => {
    // -100 @90, 0 @95, -50 @100: the zero sits between two NEGATIVE
    // neighbors (same sign both sides), so it is flat/noise, not a flip -
    // neither direction crosses anywhere in this profile.
    const profile = [gp(90, -100), gp(95, 0), gp(100, -50)];
    expect(findGammaFlipCrossings(profile, 100)).toEqual({ pos: null, neg: null });
    expect(findGammaFlip(profile, 100)).toBeNull();
  });

  test('multiple sign crossings (neg->pos->neg->pos): gammaFlipPos/gammaFlipNeg are the two distinct last crossings, both real bars; gammaFlip resolves by totalNetGex sign', () => {
    // Mirrors the user's own real-chain example: a small isolated anomalous
    // strike (or two) sandwiched inside what's otherwise a clean transition
    // from a big negative valley to a big positive peak, producing three
    // crossings close together (a last pos->neg AND a separate last
    // neg->pos) instead of one clean one - exactly the shape the "Gamma
    // Flip +" / "Gamma Flip -" UI split is meant to expose.
    // netGex alternates sign every strike: -10@90, +10@95, -10@100, +10@105.
    // Each crossing is anchored to the real bar immediately following the
    // transition (no interpolation), in ascending-strike order:
    //   90->95:   the bar at 95 (neg -> pos)
    //   95->100:  the bar at 100 (pos -> neg)
    //   100->105: the bar at 105 (neg -> pos)
    // Last neg->pos transition overwrites the earlier one: pos = 105 (not
    // 95, both are real array strikes). Last (and only) pos->neg transition:
    // neg = 100.
    // totalNetGex = -10 + 10 - 10 + 10 = 0, which is NOT > 0, so the legacy
    // collapse rule (totalNetGex > 0 ? pos : neg) picks neg: gammaFlip = 100.
    // This is the disagreeing-example case: pos (105) and neg (100) differ,
    // and the collapse does not simply pick the higher strike anymore.
    // spot = 93 is deliberately placed so "nearest to spot" would instead
    // pick 95 - proving this asserts the "last crossing per direction" rule,
    // not a nearest-to-spot tie-break.
    const profile = [gp(90, -10), gp(95, 10), gp(100, -10), gp(105, 10)];
    expect(findGammaFlipCrossings(profile, 93)).toEqual({ pos: 105, neg: 100 });
    expect(findGammaFlip(profile, 93)).toBe(100);
  });

  test('leading zero-netGex strikes are not a crossing (CBOE far-OTM exact-zero gamma)', () => {
    // Real CBOE chains report gamma 0 for far-from-the-money strikes, so the
    // lowest strikes net to exactly 0. Same rows as FIXTURE plus two such
    // strikes below it: the flip must stay at the normal single crossing
    // (95 -> 100, neg -> pos), not be misread as a crossing down at the
    // leading zeros. The flip is the real bar at 100 (no interpolation).
    const expected = 100;
    const withZeroWings = [...FIXTURE, q(EXP_A, 'call', 80, 900, 0), q(EXP_A, 'put', 80, 900, 0), q(EXP_A, 'put', 85, 400, 0)];
    const profile = computeGexProfile(withZeroWings, SPOT);
    expect(profile[0].strike).toBe(80);
    expect(profile[0].netGex).toBe(0);
    expect(findGammaFlipCrossings(profile, SPOT)).toEqual({ pos: expected, neg: null });
    // The zero-gamma wing strikes contribute 0 GEX, so totalNetGex is the
    // same 210000 as plain FIXTURE (positive) -> collapse picks pos.
    expect(findGammaFlip(profile, SPOT)).toBe(expected);
    // An all-zero profile never crosses either, in either direction.
    const allZeroProfile = computeGexProfile([q(EXP_A, 'call', 80, 10, 0), q(EXP_A, 'put', 85, 10, 0)], SPOT);
    expect(findGammaFlipCrossings(allZeroProfile, SPOT)).toEqual({ pos: null, neg: null });
    expect(findGammaFlip(allZeroProfile, SPOT)).toBeNull();
  });

  test('all-same-sign gamma exposure -> null in both directions (no extrapolation)', () => {
    const callsOnly = computeGexProfile(FIXTURE.filter((x) => x.side === 'call'), SPOT);
    expect(findGammaFlipCrossings(callsOnly, SPOT)).toEqual({ pos: null, neg: null });
    expect(findGammaFlip(callsOnly, SPOT)).toBeNull();
    const putsOnly = computeGexProfile(FIXTURE.filter((x) => x.side === 'put'), SPOT);
    expect(findGammaFlipCrossings(putsOnly, SPOT)).toEqual({ pos: null, neg: null });
    expect(findGammaFlip(putsOnly, SPOT)).toBeNull();
    expect(findGammaFlipCrossings([], SPOT)).toEqual({ pos: null, neg: null });
    expect(findGammaFlip([], SPOT)).toBeNull();
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
    // gammaFlip: only two strikes, netGex -2491.615232@15 then +6229.03808@20
    // - one neg -> pos sign change, so gammaFlipPos is the real bar at 20
    // (no interpolation) and gammaFlipNeg stays null (no pos -> neg
    // transition exists here). totalNetGex is positive, so the legacy
    // collapse picks gammaFlipPos.
    expect(levels.gammaFlipPos).toBe(20);
    expect(levels.gammaFlipNeg).toBeNull();
    expect(levels.gammaFlip).toBe(levels.gammaFlipPos);
  });
});

describe('computeGexLevels (7.7)', () => {
  test('assembles every level from one call', () => {
    const levels = computeGexLevels(FIXTURE, SPOT);
    expect(levels.spot).toBe(SPOT);
    // Per-strike netGex crosses sign once, 95 (-20000) -> 100 (+10000), a
    // neg -> pos transition: the flip is the real bar at 100, no
    // interpolation. Only one direction crosses, so gammaFlipPos holds it
    // and gammaFlipNeg is null; totalNetGex (210000, asserted below) is
    // positive, so gammaFlip (the derived legacy field) picks gammaFlipPos.
    const expectedFlip = 100;
    expect(levels.gammaFlipPos).toBe(expectedFlip);
    expect(levels.gammaFlipNeg).toBeNull();
    expect(levels.gammaFlip).toBe(expectedFlip);
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
