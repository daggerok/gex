import { INDEX_SYMBOLS } from '../greeks';
import type { DataProvider, OptionQuote } from '../types';
import { computeMid, num, parseOccSymbol, proxied } from '../utils';
import { proxyTickerSuggestions } from './proxy-search';

/**
 * CBOE provider (BULK — free, no key, ALL equities + indices, richest data).
 * Cash indices are prefixed with "_" (_SPX, _VIX...). CBOE's CDN sends NO CORS
 * header, so the browser CANNOT call it directly — it must be relayed. Two ways:
 *   1) A request-handling proxy base (RECOMMENDED): the local Bun server
 *      (scripts/options-local-proxy.ts also serves /api/cboe) or the Cloudflare Worker.
 *      Set "Proxy base URL" in Settings; we call {base}/api/cboe?symbol=XXX.
 *   2) A generic CORS proxy template ({url}) as a fallback (public ones flaky).
 */
// Cboe CDN spelling for cash indices is "_SYM" (bare and ^SYM both 403). This is
// a SUPERSET of INDEX_SYMBOLS on purpose: the CBOE provider already routes these
// (and the proxy suggests them), so narrowing it to INDEX_SYMBOLS would regress
// CBOE-only lookups like VIX, VXN, and OEX. Model-greek and Yahoo/NASDAQ index
// handling stays limited to INDEX_SYMBOLS.
export const CBOE_INDEX_SYMBOLS: ReadonlySet<string> = new Set([...INDEX_SYMBOLS, 'VIX', 'NDX', 'RUT', 'DJX', 'XSP', 'OEX', 'VXN']);
export const cboeProvider: DataProvider = {
    id: 'cboe',
    label: 'CBOE',
    description:
        'CBOE delayed options via proxy (/api/cboe) — equities & indices, greeks/IV/OI + spot. ' +
        'Default on localhost when proxy is available. Needs Proxy base URL.',
    mode: 'bulk',
    setup: 'proxy',
    supportsToken: false,
    needsProxy: true,       // shows the CORS-proxy dropdown (fallback path)
    needsProxyBase: true,   // shows the Proxy base URL field (recommended path)
    needsKeyFor() { return false; },
    async suggestTickers(query, ctx) {
        // CBOE's symbol book is a large no-CORS JSON file, so the proxy searches
        // it server-side and returns a small normalized suggestion list.
        return proxyTickerSuggestions('cboe', query, ctx);
    },
    async fetchAll(symbol, ctx) {
        const raw = symbol.toUpperCase().replace(/^[_.]/, '');
        const cboeSym = CBOE_INDEX_SYMBOLS.has(raw) ? `_${raw}` : raw;
        const target = `https://cdn.cboe.com/api/global/delayed_quotes/options/${cboeSym}.json`;

        // Prefer a request-handling proxy base ({base}/api/cboe) if configured;
        // otherwise fall back to the generic CORS-proxy template.
        const base = (ctx.proxyBase || '').replace(/\/$/, '');
        const url = base
            ? `${base}/api/cboe?symbol=${encodeURIComponent(cboeSym)}`
            : proxied(target, ctx.proxyTemplate);
        if (!base && (!ctx.proxyTemplate || ctx.proxyTemplate === '{url}')) {
            throw new Error('CBOE needs a proxy. Set the Proxy base URL in Settings (run scripts/options-local-proxy.ts, default http://localhost:8787), or pick a CORS proxy.');
        }

        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
        if (!res.ok) throw new Error(`CBOE proxy request failed (HTTP ${res.status}). Check the Proxy base URL / CORS proxy in Settings, or switch provider.`);
        const text = await res.text();
        let json: any;
        try { json = JSON.parse(text); }
        catch { throw new Error('The proxy returned a non-JSON page. Check the Proxy base URL / CORS proxy in Settings, or use CACHE (static data).'); }
        const data = json?.data;
        if (!data || !Array.isArray(data.options)) throw new Error(`No option data for "${raw}". Check the ticker symbol.`);
        const quotes: OptionQuote[] = [];
        for (const o of data.options) {
            const parsed = parseOccSymbol(String(o.option ?? ''));
            if (!parsed) continue;
            const bid = num(o.bid);
            const ask = num(o.ask);
            quotes.push({
                symbol: String(o.option),
                expiration: parsed.expiration,
                side: parsed.side,
                strike: parsed.strike,
                bid, ask, mid: computeMid(bid, ask),
                last: num(o.last_trade_price),
                volume: num(o.volume),
                openInterest: num(o.open_interest),
                iv: num(o.iv), delta: num(o.delta), gamma: num(o.gamma), theta: num(o.theta), vega: num(o.vega), rho: num(o.rho),
            });
        }
        const expirations = Array.from(new Set(quotes.map((q) => q.expiration))).sort();
        return { symbol: raw, underlyingPrice: num(data.current_price) ?? num(data.close), expirations, quotes };
    },
};
