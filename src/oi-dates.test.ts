/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { chainFromCacheFile } from './providers/cache';
import { latestOiDate, markStaleOi, staleOiSummary } from './oi-dates';
import type { OptionQuote } from './types';

const q = (strike: number, oi: number | null, oiDate?: string | null): OptionQuote => ({
    symbol: `X${strike}`, expiration: '2026-10-30', side: 'call', strike, bid: null, ask: null, mid: null, last: null, volume: null,
    openInterest: oi, iv: null, delta: null, gamma: null, theta: null, vega: null, ...(oiDate !== undefined ? { oiDate } : {}),
});

describe('TradingView OI dates (owner decision G10: keep, mark, count)', () => {
    test('the newest day; older ones marked stale, values untouched; quotes without dates unchanged', () => {
        const quotes = [q(1, 100, '2026-10-23'), q(2, 50, '2026-10-15'), q(3, null, null), q(4, 7, '2026-10-23')];
        expect(latestOiDate(quotes)).toBe('2026-10-23');
        const marked = markStaleOi(quotes);
        expect(marked.map((x) => Boolean(x.oiStale))).toEqual([false, true, false, false]);
        expect(marked.map((x) => x.openInterest)).toEqual([100, 50, null, 7]);
        expect(marked[0]).toBe(quotes[0]);
        const plain = [q(1, 10), q(2, 20)];
        expect(markStaleOi(plain)).toBe(plain);
        expect(latestOiDate(plain)).toBeNull();
    });

    test('summary: share of the OI and the count of older contracts; null without old ones', () => {
        const s = staleOiSummary([q(1, 900, '2026-10-23'), q(2, 60, '2026-10-15'), q(3, 40, '2026-09-21'), q(4, null, '2026-09-01')]);
        expect(s).toEqual({ latest: '2026-10-23', contracts: 2, oi: 100, total: 1000, share: 0.1 });
        expect(staleOiSummary([q(1, 5, '2026-10-23')])).toBeNull();
        expect(staleOiSummary([q(1, 5)])).toBeNull();
    });

    test('the CACHE parse of a futures file keeps oiDate and marks the old ones; an options file has none', () => {
        const file = { quotes: [
            { symbol: 'A', expiration: '2026-10-30', side: 'call', strike: 1, openInterest: 5, oiDate: '2026-10-23' },
            { symbol: 'B', expiration: '2026-10-30', side: 'put', strike: 1, openInterest: 3, oiDate: '2026-10-20' },
            { symbol: 'C', expiration: '2026-10-30', side: 'put', strike: 2, openInterest: 3, oiDate: 'junk' },
        ] };
        const chain = chainFromCacheFile('/ES', file, 'api/futures/ES.json');
        expect(chain.quotes.map((x) => [x.oiDate ?? null, Boolean(x.oiStale)])).toEqual([['2026-10-23', false], ['2026-10-20', true], [null, false]]);
        const opt = chainFromCacheFile('SPY', { quotes: [{ symbol: 'S', expiration: '2026-10-30', side: 'call', strike: 1, openInterest: 1 }] }, 'x');
        expect('oiDate' in opt.quotes[0]).toBe(false);
    });
});
