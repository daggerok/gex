/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { EMPTY_QUOTES_BY_EXP, gexChainKey, groupByExpiration, pickGexQuotesByExp, type QuotesByExp } from './gex-chain';
import type { OptionQuote } from './types';

const quote = (symbol: string, expiration: string, strike: number): OptionQuote => ({
    symbol, expiration, side: 'call', strike,
    bid: null, ask: null, mid: null, last: null, volume: null, openInterest: 1, iv: null,
    delta: null, gamma: 0.01, theta: null, vega: null,
});

const SPY_BULK: QuotesByExp = { '2026-10-30': [quote('SPY', '2026-10-30', 700)] };
const QQQ_DESK: QuotesByExp = { '2026-10-30': [quote('QQQ', '2026-10-30', 600)] };
const SPY_KEY = gexChainKey('static', 'SPY', false);
const QQQ_KEY = gexChainKey('static', 'QQQ', false);

describe('gexChainKey and groupByExpiration', () => {
    test('the key tells provider, symbol and VIX pricing apart', () => {
        expect(new Set([gexChainKey('static', 'SPY', false), gexChainKey('cboe', 'SPY', false), gexChainKey('static', 'QQQ', false), gexChainKey('static', 'SPY', true)]).size).toBe(4);
    });

    test('quotes grouped by expiration in their order', () => {
        const a = quote('X', '2026-10-30', 1);
        const b = quote('X', '2026-11-06', 2);
        const c = quote('X', '2026-10-30', 3);
        expect(groupByExpiration([a, b, c])).toEqual({ '2026-10-30': [a, c], '2026-11-06': [b] });
    });

    test('only the listed expirations (an expired one of a stale file is left out, GEX-H4)', () => {
        const old = quote('X', '2026-10-16', 1);
        const live = quote('X', '2026-10-30', 2);
        expect(groupByExpiration([old, live], ['2026-10-30'])).toEqual({ '2026-10-30': [live] });
    });
});

describe('pickGexQuotesByExp (GEX-H1: never the previous ticker under the new symbol)', () => {
    test('bulk: right after SPY -> QQQ the SPY chain is not handed out, the QQQ one once it is read', () => {
        // the frame with the new meta (QQQ) while the bulk state still holds SPY: nothing, so levels are null for a frame
        expect(pickGexQuotesByExp({ mode: 'bulk', key: QQQ_KEY, bulk: { key: SPY_KEY, byExp: SPY_BULK }, expData: {}, chainSymbol: '', symbol: 'QQQ' })).toBe(EMPTY_QUOTES_BY_EXP);
        const qqqBulk: QuotesByExp = { '2026-10-30': [quote('QQQ', '2026-10-30', 600)] };
        expect(pickGexQuotesByExp({ mode: 'bulk', key: QQQ_KEY, bulk: { key: QQQ_KEY, byExp: qqqBulk }, expData: {}, chainSymbol: '', symbol: 'QQQ' })).toBe(qqqBulk);
    });

    test('bulk: a click on another expiration keeps the same object (one level computation per click, GEX-H10)', () => {
        const bulk = { key: SPY_KEY, byExp: SPY_BULK };
        const a = pickGexQuotesByExp({ mode: 'bulk', key: SPY_KEY, bulk, expData: {}, chainSymbol: 'SPY', symbol: 'SPY' });
        const b = pickGexQuotesByExp({ mode: 'bulk', key: SPY_KEY, bulk, expData: { '2026-10-30': [] }, chainSymbol: 'SPY', symbol: 'SPY' });
        expect(b).toBe(a);
    });

    test('bulk cache miss or a failed read: the loaded expData of the current symbol only', () => {
        expect(pickGexQuotesByExp({ mode: 'bulk', key: QQQ_KEY, bulk: { key: QQQ_KEY, byExp: null }, expData: QQQ_DESK, chainSymbol: 'QQQ', symbol: 'QQQ' })).toBe(QQQ_DESK);
        expect(pickGexQuotesByExp({ mode: 'bulk', key: QQQ_KEY, bulk: { key: QQQ_KEY, byExp: null }, expData: SPY_BULK, chainSymbol: 'SPY', symbol: 'QQQ' })).toBe(EMPTY_QUOTES_BY_EXP);
    });

    test('lazy (YAHOO): expData only when it was loaded for the current symbol', () => {
        const key = gexChainKey('yahoo', 'QQQ', false);
        expect(pickGexQuotesByExp({ mode: 'lazy', key, bulk: null, expData: QQQ_DESK, chainSymbol: 'QQQ', symbol: 'QQQ' })).toBe(QQQ_DESK);
        expect(pickGexQuotesByExp({ mode: 'lazy', key, bulk: null, expData: SPY_BULK, chainSymbol: 'SPY', symbol: 'QQQ' })).toBe(EMPTY_QUOTES_BY_EXP);
    });

    test('no ticker: nothing', () => {
        expect(pickGexQuotesByExp({ mode: 'bulk', key: null, bulk: { key: SPY_KEY, byExp: SPY_BULK }, expData: SPY_BULK, chainSymbol: 'SPY', symbol: null })).toBe(EMPTY_QUOTES_BY_EXP);
    });
});
