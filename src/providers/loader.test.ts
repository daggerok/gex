/// <reference types="bun" />
/// <reference types="node" />
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { zonedTimeToMs } from '../backtest/snapshot';
import { setValuationTime, yearsToExpiration } from '../greeks';
import { bulkCache, bulkKey } from '../settings-store';
import type { ChainResult, DataProvider, OptionQuote, ProviderContext } from '../types';
import { black76Greeks, black76Price } from '../vix-pricing';
import { getBulk, lazyKey, loadExpiration, loadMeta } from './loader';

// ---------------------------------------------------------------------------
// The bulk cache and settings.vixFuturesPricing: the cached chain of VIX/VXN is enriched with the flag it was loaded
// with, so switching the setting must not hand out greeks of the other pricing (spot-model / provider greeks under the
// Black-76 setting, or Black-76 greeks with the setting off) until the ticker is fetched again.
// ---------------------------------------------------------------------------

const ctx = { proxyTemplate: '', proxyBase: '', token: '', secret: '' } as unknown as ProviderContext;
const R = 0.045;

/** Frozen pricing clock: 16:00 New York on Monday 2026-03-09 (same as vix-gex.test.ts). */
const CLOCK = zonedTimeToMs(2026, 3, 9, 16, 0);
beforeAll(() => setValuationTime(CLOCK));
afterAll(() => setValuationTime(null));
beforeEach(() => bulkCache.clear());

function expInDays(days: number): string {
    return new Date(Date.UTC(2026, 2, 9 + days + 1)).toISOString().slice(0, 10);
}

function q(o: Partial<OptionQuote> & { side: 'call' | 'put'; strike: number; expiration: string }): OptionQuote {
    return {
        symbol: `VIX${o.expiration}${o.side === 'call' ? 'C' : 'P'}${o.strike}`,
        bid: null, ask: null, mid: null, last: null, volume: null, openInterest: 100, iv: null,
        delta: null, gamma: null, theta: null, vega: null,
        ...o,
    };
}

/** One expiration priced exactly off `forward`/`sigma` (Black-76), `iv` as the provider sent it. */
function expiration(exp: string, forward: number, sigma: number, iv: number | null): OptionQuote[] {
    const t = yearsToExpiration(exp)!;
    const out: OptionQuote[] = [];
    for (const strike of [16, 17, 18, 19, 20]) {
        for (const side of ['call', 'put'] as const) {
            const p = black76Price(side, forward, strike, t, sigma, R);
            out.push(q({ side, strike, expiration: exp, bid: p - 0.005, ask: p + 0.005, mid: p, last: p, iv }));
        }
    }
    return out;
}

const EXP_A = expInDays(19);
const EXP_B = expInDays(201);
const FA = 17.648, SIGMA_A = 0.92;
const FB = 20.417, SIGMA_B = 0.40;

function vixChain(iv: number | null, symbol = 'VIX'): ChainResult {
    return {
        symbol, underlyingPrice: 16.5, expirations: [EXP_A, EXP_B],
        quotes: [...expiration(EXP_A, FA, SIGMA_A, iv), ...expiration(EXP_B, FB, SIGMA_B, iv)],
    } as ChainResult;
}

/** A bulk provider that serves a fresh copy of `make()` on every fetch and counts the fetches. */
function bulkProvider(id: string, make: () => ChainResult) {
    const p = {
        id, label: id, description: '', mode: 'bulk', setup: 'none', supportsToken: false, needsProxy: false, needsKeyFor: () => false,
        fetches: 0,
        fetchAll: async () => { p.fetches++; return structuredClone(make()); },
    };
    return p as unknown as DataProvider & { fetches: number };
}

/** Black-76 gamma of `quote` from the true forward/sigma of its expiration. */
function black76Gamma(quote: OptionQuote): number {
    const [forward, sigma] = quote.expiration === EXP_A ? [FA, SIGMA_A] : [FB, SIGMA_B];
    return black76Greeks(quote, forward, sigma, R).greeks!.gamma;
}

function expectBlack76(quotes: OptionQuote[]): void {
    expect(quotes.length).toBe(10);
    for (const qq of quotes) {
        expect(qq.greeksSource).toBe('black-76');
        expect(qq.forward).toBeCloseTo(qq.expiration === EXP_A ? FA : FB, 2);
        expect(qq.gamma!).toBeCloseTo(black76Gamma(qq), 4);
    }
}

