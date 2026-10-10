import { afterEach, describe, expect, test } from 'bun:test';
import { fetchOhlc, parseYahooChart, yahooChartSymbol } from './chart';

// Trimmed from a real response of
//   GET https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1mo
// captured 2026-10-04 (first 3 bars), plus one all-null padding row like the
// one observed live in GME 1m data. 1788442200 = 2026-09-03 13:30:00 UTC.
const SPY_BODY = {
    chart: {
        result: [{
            meta: { symbol: 'SPY', gmtoffset: -14400, dataGranularity: '1d', range: '1mo' },
            timestamp: [1788442200, 1788528600, 1788600000, 1788874200],
            indicators: {
                quote: [{
                    open: [767.9000244140625, 772.010009765625, null, 769.0700073242188],
                    high: [774.030029296875, 772.8699951171875, null, 769.7000122070312],
                    low: [766.5, 768.1, null, 764.2],
                    close: [773.1699829101562, 770.1900024414062, null, 765.9600219726562],
                    volume: [43531600, 34054200, null, 44746100],
                }],
                adjclose: [{ adjclose: [773.17, 770.19, null, 765.96] }],
            },
        }],
        error: null,
    },
};

// Verbatim live 404 body for an unknown symbol (also returned for bare "SPX").
const NOT_FOUND_BODY = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } };

describe('parseYahooChart', () => {
    test('zips arrays, skips null rows, normalizes daily bars to UTC midnight', () => {
        const bars = parseYahooChart(SPY_BODY, '1d');
        expect(bars).toHaveLength(3);
        expect(bars[0]).toEqual({
            time: Date.UTC(2026, 8, 3) / 1000,
            open: 767.9000244140625,
            high: 774.030029296875,
            low: 766.5,
            close: 773.1699829101562,
            volume: 43531600,
        });
        expect(bars.map((b) => new Date(b.time * 1000).toISOString().slice(0, 10)))
            .toEqual(['2026-09-03', '2026-09-04', '2026-09-08']);
    });

    test('intraday intervals keep raw timestamps', () => {
        const bars = parseYahooChart(SPY_BODY, '5m');
        expect(bars.map((b) => b.time)).toEqual([1788442200, 1788528600, 1788874200]);
    });

    test('duplicate day keeps the later row and output stays ascending', () => {
        const body = structuredClone(SPY_BODY);
        const r = body.chart.result[0];
        r.timestamp = [1788528600, 1788442200, 1788450000];
        const q = r.indicators.quote[0];
        q.open = [1, 2, 3]; q.high = [1, 2, 3]; q.low = [1, 2, 3]; q.close = [1, 2, 3]; q.volume = [null, 0, 5] as any;
        const bars = parseYahooChart(body, '1d');
        expect(bars.map((b) => [b.close, b.volume])).toEqual([[3, 5], [1, null]]);
    });

    test('throws the upstream description on chart.error', () => {
        expect(() => parseYahooChart(NOT_FOUND_BODY)).toThrow('No data found, symbol may be delisted');
        expect(() => parseYahooChart({})).toThrow('empty response');
    });
});

describe('yahooChartSymbol', () => {
    test('caret-prefixes supported indices only', () => {
        expect(yahooChartSymbol('spx')).toBe('^SPX');
        expect(yahooChartSymbol('^SPX')).toBe('^SPX');
        expect(yahooChartSymbol('SPY')).toBe('SPY');
    });

    // Part A of Phase 3 (agentic-workspace docs/repos/gex/spec-vix-futures.md section 9):
    // VIX/VXN are futures-priced (FUTURES_PRICED_SYMBOLS), not spot indices
    // (INDEX_SYMBOLS), but Yahoo's /chart endpoint still needs the same ^
    // prefix for them — confirmed live, 2026-10-04: ^VIX/^VXN -> HTTP 200,
    // bare VIX/VXN -> HTTP 404 "No data found, symbol may be delisted".
    test('caret-prefixes futures-priced volatility indices (VIX/VXN) too', () => {
        expect(yahooChartSymbol('vix')).toBe('^VIX');
        expect(yahooChartSymbol('^VIX')).toBe('^VIX');
        expect(yahooChartSymbol('VXN')).toBe('^VXN');
    });
});

describe('fetchOhlc', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = realFetch; });
    const mock = (status: number, body: string, seen?: string[]) => {
        globalThis.fetch = (async (url: string) => {
            seen?.push(String(url));
            return new Response(body, { status });
        }) as unknown as typeof fetch;
    };
    const ctx = { proxyBase: 'http://localhost:8787/' };

    test('builds the proxy URL and parses the body', async () => {
        const seen: string[] = [];
        mock(200, JSON.stringify(SPY_BODY), seen);
        const bars = await fetchOhlc('spx', ctx);
        expect(seen).toEqual(['http://localhost:8787/api/chart?symbol=%5ESPX&range=6mo&interval=1d']);
        expect(bars).toHaveLength(3);
    });

    test('surfaces upstream 404, 429 text body and proxy errors', async () => {
        mock(404, JSON.stringify(NOT_FOUND_BODY));
        await expect(fetchOhlc('NOPE', ctx)).rejects.toThrow('symbol may be delisted');
        mock(429, 'Edge: Too Many Requests');
        await expect(fetchOhlc('SPY', ctx)).rejects.toThrow('rate limited');
        mock(400, JSON.stringify({ error: 'unsupported range: 7mo' }));
        await expect(fetchOhlc('SPY', ctx, { range: '7mo' })).rejects.toThrow('unsupported range: 7mo');
        await expect(fetchOhlc('SPY', { proxyBase: '' })).rejects.toThrow('Proxy base URL');
    });
});
