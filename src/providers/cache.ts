import type { DataProvider, GreeksSummary, OptionQuote, ProviderContext, TickerSuggestion } from '../types';
import { asArray, computeMid, num } from '../utils';

// ============================================================================
// DATA PROVIDERS
// ============================================================================

/**
 * Fetch a same-origin static JSON file with DIAGNOSTIC error handling.
 *
 * Why this exists: the naive `await res.json()` throws an opaque SyntaxError when
 * the server returns something that ISN'T JSON — and the #1 real-world cause of
 * "Bad static data" is a dev/preview or SPA host that serves the app's own
 * index.html (a 200 HTML page) for a missing `data/options/*.json` path instead of a
 * 404. Reading the body as TEXT first lets us detect that case (and truncated /
 * malformed files) and raise an ACTIONABLE message telling the user exactly what
 * to fix, rather than a vague failure.
 *
 * @param url    same-origin path to the JSON file
 * @param signal AbortSignal for cancellation
 * @param label  optional ticker/name for nicer error messages (else derived)
 */
export async function fetchStaticJson(url: string, signal?: AbortSignal, label?: string): Promise<any> {
    const name = label ?? url;
    let res: Response;
    try {
        res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
    } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        throw new Error(`Could not load ${url} (network error). Is the site served over http(s), not file://?`);
    }
    if (res.status === 404) {
        throw new Error(
            `"${name}" is not in the static cache (data/${name}.json → 404). ` +
            `Pick a cached ticker from the list, or run scripts/options-data.py to add it.`,
        );
    }
    if (!res.ok) {
        throw new Error(`Static file ${url} failed to load (HTTP ${res.status}).`);
    }
    const text = await res.text();
    const trimmed = text.trimStart();
    // A server that falls back to the SPA shell returns HTML, not JSON.
    if (trimmed.startsWith('<')) {
        throw new Error(
            `Expected JSON at ${url} but got an HTML page. The server is likely ` +
            `serving index.html for missing files (SPA fallback) — make sure the ` +
            `data/ folder is deployed alongside the app and reachable at this path.`,
        );
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            `Static file ${url} is not valid JSON (it may be truncated or contain ` +
            `NaN/Infinity). Re-run scripts/options-data.py to rebuild it.`,
        );
    }
}

/** Local manifest shape normalized from data/options/index.json for ticker suggestions. */
export interface StaticTickerManifest {
    options: string[];
    noOptions: string[];
    /** Optional TICKER -> company / fund / index name, stored in data/options/index.json. */
    names: Record<string, string>;
}

/** In-memory copy of data/options/index.json so typing in the ticker box stays instant. */
export let staticTickerManifestCache: StaticTickerManifest | null = null;

/** Normalize any provider/search symbol into the uppercase value the app submits. */
export function normalizeTickerSymbol(s: unknown): string {
    return String(s ?? '').trim().toUpperCase();
}

/** True when `sym` looks like a ticker-ish identifier rather than arbitrary text. */
export function looksLikeTicker(sym: string): boolean {
    return /^[.^_\-A-Z0-9]{1,16}$/.test(sym);
}

/**
 * Read data/options/index.json and normalize BOTH known-with-options (`files`) and
 * known-without-options (`no_options`). The latter is deliberately preserved for
 * suggestions so a user can see "XYZ (no options)" while typing and understand
 * that the ticker is valid but the latest cache scan found no listed contracts.
 */
