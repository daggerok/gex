/// <reference lib="esnext" />
import { futuresRoot } from '../gex';
import { FUTURES_PRICED_SYMBOLS, INDEX_SYMBOLS } from '../greeks';
import type { OhlcBar, ProviderContext } from '../types';
import { dbg, num, UiError } from '../utils';
import { fetchStaticJson } from './cache';

/**
 * OHLC price history client for the Chart tab (plan section 6.3).
 *
 * NOT a chain DataProvider - the 4 chain providers (CACHE/CBOE/NASDAQ/YAHOO) are
 * untouched. This is a separate fetch that only the Chart tab will use.
 *
 * Endpoint: GET {proxyBase}/api/chart?symbol=SPY&range=6mo&interval=1d
 *   -> relayed as-is from https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
 *      by scripts/options-local-proxy.ts.
 *   No crumb/cookie session (verified live, unlike the options endpoint).
 *
 * Observed upstream shapes (live, 2026-10-04):
 *   200 -> { chart: { result: [{ meta: { gmtoffset, ... }, timestamp: [...],
 *            indicators: { quote: [{ open, high, low, close, volume }], adjclose } }], error: null } }
 *   404 -> { chart: { result: null, error: { code: "Not Found",
 *            description: "No data found, symbol may be delisted" } } }   (bad symbol, also bare "SPX")
 *   400 -> { chart: { result: null, error: { code: "Bad Request", description: "Invalid input - interval=..." } } }
 *   429 -> text/html body "Edge: Too Many Requests" (not JSON)
 * Daily timestamps are the session OPEN (e.g. 13:30 UTC for SPY), not midnight;
 * parseYahooChart normalizes daily+ bars to UTC midnight of the exchange-local date.
 */

export const DEFAULT_CHART_RANGE = '6mo';
export const DEFAULT_CHART_INTERVAL = '1d';

/** Intervals whose bars represent whole trading days (or longer). */
const DAILY_OR_LONGER = new Set(['1d', '5d', '1wk', '1mo', '3mo']);
const DAY_SECONDS = 86_400;

export interface ChartRequest {
    range?: string;
    interval?: string;
}

/**
 * Yahoo lists cash indices only in caret form (^SPX); bare SPX answers 404.
 * Futures-priced volatility indices (VIX/VXN, FUTURES_PRICED_SYMBOLS) need the
 * same ^ prefix for the chart endpoint — this is just the spot index's own
 * price history (candles), which has always been correct; only the OPTIONS
 * pricing model needed Black-76 (src/vix-pricing.ts). Confirmed live
 * (2026-10-04): query1.finance.yahoo.com/v8/finance/chart/%5EVIX -> HTTP 200
 * with real quotes; the bare .../chart/VIX -> HTTP 404 "No data found,
 * symbol may be delisted" (same for VXN).
 */
export function yahooChartSymbol(symbol: string): string {
    // a futures ticker (/ES, ES1!, the micros: gex.ts futuresRoot) has its candles on Yahoo as the continuous front month
    // ES=F, NQ=F, YM=F, RTY=F, MES=F, MNQ=F, MYM=F, M2K=F (owner 2026-10-25, futures PR answer 4)
    const future = futuresRoot(symbol);
    if (future) return `${future}=F`;
    const raw = symbol.toUpperCase().trim().replace(/^[.^]/, '');
    return (INDEX_SYMBOLS.has(raw) || FUTURES_PRICED_SYMBOLS.has(raw)) ? `^${raw}` : raw;
}

/**
 * Parse a Yahoo v8 chart JSON body into ascending, de-duplicated OhlcBar[].
 * Skips any index where open/high/low/close is missing (Yahoo pads gaps with
 * all-null rows - observed in 1m intraday data). Throws on `chart.error`.
 */
