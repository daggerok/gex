/// <reference lib="esnext" />
import { futuresRoot } from '../gex';
import type { ChainResult, DataProvider, GreeksSummary, OptionQuote, ProviderContext, TickerSuggestion } from '../types';
import { markStaleOi } from '../oi-dates';
import { asArray, computeMid, num, UiError } from '../utils';

// ============================================================================
// DATA PROVIDERS
// ============================================================================

/**
 * Fetch a same-origin static JSON file with DIAGNOSTIC error handling.
 *
 * Why this exists: the naive `await res.json()` throws an opaque SyntaxError when
 * the server returns something that ISN'T JSON — and the #1 real-world cause of
 * "Bad static data" is a dev/preview or SPA host that serves the app's own
 * index.html (a 200 HTML page) for a missing `api/options/*.json` path instead of a
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
        throw new UiError('error.cache.network', { url });
    }
    if (res.status === 404) {
        throw new UiError('error.cache.notCached', { symbol: name });
    }
    if (!res.ok) {
        throw new UiError('error.cache.http', { url, status: res.status });
    }
    const text = await res.text();
    const trimmed = text.trimStart();
    // A server that falls back to the SPA shell returns HTML, not JSON.
    if (trimmed.startsWith('<')) {
        throw new UiError('error.cache.html', { url });
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new UiError('error.cache.badJson', { url });
    }
}

/** Local manifest shape normalized from api/options/index.json for ticker suggestions. */
export interface StaticTickerManifest {
    options: string[];
    noOptions: string[];
    /** Optional TICKER -> company / fund / index name, stored in api/options/index.json. */
    names: Record<string, string>;
    /**
     * The fetcher's default list (`defaults`, scripts/options-data.ts DEFAULT_SYMBOLS) in its own order: the ticker search
     * hint and the backup preset. Empty when the index predates the field (an old cached index.json).
     */
    defaults: string[];
}

/** In-memory copy of api/options/index.json so typing in the ticker box stays instant. */
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
 * Read api/options/index.json and normalize BOTH known-with-options (`files`) and
 * known-without-options (`no_options`). The latter is deliberately preserved for
 * suggestions so a user can see "XYZ (no options)" while typing and understand
 * that the ticker is valid but the latest cache scan found no listed contracts.
 */
export async function loadStaticTickerManifest(ctx: Pick<ProviderContext, 'signal'>): Promise<StaticTickerManifest> {
    if (staticTickerManifestCache) return staticTickerManifestCache;
    staticTickerManifestCache = manifestFromIndex(await fetchStaticJson('api/options/index.json', ctx.signal));
    return staticTickerManifestCache;
}

/** The parsed api/options/index.json, normalized (pure). Anything malformed becomes an empty list, never a throw. */
export function manifestFromIndex(j: any): StaticTickerManifest {
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
    // the default list keeps its order (it is the order of the hint), only bad entries and repeats are dropped
    const defaults = Array.isArray(j?.defaults) ? (j.defaults as unknown[]).map(normalizeTickerSymbol).filter(looksLikeTicker) : [];
    return {
        options: fileSymbols.filter(Boolean).sort(),
        noOptions: noOptions.filter(Boolean).sort(),
        names,
        defaults: defaults.filter((s, i) => defaults.indexOf(s) === i),
    };
}

/** The fetcher's default list from api/options/index.json; [] while it cannot be read or when the index has no `defaults`. */
export async function loadDefaultTickers(signal?: AbortSignal): Promise<string[]> {
    try {
        return (await loadStaticTickerManifest({ signal })).defaults;
    } catch {
        return [];
    }
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
    // a ticker with a file is never also offered as "(no options)" (a failed scan could list it in both)
    const withFile = new Set(manifest.options);
    manifest.noOptions.forEach((s) => { if (!withFile.has(s)) add(s, false); });
    return out
        .sort((a, b) => a._rank - b._rank || a.symbol.localeCompare(b.symbol))
        .slice(0, limit)
        .map(({ _rank, ...s }) => s);
}

/** Convenience wrapper for fallback suggestions from api/options/index.json. */
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
 * A cache file (api/options/<SYM>.json, or the same file inside a daily archive) as a ChainResult. Throws when the
 * parsed JSON has no `quotes` array; `where` names the file in that message.
 */
