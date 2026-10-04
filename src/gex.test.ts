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
  gexCall,
  gexPut,
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

describe('findGammaFlip (7.3)', () => {
  test('normal case: interpolates where cumulative netGex crosses zero', () => {
    // cumulative goes -50000 @100 -> +50000 @105:
    // flip = 100 + 5 * (0 - (-50000)) / (50000 - (-50000)) = 100 + 2.5
    expect(findGammaFlip(computeGexProfile(FIXTURE, SPOT))).toBeCloseTo(102.5, 9);
  });

  test('single expiration gives a different flip than the aggregate', () => {
    // EXP_A cumulative: -20000 @90, -40000 @95, -40000 @100, +20000 @105
    // flip = 100 + 5 * 40000 / 60000 = 103.333...
    const profile = computeGexProfile(FIXTURE.filter((x) => x.expiration === EXP_A), SPOT);
    expect(findGammaFlip(profile)).toBeCloseTo(100 + 5 * (40000 / 60000), 9);
  });

  test('cumulative exactly zero at a strike returns that strike', () => {
    // -X @90, +X @95 (identical gamma/OI, so the sum is exactly 0), then +
    const profile = computeGexProfile(
      [q(EXP_A, 'put', 90, 100), q(EXP_A, 'call', 95, 100), q(EXP_A, 'call', 100, 50)],
      SPOT,
    );
    expect(findGammaFlip(profile)).toBe(95);
  });

  test('all-same-sign gamma exposure -> null (no extrapolation)', () => {
    const callsOnly = FIXTURE.filter((x) => x.side === 'call');
    expect(findGammaFlip(computeGexProfile(callsOnly, SPOT))).toBeNull();
    const putsOnly = FIXTURE.filter((x) => x.side === 'put');
    expect(findGammaFlip(computeGexProfile(putsOnly, SPOT))).toBeNull();
    expect(findGammaFlip([])).toBeNull();
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

describe('computeGexLevels (7.7)', () => {
  test('assembles every level from one call', () => {
    const levels = computeGexLevels(FIXTURE, SPOT);
    expect(levels.spot).toBe(SPOT);
    expect(levels.gammaFlip).toBeCloseTo(102.5, 9);
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
