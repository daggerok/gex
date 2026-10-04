import { INDEX_SYMBOLS } from '../greeks';
import type { DataProvider, OptionQuote } from '../types';
import { asArray, computeMid, dbg, isoToUnix, num } from '../utils';
import { proxyTickerSuggestions } from './proxy-search';

/**
 * Yahoo (via proxy) provider (LAZY, needs a proxy base URL).
 * The proxy (scripts/options-local-proxy.ts locally, or scripts/options-cloudflare-proxy.js
 * deployed) handles Yahoo's crumb/cookie flow and re-exposes CORS:*.
 * Endpoint: GET {base}/api/options?symbol=X[&date=YYYY-MM-DD]
 *   -> Yahoo optionChain JSON: result[0].expirationDates (unix), quote price,
 *      and options[0].calls/puts for the requested expiration.
 */
export const yahooProvider: DataProvider = {
    id: 'yahoo',
    label: 'YAHOO',
    description:
        'Yahoo Finance via proxy (/api/options) — crumb/cookie handled by scripts/options-local-proxy.ts or Cloudflare Worker. ' +
        'Lazy per-expiration. No provider greeks; client Black-Scholes fills them when IV is present.',
    mode: 'lazy',
    setup: 'proxy',
    supportsToken: false,
    needsProxy: false,
    needsProxyBase: true,
    demoSymbol: undefined,
    needsKeyFor() { return false; },
    async suggestTickers(query, ctx) {
        // Provider-native full-text symbol search via the same companion proxy
        // that already handles Yahoo's CORS/crumb flow for option chains.
        return proxyTickerSuggestions('yahoo', query, ctx);
    },
    async fetchMeta(symbol, ctx) {
        const raw = symbol.toUpperCase().replace(/^[.]/, '');
        // Yahoo lists index options only under the caret form (^SPX); bare SPX
        // silently returns an empty result.
        const ySym = INDEX_SYMBOLS.has(raw) ? `^${raw}` : raw;
        const base = (ctx.proxyBase || '').replace(/\/$/, '');
        if (!base) throw new Error('Set a Proxy base URL in Settings (e.g. http://localhost:8787).');
        const url = `${base}/api/options?symbol=${encodeURIComponent(ySym)}`;
        dbg('yahoo fetchMeta', { raw, ySym, url });
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
        const j: any = await res.json().catch(() => null);
        const result = j?.optionChain?.result?.[0];
        if (!result) {
            const err = j?.optionChain?.error?.description || j?.error;
            throw new Error(err ? `Yahoo: ${err}` : `No option data for "${raw}". Check the symbol / proxy.`);
        }
        const expirations = asArray<number>(result.expirationDates)
            .map((ts) => new Date(ts * 1000).toISOString().slice(0, 10))
            .sort();
        const underlyingPrice = num(result?.quote?.regularMarketPrice);
        return { symbol: raw, underlyingPrice, expirations };
    },
    async fetchExpiration(symbol, expiration, ctx) {
        const raw = symbol.toUpperCase().replace(/^[.]/, '');
        const ySym = INDEX_SYMBOLS.has(raw) ? `^${raw}` : raw;
        const base = (ctx.proxyBase || '').replace(/\/$/, '');
        if (!base) throw new Error('Set a Proxy base URL in Settings (e.g. http://localhost:8787).');
        const url = `${base}/api/options?symbol=${encodeURIComponent(ySym)}&date=${isoToUnix(expiration)}`;
        dbg('yahoo fetchExpiration', { raw, ySym, expiration, url });
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
        const j: any = await res.json().catch(() => null);
        const opt = j?.optionChain?.result?.[0]?.options?.[0];
        if (!opt) throw new Error('Yahoo returned no contracts for this expiration.');

        const map = (row: any, side: 'call' | 'put'): OptionQuote => {
            const bid = num(row.bid);
            const ask = num(row.ask);
            return {
                symbol: String(row.contractSymbol ?? ''),
                expiration,
                side,
                strike: num(row.strike) ?? 0,
                bid,
                ask,
                mid: computeMid(bid, ask),
                last: num(row.lastPrice),
                volume: num(row.volume),
                openInterest: num(row.openInterest),
                iv: num(row.impliedVolatility), // decimal
                delta: null, gamma: null, theta: null, vega: null, // Yahoo has no greeks
            };
        };
        return [
            ...asArray<any>(opt.calls).map((r) => map(r, 'call')),
            ...asArray<any>(opt.puts).map((r) => map(r, 'put')),
        ];
    },
};
