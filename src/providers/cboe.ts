/// <reference lib="esnext" />
import { INDEX_SYMBOLS } from '../greeks';
import type { DataProvider, OptionQuote } from '../types';
import { computeMid, num, parseOccSymbol, UiError } from '../utils';
import { proxyTickerSuggestions } from './proxy-search';

/**
 * CBOE provider (BULK — free, no key, ALL equities + indices, richest data).
 * Cash indices are prefixed with "_" (_SPX, _VIX...). CBOE's CDN sends NO CORS
 * header, so the browser CANNOT call it directly — it is relayed by the local Bun
 * proxy (scripts/options-local-proxy.ts, `bun run proxy`), which serves /api/cboe;
 * we call {base}/api/cboe?symbol=XXX. The app finds it by itself
 * (src/proxy-discovery.ts), its URL is in Settings -> Advanced.
 */
// Cboe CDN spelling for cash indices is "_SYM" (bare and ^SYM both 403). This is
// a SUPERSET of INDEX_SYMBOLS on purpose: the CBOE provider already routes these
// (and the proxy suggests them), so narrowing it to INDEX_SYMBOLS would regress
// CBOE-only lookups like VIX, VXN, and OEX. Model-greek and Yahoo/NASDAQ index
// handling stays limited to INDEX_SYMBOLS.
export const CBOE_INDEX_SYMBOLS: ReadonlySet<string> = new Set([...Array.from(INDEX_SYMBOLS), 'VIX', 'NDX', 'RUT', 'DJX', 'XSP', 'OEX', 'VXN']);
export const cboeProvider: DataProvider = {
    id: 'cboe',
    label: 'CBOE',
    description:
        'CBOE delayed options via proxy (/api/cboe) — equities & indices, greeks/IV/OI + spot. ' +
        'First choice when the local proxy is found. Needs the local proxy.',
    mode: 'bulk',
    setup: 'proxy',
    supportsToken: false,
    needsProxyBase: true,   // the local proxy {base}/api/cboe
    needsKeyFor() { return false; },
    async suggestTickers(query, ctx) {
        // CBOE's symbol book is a large no-CORS JSON file, so the proxy searches
        // it server-side and returns a small normalized suggestion list.
        return proxyTickerSuggestions('cboe', query, ctx);
    },
    async fetchAll(symbol, ctx) {
        const raw = symbol.toUpperCase().replace(/^[_.]/, '');
        const cboeSym = CBOE_INDEX_SYMBOLS.has(raw) ? `_${raw}` : raw;
        // the local proxy relays https://cdn.cboe.com/api/global/delayed_quotes/options/<SYM>.json
        const base = (ctx.proxyBase || '').replace(/\/$/, '');
        if (!base) throw new UiError('error.proxy.needed', { provider: 'CBOE' });
        const url = `${base}/api/cboe?symbol=${encodeURIComponent(cboeSym)}`;

        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
        if (!res.ok) throw new UiError('error.proxy.http', { provider: 'CBOE', status: res.status });
        const text = await res.text();
        let json: any;
        try { json = JSON.parse(text); }
        catch { throw new UiError('error.proxy.notJson', { provider: 'CBOE' }); }
        const data = json?.data;
        if (!data || !Array.isArray(data.options)) throw new UiError('error.noOptionData', { symbol: raw });
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
