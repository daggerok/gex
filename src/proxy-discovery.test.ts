/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import {
    AUTO_LIVE_ORDER, isLoopbackHost, normalizeProxyBase, probeProxy, sanitizeSourceOverride, sourceChain, sourceLabel,
} from './proxy-discovery';

const fetchOf = (fn: (url: string, init?: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch;

describe('sourceChain: which providers a ticker tries (auto proxy, owner 2026-10-25)', () => {
    test('Auto with the proxy up: CBOE, YAHOO, NASDAQ, then the cache', () => {
        expect(AUTO_LIVE_ORDER).toEqual(['cboe', 'yahoo', 'nasdaq']);
        expect(sourceChain('auto', true)).toEqual(['cboe', 'yahoo', 'nasdaq', 'static']);
    });
    test('Auto with the proxy down or not probed yet: only the cache', () => {
        expect(sourceChain('auto', false)).toEqual(['static']);
        expect(sourceChain('auto', null)).toEqual(['static']);
    });
    test('overrides: always cache, or one fixed provider whatever the probe says', () => {
        expect(sourceChain('static', true)).toEqual(['static']);
        expect(sourceChain('yahoo', false)).toEqual(['yahoo']);
        expect(sourceChain('nasdaq', true)).toEqual(['nasdaq']);
    });
    test('a page that may not talk to the proxy uses only the cache, overrides included', () => {
        expect(sourceChain('auto', true, false)).toEqual(['static']);
        expect(sourceChain('cboe', true, false)).toEqual(['static']);
    });
});

describe('settings values', () => {
    test('an unknown or old saved source is Auto', () => {
        expect(sanitizeSourceOverride('static')).toBe('static');
        expect(sanitizeSourceOverride('cboe')).toBe('cboe');
        expect(sanitizeSourceOverride('marketdata')).toBe('auto');
        expect(sanitizeSourceOverride(undefined)).toBe('auto');
        expect(sanitizeSourceOverride(3)).toBe('auto');
    });
    test('proxy base: trimmed, no trailing slash', () => {
        expect(normalizeProxyBase(' http://localhost:8787/ ')).toBe('http://localhost:8787');
        expect(normalizeProxyBase('')).toBe('');
        expect(normalizeProxyBase(null)).toBe('');
    });
    test('only a page served from this machine probes without asking', () => {
        for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1', 'app.localhost']) expect(isLoopbackHost(h)).toBe(true);
        for (const h of ['daggerok.github.io', '192.168.1.10', '10.0.0.2', 'example.com', '0.0.0.0', '127.0.0.1.nip.io']) expect(isLoopbackHost(h)).toBe(false);
    });
});

describe('probeProxy', () => {
    test('true on a 2xx /health, false on an error status, a network error or no base', async () => {
        const seen: string[] = [];
        expect(await probeProxy('http://localhost:8787/', fetchOf(async (url) => { seen.push(url); return new Response('ok'); }))).toBe(true);
        expect(seen).toEqual(['http://localhost:8787/health']);
        expect(await probeProxy('http://localhost:8787', fetchOf(async () => new Response('x', { status: 503 })))).toBe(false);
        expect(await probeProxy('http://localhost:8787', fetchOf(async () => { throw new TypeError('Failed to fetch'); }))).toBe(false);
        let called = false;
        expect(await probeProxy('  ', fetchOf(async () => { called = true; return new Response('ok'); }))).toBe(false);
        expect(called).toBe(false);
    });
    test('a proxy slower than the timeout counts as down', async () => {
        const slow = fetchOf((_url, init) => new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => resolve(new Response('ok')), 1000);
            init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); });
        }));
        const t0 = Date.now();
        expect(await probeProxy('http://localhost:8787', slow, 50)).toBe(false);
        expect(Date.now() - t0).toBeLessThan(500);
    });
});

describe('sourceLabel', () => {
    test('the provider that served the ticker, with the cache day', () => {
        expect(sourceLabel({ chain: ['cboe', 'yahoo', 'nasdaq', 'static'], probing: false, servedBy: 'yahoo', dataDate: null })).toEqual({ kind: 'live', provider: 'YAHOO' });
        expect(sourceLabel({ chain: ['cboe', 'yahoo', 'nasdaq', 'static'], probing: false, servedBy: 'static', dataDate: '2026-10-23' })).toEqual({ kind: 'cache', date: '2026-10-23' });
    });
    test('before a ticker is loaded: what the next load uses, or checking during the first probe', () => {
        expect(sourceLabel({ chain: ['static'], probing: true, servedBy: null, dataDate: null })).toEqual({ kind: 'checking' });
        expect(sourceLabel({ chain: ['static'], probing: false, servedBy: null, dataDate: null })).toEqual({ kind: 'cache', date: null });
        expect(sourceLabel({ chain: ['cboe', 'yahoo', 'nasdaq', 'static'], probing: false, servedBy: null, dataDate: null })).toEqual({ kind: 'live', provider: null });
    });
    test('a futures file: its own time, not the trading day (owner bug: CACHE 2026-10-23 next to "as of 2026-10-25 21:40")', () => {
        expect(sourceLabel({ chain: ['static'], probing: false, servedBy: 'static', dataDate: '2026-10-23', futuresAt: '2026-10-25 21:40' })).toEqual({ kind: 'cache', date: '2026-10-25 21:40' });
        // no time in the file: the trading day as before; an option ticker passes nothing
        expect(sourceLabel({ chain: ['static'], probing: false, servedBy: 'static', dataDate: '2026-10-23', futuresAt: null })).toEqual({ kind: 'cache', date: '2026-10-23' });
        expect(sourceLabel({ chain: ['static'], probing: false, servedBy: 'static', dataDate: '2026-10-23' })).toEqual({ kind: 'cache', date: '2026-10-23' });
    });
    test('TradingView live mode: LIVE TV hh:mm:ss while streaming, the engine state when it cannot, the file before the first snapshot', () => {
        const base = { chain: ['cboe', 'static'] as ('cboe' | 'static')[], probing: false, servedBy: 'static' as const, dataDate: '2026-10-23', futuresAt: '2026-10-25 21:40' };
        const live = { state: 'live', message: 'streaming ES', until: null };
        expect(sourceLabel({ ...base, tvLive: { streaming: true, at: '10:05:07', status: live } })).toEqual({ kind: 'live', provider: 'TV', at: '10:05:07' });
        expect(sourceLabel({ ...base, tvLive: { streaming: false, at: '', status: { state: 'starting', message: 'starting', until: null } } })).toEqual({ kind: 'cache', date: '2026-10-25 21:40' });
        expect(sourceLabel({ ...base, tvLive: { streaming: false, at: '', status: null } })).toEqual({ kind: 'cache', date: '2026-10-25 21:40' });
        const expired = { state: 'expired', message: 'log in to tradingview.com in Chrome', until: null };
        expect(sourceLabel({ ...base, tvLive: { streaming: true, at: '10:05:07', status: expired } })).toEqual({ kind: 'tv', state: 'expired', message: 'log in to tradingview.com in Chrome', until: null, date: '2026-10-25 21:40' });
    });
});