describe('bulk cache and the VIX futures pricing setting', () => {
    for (const [label, iv] of [['no provider IV', null], ['a garbage provider IV', 0.00001]] as const) {
        test(`VIX loaded with the setting off, then switched on: Black-76 greeks from each expiration's forward (${label})`, async () => {
            const p = bulkProvider(`t-off-on-${iv}`, () => vixChain(iv));
            await loadMeta(p, 'VIX', ctx, false);
            const off = await loadExpiration(p, 'VIX', EXP_A, ctx, false);
            expect(off.every((qq) => qq.greeksSource !== 'black-76' && qq.gamma == null)).toBe(true);

            // the setting is switched on: the GEX tab reads the bulk chain, Load reads the expirations
            const bulk = await getBulk(p.id, 'VIX', true);
            expect(bulk).not.toBeNull();
            expectBlack76(bulk!.quotes.filter((qq) => qq.expiration === EXP_A));
            expectBlack76(await loadExpiration(p, 'VIX', EXP_A, ctx, true));
            expectBlack76(await loadExpiration(p, 'VIX', EXP_B, ctx, true));
            expect(p.fetches).toBe(1); // re-priced from the chain already fetched, not fetched again
        });
    }

    test('VIX loaded with the setting on, then switched off: no Black-76 greeks are left, the provider IV is back', async () => {
        const p = bulkProvider('t-on-off', () => vixChain(0.00001));
        await loadMeta(p, 'VIX', ctx, true);
        expectBlack76(await loadExpiration(p, 'VIX', EXP_A, ctx, true));

        const off = await loadExpiration(p, 'VIX', EXP_A, ctx, false);
        expect(off.length).toBe(10);
        for (const qq of off) {
            expect(qq.greeksSource).not.toBe('black-76');
            expect(qq.gamma).toBeNull();
            expect(qq.iv).toBe(0.00001);
            expect(qq.greeksMissingReason).toBe('futures_priced');
        }
        const bulk = await getBulk(p.id, 'VIX', false);
        expect(bulk!.quotes.every((qq) => qq.greeksSource !== 'black-76')).toBe(true);
        // and on again: Black-76 once more
        expectBlack76(await loadExpiration(p, 'VIX', EXP_B, ctx, true));
        expect(p.fetches).toBe(1);
    });

    test('a spot-priced symbol is cached under one key whatever the setting (unchanged)', async () => {
        expect(bulkKey('cboe', 'spy')).toBe('cboe:SPY');
        expect(bulkKey('cboe', 'SPY', true)).toBe('cboe:SPY');
        expect(bulkKey('cboe', 'SPY', false)).toBe('cboe:SPY');
        expect(bulkKey('cboe', 'VIX', false)).toBe('cboe:VIX');
        expect(bulkKey('cboe', 'VIX', true)).not.toBe('cboe:VIX');
        expect(bulkKey('cboe', 'vxn', true)).toBe(bulkKey('cboe', 'VXN', true));

        const spy = { ...vixChain(0.2, 'SPY'), underlyingPrice: 18 };
        const p = bulkProvider('t-spy', () => spy);
        await loadMeta(p, 'SPY', ctx, false);
        const a = await getBulk(p.id, 'SPY', false);
        const b = await getBulk(p.id, 'SPY', true);
        expect(b).toBe(a!); // the very same cached object
        expect(Array.from(bulkCache.keys())).toEqual(['t-spy:SPY']);
    });

    test('lazy expiration keys: VIX/VXN get the pricing in the key, every other symbol keeps its key', () => {
        expect(lazyKey('yahoo', 'spy', '2026-04-17')).toBe('yahoo:SPY:2026-04-17');
        expect(lazyKey('yahoo', 'SPY', '2026-04-17', true)).toBe('yahoo:SPY:2026-04-17');
        expect(lazyKey('yahoo', 'VIX', '2026-04-17', false)).toBe('yahoo:VIX:2026-04-17');
        expect(lazyKey('yahoo', 'VIX', '2026-04-17', true)).not.toBe('yahoo:VIX:2026-04-17');
        expect(lazyKey('yahoo', '^VIX', 'meta', true)).toBe('yahoo:^VIX:meta'); // the meta does not depend on the pricing
    });
});
