/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { futuresLiveUrl, LIVE_APPLY_MAX_MS, LIVE_APPLY_MS, liveApplyDelay, LiveChainState, nyTime } from './futures-live';

const payload = () => ({
    symbol: 'ES', updated: '2026-10-25T21:40:00-04:00', date: '2026-10-23', underlyingPrice: 7650, expirations: ['2099-01-16'],
    quotes: [
        { symbol: 'E4A990116C7600', expiration: '2099-01-16', side: 'call', strike: 7600, bid: 100, ask: 101, mid: 100.5, last: null, volume: 1, openInterest: 5, iv: 0.2, delta: 0.6, gamma: 0.001, theta: null, vega: null, rho: null },
        { symbol: 'E4A990116P7600', expiration: '2099-01-16', side: 'put', strike: 7600, bid: 50, ask: 51, mid: 50.5, last: null, volume: 1, openInterest: 7, iv: 0.2, delta: -0.4, gamma: 0.001, theta: null, vega: null, rho: null },
    ],
});

describe('TradingView live mode in the app', () => {
    test('stream url and the New York time of the label', () => {
        expect(futuresLiveUrl('http://localhost:8787/', 'ES')).toBe('http://localhost:8787/api/futures/live?root=ES');
        expect(nyTime('2026-10-26T14:05:07.000Z')).toBe('10:05:07');
        expect(nyTime(null)).toBe('');
    });

    test('snapshot, then deltas in place (unknown options ignored), greeks rows; nothing before the snapshot', () => {
        const s = new LiveChainState();
        s.applyDelta('2026-10-26T14:05:07.000Z', [['E4A990116C7600', 1, 2, null, 1, 1]]);
        expect(s.ready).toBe(false);
        expect(s.toChain('/ES')).toBeNull();
        s.applySnapshot(payload());
        s.applyDelta('2026-10-26T14:05:08.000Z', [['E4A990116C7600', 110, 112, 111, 9, 6], ['NOPE', 1, 1, 1, 1, 1]]);
        s.applyGreeks([['E4A990116P7600', 0.3, -0.5, 0.002, null, null, null]]);
        expect(s.dirty).toBe(true);
        const chain = s.toChain('/ES')!;
        expect(s.dirty).toBe(false);
        expect(chain.symbol).toBe('/ES');
        expect(chain.updated).toBe('2026-10-26T14:05:08.000Z');
        const call = chain.quotes.find((q) => q.symbol === 'E4A990116C7600')!;
        expect([call.bid, call.ask, call.mid, call.last, call.volume, call.openInterest]).toEqual([110, 112, 111, 111, 9, 6]);
        expect(chain.quotes).toHaveLength(2);
        expect(s.tvGamma.get('E4A990116P7600')).toBe(0.002);
    });

    test('update pacing: once a second, slower when an update is heavy, at most every 5 s', () => {
        expect(liveApplyDelay(null)).toBe(LIVE_APPLY_MS);
        expect(liveApplyDelay(15)).toBe(1000);
        expect(liveApplyDelay(80)).toBe(1600);
        expect(liveApplyDelay(1000)).toBe(LIVE_APPLY_MAX_MS);
    });
});
