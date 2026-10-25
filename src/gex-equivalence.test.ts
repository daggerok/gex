/// <reference types="bun" />
/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zonedTimeToMs } from './backtest/snapshot';
import { GAMMA_FLIP_GRID_POINTS, GAMMA_FLIP_MIN_IV, GAMMA_FLIP_RANGE_PCT, computeMaxPain, gammaFlipSweepCrossings, gexCall, gexPut, repairImpliedVols, type GammaFlipCrossing } from './gex';
import { blackScholesGreeks, enrichChainResult, setValuationTime } from './greeks';
import { chainFromCacheFile } from './providers/cache';
import type { OptionQuote } from './types';

// ============================================================================
// GEX-H9: the gamma-only flip sweep and the prefix-sum max pain must give EXACTLY what the old code gave. The old code
// is kept here as the reference (full blackScholesGreeks per quote and grid point; strikes x quotes payout loop) and
// both are compared with `toEqual` on random chains and on the real SPY / QQQ cache files.
// ============================================================================

// Frozen pricing clock: 16:00 New York on Monday 2026-03-09 (see gex.test.ts)
beforeAll(() => setValuationTime(zonedTimeToMs(2026, 3, 9, 16, 0)));
afterAll(() => setValuationTime(null));

const day = (n: number) => new Date(Date.UTC(2026, 2, 9 + n)).toISOString().slice(0, 10);

/** The sweep before GEX-H9, verbatim apart from the names. */
function referenceCrossings(quotes: readonly OptionQuote[], spot: number): GammaFlipCrossing[] {
    if (!Number.isFinite(spot) || spot <= 0) return [];
    const eligible = quotes.filter(
        (q) => !(typeof q.forward === 'number' && Number.isFinite(q.forward) && q.forward > 0)
            && typeof q.iv === 'number' && Number.isFinite(q.iv) && q.iv >= GAMMA_FLIP_MIN_IV,
    );
    if (eligible.length === 0) return [];
    const low = spot * (1 - GAMMA_FLIP_RANGE_PCT);
    const high = spot * (1 + GAMMA_FLIP_RANGE_PCT);
    const step = (high - low) / (GAMMA_FLIP_GRID_POINTS - 1);
    const grid: { S: number; total: number }[] = [];
    for (let i = 0; i < GAMMA_FLIP_GRID_POINTS; i++) {
        const S = i === GAMMA_FLIP_GRID_POINTS - 1 ? high : low + step * i;
        let total = 0;
        for (const quote of eligible) {
            const oi = typeof quote.openInterest === 'number' && Number.isFinite(quote.openInterest) ? quote.openInterest : 0;
            if (oi === 0) continue;
            const { greeks } = blackScholesGreeks(quote, S);
            if (!greeks) continue;
            total += quote.side === 'call' ? gexCall(greeks.gamma, oi, S) : gexPut(greeks.gamma, oi, S);
        }
        grid.push({ S, total });
    }
    const crossings: GammaFlipCrossing[] = [];
    let prevSign: -1 | 1 | null = null;
    let prevNonZero: { S: number; total: number } | null = null;
    let pendingZeroS: number[] = [];
    for (const point of grid) {
        if (point.total === 0) { pendingZeroS.push(point.S); continue; }
        const sign: -1 | 1 = point.total > 0 ? 1 : -1;
        if (prevSign !== null && sign !== prevSign && prevNonZero) {
            const crossing = pendingZeroS.length > 0
                ? pendingZeroS[pendingZeroS.length - 1]
                : prevNonZero.S + (0 - prevNonZero.total) * (point.S - prevNonZero.S) / (point.total - prevNonZero.total);
            crossings.push({ price: crossing, direction: sign });
        }
        pendingZeroS = [];
        prevSign = sign;
        prevNonZero = point;
    }
    return crossings;
}

/** Max pain before GEX-H9, verbatim. */
function referenceMaxPain(quotes: readonly OptionQuote[]): number | null {
    const strikes = Array.from(new Set(quotes.map((q) => q.strike).filter((k) => Number.isFinite(k)))).sort((a, b) => a - b);
    let best: number | null = null;
    let bestPayout = Infinity;
    for (const s of strikes) {
        let payout = 0;
        for (const q of quotes) {
            const oi = typeof q.openInterest === 'number' && Number.isFinite(q.openInterest) ? q.openInterest : 0;
            payout += q.side === 'call' ? oi * Math.max(0, s - q.strike) : oi * Math.max(0, q.strike - s);
        }
        if (payout < bestPayout) { bestPayout = payout; best = s; }
    }
    return best;
}

/** Deterministic pseudo-random numbers (LCG), so a failure can be replayed. */
function rng(seed: number): () => number {
    let x = seed >>> 0;
    return () => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        return x / 2 ** 32;
    };
}