export function parseYahooChart(body: any, interval: string = DEFAULT_CHART_INTERVAL): OhlcBar[] {
    const chart = body?.chart;
    if (chart?.error) {
        const e = chart.error;
        throw new Error(`Yahoo chart: ${e.description || e.code || 'unknown error'}`);
    }
    const result = chart?.result?.[0];
    if (!result) throw new UiError('error.chart.empty');

    const timestamps: unknown[] = Array.isArray(result.timestamp) ? result.timestamp : [];
    const q = result.indicators?.quote?.[0] ?? {};
    const daily = DAILY_OR_LONGER.has(interval);
    const gmtoffset = num(result.meta?.gmtoffset) ?? 0;

    const byTime = new Map<number, OhlcBar>();
    for (let i = 0; i < timestamps.length; i++) {
        const ts = num(timestamps[i]);
        const open = num(q.open?.[i]);
        const high = num(q.high?.[i]);
        const low = num(q.low?.[i]);
        const close = num(q.close?.[i]);
        if (ts == null || open == null || high == null || low == null || close == null) continue;
        const time = daily ? Math.floor((ts + gmtoffset) / DAY_SECONDS) * DAY_SECONDS : ts;
        // Later rows win on a duplicate time (e.g. a live partial bar for today).
        byTime.set(time, { time, open, high, low, close, volume: num(q.volume?.[i]) });
    }
    return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/** Fetch OHLC history for `symbol` through the companion proxy's /api/chart route. */
export async function fetchOhlc(
    symbol: string,
    ctx: Pick<ProviderContext, 'proxyBase' | 'signal'>,
    req: ChartRequest = {},
): Promise<OhlcBar[]> {
    const base = (ctx.proxyBase || '').replace(/\/$/, '');
    if (!base) throw new UiError('error.proxy.baseMissing');
    const ySym = yahooChartSymbol(symbol);
    const range = req.range ?? DEFAULT_CHART_RANGE;
    const interval = req.interval ?? DEFAULT_CHART_INTERVAL;
    const url = `${base}/api/chart?symbol=${encodeURIComponent(ySym)}` +
        `&range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    dbg('chart fetchOhlc', { symbol, ySym, range, interval, url });

    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
    if (res.status === 429) throw new UiError('error.chart.rateLimited');
    const body: any = await res.json().catch(() => null);
    if (body?.chart) return parseYahooChart(body, interval);
    // Proxy-level errors ({ error: "..." }) or a non-JSON upstream body.
    const err = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new UiError('error.chart.proxy', { symbol, detail: err });
}

/**
 * Relative URL of the cached chart file of `symbol`. The futures are cached under their Yahoo symbol (api/charts/ES=F.json,
 * scripts/options-data.ts FUTURES_CHART_SYMBOLS); `=` is legal in a URL path and stays literal, because a static server that
 * does not decode the path (the e2e site) would look for a file named `ES%3DF.json`.
 */
export function cachedChartPath(symbol: string): string {
    const raw = symbol.toUpperCase().trim().replace(/^[.^]/, '');
    return `api/charts/${encodeURIComponent(raw).replace(/%3D/g, '=')}.json`;
}

/**
 * Chart file written by scripts/options-data.ts: api/charts/<SYM>.json with 1Y of daily bars, compact column arrays
 * (`timestamp`, `open`, `high`, `low`, `close`, `volume`, `gmtoffset`). Rebuilt into the Yahoo body shape so
 * parseYahooChart stays the only place that turns candles into OhlcBar.
 */
export async function fetchCachedOhlc(symbol: string, ctx: Pick<ProviderContext, 'signal'> = {}): Promise<OhlcBar[]> {
    // a futures ticker (/ES) is cached under its Yahoo symbol (api/charts/ES=F.json)
    const future = futuresRoot(symbol);
    const raw = future ? `${future}=F` : symbol.toUpperCase().trim().replace(/^[.^]/, '');
    const file = await fetchStaticJson(cachedChartPath(raw), ctx.signal, `charts/${raw}`);
    const body = {
        chart: {
            result: [{
                meta: { gmtoffset: file?.gmtoffset ?? 0 },
                timestamp: file?.timestamp ?? [],
                indicators: { quote: [{ open: file?.open, high: file?.high, low: file?.low, close: file?.close, volume: file?.volume }] },
            }],
            error: null,
        },
    };
    return parseYahooChart(body, DEFAULT_CHART_INTERVAL);
}

/**
 * Daily candles for the Chart tab, following the data source (src/proxy-discovery.ts): the caller passes the proxy base
 * only when the source is live, so with the cache no request goes to the proxy. Live: the proxy first, the cache as the
 * fallback. `preferCache` (a backtest day) puts the static file first and the proxy, when given, after it.
 * A futures ticker (/ES, ES1!, the micros) uses its Yahoo symbol (ES=F) for both: the proxy and the cached
 * api/charts/ES=F.json that the fetcher writes (FUTURES_CHART_SYMBOLS, PR #214).
 */
export async function loadOhlc(
    symbol: string,
    ctx: Pick<ProviderContext, 'proxyBase' | 'signal'>,
    req: ChartRequest,
    preferCache: boolean,
): Promise<OhlcBar[]> {
    const hasProxy = Boolean((ctx.proxyBase || '').trim());
    const sources: Array<'cache' | 'live'> = preferCache || !hasProxy ? ['cache', 'live'] : ['live', 'cache'];
    let firstError: unknown;
    for (const source of sources) {
        if (source === 'live' && !hasProxy) continue;
        try {
            return source === 'cache' ? await fetchCachedOhlc(symbol, ctx) : await fetchOhlc(symbol, ctx, req);
        } catch (e) {
            if (ctx.signal?.aborted || (e as { name?: string })?.name === 'AbortError') throw e;
            firstError ??= e;
        }
    }
    throw firstError;
}