export async function loadStaticTickerManifest(ctx: ProviderContext): Promise<StaticTickerManifest> {
    if (staticTickerManifestCache) return staticTickerManifestCache;
    const j: any = await fetchStaticJson('data/options/index.json', ctx.signal);
    // v13: `files` is a sorted ticker list. Legacy v4–v12 used { TICKER: updatedISO }.
    const rawFiles = j?.files;
    const fileSymbols: string[] = Array.isArray(rawFiles)
        ? rawFiles.map(normalizeTickerSymbol)
        : (rawFiles && typeof rawFiles === 'object' ? Object.keys(rawFiles).map(normalizeTickerSymbol) : []);
    const noRaw = j?.no_options;
    const noOptions = Array.isArray(noRaw)
        ? noRaw.map(normalizeTickerSymbol)
        : (noRaw && typeof noRaw === 'object' ? Object.keys(noRaw).map(normalizeTickerSymbol) : []);
    const rawNames = j?.names && typeof j.names === 'object' ? j.names : {};
    const names: Record<string, string> = {};
    Object.keys(rawNames).forEach((sym) => {
        const key = normalizeTickerSymbol(sym);
        const value = String(rawNames[sym] ?? '').trim();
        if (key && value) names[key] = value;
    });
    staticTickerManifestCache = {
        options: fileSymbols.filter(Boolean).sort(),
        noOptions: noOptions.filter(Boolean).sort(),
        names,
    };
    return staticTickerManifestCache;
}

/** Rank a local-index match: exact ticker > ticker prefix > company prefix > substring; no match => null. */
export function localTickerRank(query: string, symbol: string, name = ''): number | null {
    const q = normalizeTickerSymbol(query);
    const n = name.toUpperCase();
    if (!q) return 50;
    if (symbol === q) return 0;
    if (symbol.startsWith(q)) return 10 + Math.min(symbol.length, 20);
    if (n.startsWith(q)) return 35 + Math.min(symbol.length, 20);
    const symbolAt = symbol.indexOf(q);
    if (symbolAt >= 0) return 70 + symbolAt + Math.min(symbol.length, 20);
    const nameAt = n.indexOf(q);
    return nameAt >= 0 ? 100 + nameAt + Math.min(symbol.length, 20) : null;
}

/** Build suggestions from the local static manifest, including "(no options)" rows. */
export function staticTickerSuggestionsFromManifest(query: string, manifest: StaticTickerManifest, limit = 24): TickerSuggestion[] {
    const out: Array<TickerSuggestion & { _rank: number }> = [];
    const add = (symbol: string, hasOptions: boolean) => {
        if (!looksLikeTicker(symbol)) return;
        const name = manifest.names[symbol] || '';
        const rank = localTickerRank(query, symbol, name);
        if (rank == null) return;
        out.push({ symbol, name: name || undefined, source: 'Local index', hasOptions, _rank: rank + (hasOptions ? 0 : 25) });
    };
    manifest.options.forEach((s) => add(s, true));
    manifest.noOptions.forEach((s) => add(s, false));
    return out
        .sort((a, b) => a._rank - b._rank || a.symbol.localeCompare(b.symbol))
        .slice(0, limit)
        .map(({ _rank, ...s }) => s);
}

/** Convenience wrapper for fallback suggestions from data/options/index.json. */
export async function staticTickerSuggestions(query: string, ctx: ProviderContext, limit = 24): Promise<TickerSuggestion[]> {
    const manifest = await loadStaticTickerManifest(ctx);
    return staticTickerSuggestionsFromManifest(query, manifest, limit);
}

/** Deduplicate and cap provider-native suggestions before rendering. */
export function dedupeTickerSuggestions(items: TickerSuggestion[], limit = 24): TickerSuggestion[] {
    const seen = new Set<string>();
    const out: TickerSuggestion[] = [];
    items.forEach((item) => {
        const symbol = normalizeTickerSymbol(item.symbol);
        if (!symbol || seen.has(symbol)) return;
        seen.add(symbol);
        out.push({ ...item, symbol, hasOptions: item.hasOptions !== false });
    });
    return out.slice(0, limit);
}

/**
 * Static cache provider (BULK, no setup — best for GitHub Pages).
 * Reads the site's OWN files (same-origin => zero CORS, zero keys):
 *   ./data/options/index.json     -> { files: ["<TICKER>", ...],
 *                              count, names?, no_options? }
 *                            (v0.9.16: the manifest now records EACH ticker's own
 *                            `updated` timestamp instead of a single global
 *                            `updated` that churned on every run. The ticker list
 *                            is the sorted keys of `files`. No legacy shape kept.
 *                            `names` powers local company-name suggestions;
 *                            `no_options` is surfaced as "(no options)".)
 *   ./data/options/{TICKER}.json  -> ChainResult-like payload (see scripts/options-data.py)
 * Data is refreshed by the GitHub Action. Greeks may be null (yfinance source).
 */