export function chainFromCacheFile(raw: string, j: any, where: string): ChainResult {
    if (!j || !Array.isArray(j.quotes)) {
        throw new UiError('error.cache.noQuotes', { url: where });
    }
    const parsed: OptionQuote[] = j.quotes.map((q: any) => ({
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
        ...(typeof q.oiDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.oiDate) ? { oiDate: q.oiDate } : {}),
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
    // TradingView futures quotes carry the day of their OI: an older one than the newest of the chain is marked (G10)
    const quotes = markStaleOi(parsed);
    const expirations = asArray<string>(j.expirations).length
        ? asArray<string>(j.expirations).map(String)
        : Array.from(new Set(quotes.map((q) => q.expiration).filter(Boolean))).sort();
    const greeks = j.greeks && typeof j.greeks === 'object' ? j.greeks as GreeksSummary : undefined;
    // GEX-H4: when the file was written and the trading day it belongs to, for the data age shown in the app
    const updated = typeof j.updated === 'string' && j.updated ? j.updated : null;
    const dataDate = typeof j.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : null;
    return { symbol: raw, underlyingPrice: num(j.underlyingPrice), expirations, quotes, greeks, updated, dataDate };
}

/**
 * The local futures file of a futures ticker (`/ES`, `ES1!`, any case; gex.ts futuresRoot), null for every other ticker.
 * `bun run tv:futures` writes api/futures/<ROOT>.json from the owner's TradingView session on the owner's machine; the
 * owner commits it by hand and it is published with the site (owner 2026-10-25), so the public site has it as of that
 * commit. Never in index.json. A missing file says how to make it.
 * Not api/options/ES.json: that is the Eversource Energy stock. `symbol` is the one canonical ticker, `/ES`.
 */
export function futuresFile(ticker: string): { root: string; symbol: string; url: string } | null {
    const root = futuresRoot(ticker);
    return root ? { root, symbol: `/${root}`, url: `api/futures/${root}.json` } : null;
}

/**
 * Static cache provider (BULK, no setup — best for GitHub Pages).
 * Reads the site's OWN files (same-origin => zero CORS, zero keys):
 *   ./api/options/index.json     -> { files: ["<TICKER>", ...],
 *                              count, names?, no_options? }
 *                            (v0.9.16: the manifest now records EACH ticker's own
 *                            `updated` timestamp instead of a single global
 *                            `updated` that churned on every run. The ticker list
 *                            is the sorted keys of `files`. No legacy shape kept.
 *                            `names` powers local company-name suggestions;
 *                            `no_options` is surfaced as "(no options)".)
 *   ./api/options/{TICKER}.json  -> ChainResult-like payload (see scripts/options-data.ts)
 * Data is refreshed by the GitHub Action. Greeks may be null (Yahoo source).
 */
export const staticProvider: DataProvider = {
    id: 'static',
    label: 'CACHE',
    description:
        'Local static cache — same-origin api/options/{TICKER}.json (GitHub Action + Yahoo + CBOE/BS greeks). ' +
        'No proxy, no keys. Used when no local proxy is found (and always on the published site before its opt-in). Only cached tickers are listed.',
    mode: 'bulk',
    setup: 'none',
    supportsToken: false,
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
        // futures tickers (/ES, ES1!) read the TradingView file, never listed in index.json (see futuresFile)
        const future = futuresFile(raw);
        if (future) {
            let j: any;
            try {
                j = await fetchStaticJson(future.url, ctx.signal, future.symbol);
            } catch (e) {
                if (e instanceof UiError && e.key === 'error.cache.notCached') throw new UiError('error.cache.futuresMissing', { symbol: future.symbol, root: future.root });
                throw e;
            }
            return chainFromCacheFile(future.symbol, j, future.url);
        }
        const manifest = await loadStaticTickerManifest(ctx).catch(() => null);
        // the skiplist wins only when there is no file: a valid file is served even if a failed scan listed the ticker (GEX-H3)
        if (manifest?.noOptions.includes(raw) && !manifest.options.includes(raw)) {
            throw new UiError('error.cache.noOptions', { symbol: raw });
        }
        // fetchStaticJson reads the body as TEXT first, so we can tell apart the
        // real failure modes (404, HTML SPA fallback, malformed JSON) and report
        // an ACTIONABLE message instead of a vague "Bad static data".
        const j: any = await fetchStaticJson(`api/options/${encodeURIComponent(raw)}.json`, ctx.signal, raw);
        return chainFromCacheFile(raw, j, `api/options/${raw}.json`);
    },
};
