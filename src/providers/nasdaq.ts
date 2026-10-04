import { INDEX_SYMBOLS } from '../greeks';
import type { DataProvider, OptionQuote } from '../types';
import { computeMid, dbg, num, parseOccSymbol, proxied } from '../utils';
import { proxyTickerSuggestions } from './proxy-search';

/**
 * NASDAQ provider (BULK — free, no key, needs a proxy; no CORS of its own).
 * Endpoint (via proxy): {base}/api/nasdaq?symbol=AAPL[&assetclass=stocks|etf|index]
 * - NASDAQ returns the FULL chain (all expirations) in one call, as a table of
 *   rows where each row carries BOTH the call and put for a strike, plus a
 *   `drillDownURL` that embeds the OCC contract id (…aapl--260708c00225000).
 *   We parse expiry/side/strike from that OCC id, and read spot from
 *   data.lastTrade ("LAST TRADE: $313.39 (AS OF …)").
 * - No greeks in this feed; bid/ask/last/volume/openInterest per side. "--" and
 *   "N/A" are treated as null.
 * - Needs a proxy base ({base}/api/nasdaq) — same pattern as Yahoo/CBOE.
 */
/** Parse "$313.39" (or "LAST TRADE: $313.39 (AS OF …)") into a number|null. */
export function parseNasdaqSpot(s: unknown): number | null {
    const m = /([0-9][0-9,]*\.?[0-9]*)/.exec(String(s ?? ''));
    return m ? num(m[1].replace(/,/g, '')) : null;
}
/** NASDAQ uses "--"/"N/A"/"" for missing cells; coerce those to null. */
export function nq(v: unknown): number | null {
    const s = String(v ?? '').trim();
    if (!s || s === '--' || s.toUpperCase() === 'N/A') return null;
    return num(s.replace(/,/g, ''));
}
export const nasdaqProvider: DataProvider = {
    id: 'nasdaq',
    label: 'NASDAQ',
    description:
        'NASDAQ option chain via proxy (/api/nasdaq) — full chain one call (bid/ask/last/volume/OI). ' +
        'No IV/greeks in feed (higher-order stay empty). Needs Proxy base URL.',
    mode: 'bulk',
    setup: 'proxy',
    supportsToken: false,
    needsProxy: true,       // generic CORS-proxy fallback allowed
    needsProxyBase: true,   // recommended path: {base}/api/nasdaq
    demoSymbol: 'AAPL',
    needsKeyFor() { return false; },
    async suggestTickers(query, ctx) {
        // NASDAQ's own autocomplete is proxied server-side and searched by both
        // ticker and company name; if unavailable, the app falls back to index.json.
        return proxyTickerSuggestions('nasdaq', query, ctx);
    },
    async fetchAll(symbol, ctx) {
        const raw = symbol.toUpperCase().replace(/^[_.]/, '');
        // NASDAQ has no index option-chain endpoint at all ("Symbol not exists."
        // for every assetclass), so fail early with an actionable message.
        if (INDEX_SYMBOLS.has(raw)) {
            throw new Error(`NASDAQ does not support index options (${raw}). Switch to CBOE, YAHOO, or CACHE.`);
        }
        const base = (ctx.proxyBase || '').replace(/\/$/, '');
        // Direct NASDAQ URL (used only if routed via a generic {url} CORS proxy).
        const direct = `https://api.nasdaq.com/api/quote/${encodeURIComponent(raw)}/option-chain?assetclass=stocks&limit=10000&fromdate=all`;
        const url = base
            ? `${base}/api/nasdaq?symbol=${encodeURIComponent(raw)}`
            : proxied(direct, ctx.proxyTemplate);
        if (!base && (!ctx.proxyTemplate || ctx.proxyTemplate === '{url}')) {
            throw new Error('NASDAQ needs a proxy. Set the Proxy base URL in Settings (run scripts/options-local-proxy.ts, default http://localhost:8787), or pick a CORS proxy.');
        }
        dbg('nasdaq fetchAll', { raw, url });

        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
        if (!res.ok) throw new Error(`NASDAQ proxy request failed (HTTP ${res.status}). Check the Proxy base URL in Settings, or switch provider.`);
        const text = await res.text();
        let json: any;
        try { json = JSON.parse(text); }
        catch { throw new Error('The proxy returned a non-JSON page for NASDAQ. Check the Proxy base URL / CORS proxy in Settings.'); }

        const data = json?.data;
        const rows: any[] = data?.table?.rows;
        if (!data || !Array.isArray(rows)) {
            const em = json?.status?.bCodeMessage?.[0]?.errorMessage || json?.message;
            throw new Error(em ? `NASDAQ: ${em}` : `No option data for "${raw}". Check the ticker symbol.`);
        }

        const quotes: OptionQuote[] = [];
        for (const r of rows) {
            const strike = nq(r.strike);
            if (strike == null) continue; // skip "expirygroup" separator rows
            // Derive expiration from the OCC id embedded in drillDownURL.
            const parsed = parseOccSymbol(String(r.drillDownURL || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
            const expiration = parsed?.expiration ?? '';
            if (!expiration) continue;
            const cBid = nq(r.c_Bid), cAsk = nq(r.c_Ask);
            const pBid = nq(r.p_Bid), pAsk = nq(r.p_Ask);
            quotes.push({
                symbol: `${raw}C${strike}@${expiration}`,
                expiration, side: 'call', strike,
                bid: cBid, ask: cAsk, mid: computeMid(cBid, cAsk),
                last: nq(r.c_Last), volume: nq(r.c_Volume), openInterest: nq(r.c_Openinterest),
                iv: null, delta: null, gamma: null, theta: null, vega: null,
            });
            quotes.push({
                symbol: `${raw}P${strike}@${expiration}`,
                expiration, side: 'put', strike,
                bid: pBid, ask: pAsk, mid: computeMid(pBid, pAsk),
                last: nq(r.p_Last), volume: nq(r.p_Volume), openInterest: nq(r.p_Openinterest),
                iv: null, delta: null, gamma: null, theta: null, vega: null,
            });
        }
        if (quotes.length === 0) throw new Error(`No option data for "${raw}". Check the ticker symbol.`);
        const expirations = Array.from(new Set(quotes.map((q) => q.expiration).filter(Boolean))).sort();
        return { symbol: raw, underlyingPrice: parseNasdaqSpot(data.lastTrade), expirations, quotes };
    },
};