export const staticProvider: DataProvider = {
    id: 'static',
    label: 'CACHE',
    description:
        'Local static cache — same-origin data/options/{TICKER}.json (GitHub Action + yfinance + CBOE/BS greeks). ' +
        'No proxy, no keys. Best default on GitHub Pages. Only cached tickers are listed.',
    mode: 'bulk',
    setup: 'none',
    supportsToken: false,
    needsProxy: false,
    demoSymbol: undefined,
    needsKeyFor() { return false; },
    async listTickers(ctx) {
        try {
            // Reuse the robust JSON fetch so a mis-served index.json (e.g. SPA
            // HTML fallback) fails cleanly to an empty list instead of throwing.
            // v0.9.43 shape: { files: [TICKER, ...] } (legacy map keys still OK).
            const manifest = await loadStaticTickerManifest(ctx);
            return manifest.options;
        } catch { return []; }
    },
    async suggestTickers(query, ctx) {
        // Static cache uses the local manifest directly and includes the
        // `no_options` skiplist as visible "(no options)" suggestions.
        return staticTickerSuggestions(query, ctx);
    },
    async fetchAll(symbol, ctx) {
        const raw = symbol.toUpperCase().replace(/^[_.]/, '');
        const manifest = await loadStaticTickerManifest(ctx).catch(() => null);
        if (manifest?.noOptions.includes(raw)) {
            throw new Error(`"${raw}" is a valid ticker, but data/options/index.json marks it as (no options) in the latest static-cache scan.`);
        }
        // fetchStaticJson reads the body as TEXT first, so we can tell apart the
        // real failure modes (404, HTML SPA fallback, malformed JSON) and report
        // an ACTIONABLE message instead of a vague "Bad static data".
        const j: any = await fetchStaticJson(`data/options/${encodeURIComponent(raw)}.json`, ctx.signal, raw);
        if (!j || !Array.isArray(j.quotes)) {
            throw new Error(
                `Static file data/${raw}.json loaded but has no "quotes" array. ` +
                `The file may be truncated or in an old format — re-run scripts/options-data.py to rebuild it.`,
            );
        }
        const quotes: OptionQuote[] = j.quotes.map((q: any) => ({
            symbol: String(q.symbol ?? ''),
            expiration: String(q.expiration ?? ''),
            side: q.side === 'put' ? 'put' : 'call',
            strike: num(q.strike) ?? 0,
            bid: num(q.bid),
            ask: num(q.ask),
            mid: num(q.mid) ?? computeMid(num(q.bid), num(q.ask)),
            last: num(q.last),
            volume: num(q.volume),
            openInterest: num(q.openInterest),
            iv: num(q.iv),
            delta: num(q.delta),
            gamma: num(q.gamma),
            theta: num(q.theta),
            vega: num(q.vega),
            rho: num(q.rho),
            lambda: num(q.lambda),
            vanna: num(q.vanna),
            vomma: num(q.vomma),
            charm: num(q.charm),
            speed: num(q.speed),
            zomma: num(q.zomma),
            color: num(q.color),
            greeksSource: q.greeksSource === 'cboe' || q.greeksSource === 'black-scholes' || q.greeksSource === 'marketdata' || q.greeksSource === 'dolthub'
                ? q.greeksSource
                : null,
            greeksMissingReason: q.greeksMissingReason == null ? null : String(q.greeksMissingReason),
        }));
        const expirations = asArray<string>(j.expirations).length
            ? asArray<string>(j.expirations).map(String)
            : Array.from(new Set(quotes.map((q) => q.expiration).filter(Boolean))).sort();
        const greeks = j.greeks && typeof j.greeks === 'object' ? j.greeks as GreeksSummary : undefined;
        return { symbol: raw, underlyingPrice: num(j.underlyingPrice), expirations, quotes, greeks };
    },
};