function randomChain(seed: number): { quotes: OptionQuote[]; spot: number } {
    const r = rng(seed);
    const spot = 20 + r() * 7000;
    const step = [0.5, 1, 2.5, 5, 0.1, 0.25][Math.floor(r() * 6)];
    const n = 5 + Math.floor(r() * 80);
    const quotes: OptionQuote[] = [];
    const exps = [day(-3), day(0), day(1), day(4), day(30), day(200)];
    for (let i = 0; i < n; i++) {
        const strike = Math.round((spot * (0.7 + r() * 0.6)) / step) * step;
        const roll = r();
        quotes.push({
            symbol: `R${seed}-${i}`, expiration: exps[Math.floor(r() * exps.length)], side: r() < 0.5 ? 'call' : 'put', strike,
            bid: null, ask: null, mid: null, last: null, volume: null,
            openInterest: roll < 0.1 ? null : roll < 0.2 ? 0 : Math.floor(r() * 50_000),
            iv: roll > 0.9 ? 0.00001 : 0.03 + r() * 1.5,
            delta: null, gamma: r() * 0.01, theta: null, vega: null,
        });
    }
    return { quotes, spot };
}

describe('gamma-only flip sweep = the full-greeks sweep (GEX-H9)', () => {
    test('300 random chains (strike steps, expired and 0DTE dates, null / zero OI, broken IVs): the same crossings', () => {
        let withCrossings = 0;
        for (let seed = 1; seed <= 300; seed++) {
            const { quotes, spot } = randomChain(seed);
            const expected = referenceCrossings(quotes, spot);
            if (expected.length) withCrossings++;
            expect({ seed, crossings: gammaFlipSweepCrossings(quotes, spot) }).toEqual({ seed, crossings: expected });
        }
        expect(withCrossings).toBeGreaterThan(30); // the comparison is not vacuous
    });

    for (const symbol of ['SPY', 'QQQ']) {
        test(`${symbol} cache file, first 5 expirations and every expiration, raw and with repaired IVs: the same crossings`, () => {
            const raw = JSON.parse(readFileSync(join(__dirname, '..', 'api', 'options', `${symbol}.json`), 'utf8'));
            const chain = enrichChainResult(chainFromCacheFile(symbol, raw, symbol));
            const spot = chain.underlyingPrice as number;
            // value the chain the day before its first expiration, so every date is live
            setValuationTime(zonedTimeToMs(...(chain.expirations[0].split('-').map(Number) as [number, number, number]), 10, 0) - 86_400_000);
            try {
                const first5 = new Set(chain.expirations.slice(0, 5));
                for (const quotes of [chain.quotes.filter((q) => first5.has(q.expiration)), chain.quotes]) {
                    for (const input of [quotes, repairImpliedVols(quotes, spot)]) {
                        expect(gammaFlipSweepCrossings(input, spot)).toEqual(referenceCrossings(input, spot));
                    }
                }
            } finally {
                setValuationTime(zonedTimeToMs(2026, 3, 9, 16, 0));
            }
        });
    }
});

describe('prefix-sum max pain = the strikes x quotes max pain (GEX-H9)', () => {
    test('300 random chains: the same strike', () => {
        for (let seed = 1; seed <= 300; seed++) {
            const { quotes } = randomChain(seed);
            expect({ seed, maxPain: computeMaxPain(quotes) }).toEqual({ seed, maxPain: referenceMaxPain(quotes) });
        }
    });

    test('exact ties still go to the lowest strike, also with fractional strikes', () => {
        const q = (side: 'call' | 'put', strike: number, openInterest: number): OptionQuote => ({
            symbol: `${side}${strike}`, expiration: day(5), side, strike, bid: null, ask: null, mid: null, last: null, volume: null,
            openInterest, iv: null, delta: null, gamma: null, theta: null, vega: null,
        });
        // payout 2 at 10 (the put 12), at 11 (call 10 + put 12) and at 12 (the call 10): a three-way tie -> 10
        const symmetric = [q('call', 10, 1), q('put', 12, 1), q('call', 11, 0), q('put', 11, 0)];
        expect(referenceMaxPain(symmetric)).toBe(10);
        expect(computeMaxPain(symmetric)).toBe(10);
        const tenths = [q('call', 0.1, 3), q('call', 0.2, 3), q('put', 0.3, 3), q('put', 0.4, 3), q('call', 0.3, 1), q('put', 0.2, 1)];
        expect(computeMaxPain(tenths)).toBe(referenceMaxPain(tenths));
        // a rounding tie: 0.5 and 0.6 pay the same in exact arithmetic, the prefix sums alone would pick 0.6 (found by a
        // random search; the re-pricing of the near-minimum strikes keeps the old 0.5)
        const rounding = [q('put', 0.6, 3), q('call', 0.9, 2), q('call', 0.1, 3), q('put', 0.5, 2)];
        expect(referenceMaxPain(rounding)).toBe(0.5);
        expect(computeMaxPain(rounding)).toBe(0.5);
        expect(computeMaxPain([])).toBeNull();
    });

    for (const symbol of ['SPY', 'QQQ']) {
        test(`${symbol} cache file, every expiration and each one alone: the same strike`, () => {
            const raw = JSON.parse(readFileSync(join(__dirname, '..', 'api', 'options', `${symbol}.json`), 'utf8'));
            const chain = chainFromCacheFile(symbol, raw, symbol);
            expect(computeMaxPain(chain.quotes)).toBe(referenceMaxPain(chain.quotes));
            for (const exp of chain.expirations) {
                const slice = chain.quotes.filter((q) => q.expiration === exp);
                expect({ exp, maxPain: computeMaxPain(slice) }).toEqual({ exp, maxPain: referenceMaxPain(slice) });
            }
        });
    }
});
