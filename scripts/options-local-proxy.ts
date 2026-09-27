#!/usr/bin/env bun
/**
 * =============================================================================
 * Options Desk — LOCAL DEV data proxy (Bun): Yahoo + NASDAQ + CBOE + search
 * -----------------------------------------------------------------------------
 * INFRASTRUCTURE (not part of the 3-file app source).
 *
 * WHY:
 *   - Yahoo's options endpoint requires a rotating "crumb" token tied to cookies
 *     and sends no CORS header.
 *   - NASDAQ/CBOE endpoints used here send no browser-usable CORS headers.
 *   - Provider-native suggestion endpoints are also relayed so the app can
 *     search symbols without exposing users to upstream CORS differences.
 *   This tiny Bun server relays those requests with permissive CORS for LOCAL
 *   development.
 *
 * RUN:  bun run scripts/options-local-proxy.ts        (defaults to port 8787)
 *       PORT=9000 bun run scripts/options-local-proxy.ts
 *
 * USE FROM THE APP (Option Desk → Settings → Proxy base URL = http://localhost:8787):
 *   - Provider "Yahoo (via proxy)" calls:
 *       GET {base}/api/options?symbol=AAPL[&date=YYYY-MM-DD]   (Yahoo optionChain)
 *   - Provider "CBOE" calls:
 *       GET {base}/api/cboe?symbol=AAPL     (equities)   returns CBOE JSON as-is
 *       GET {base}/api/cboe?symbol=_SPX     (cash indices use the "_" prefix)
 *   - Ticker suggestions for providers that expose a searchable universe call:
 *       GET {base}/api/search?provider=yahoo&q=apple
 *       GET {base}/api/search?provider=nasdaq&q=tesla
 *       GET {base}/api/search?provider=cboe&q=spx
 *
 * DEPLOY (optional): the same logic works on any Node/Bun host or can be ported
 *   to a Cloudflare Worker (see scripts/options-cloudflare-proxy.js) so it also works
 *   for the public GitHub Pages site.
 * =============================================================================
 */

const PORT = Number(process.env.PORT ?? 8787);

// ─── Yahoo session state (crumb + cookies), refreshed periodically ───────────
interface YahooSession {
    crumb: string;
    cookies: string;
    fetchedAt: number;
}
let session: YahooSession | null = null;
const SESSION_TTL_MS = 50 * 60 * 1000; // crumb lasts ~1h; refresh at 50m

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Column-aligned proxy logger. Prints one line per relayed request:
 *   "$proxy | $localPathOrUrl -> $remoteUrl"
 * The "$proxy | " column is PADDED to a fixed width so the log lines form neat
 * columns regardless of which upstream (CBOE / YAHOO / NASDAQ) handled it.
 */
const PROXY_LABEL_WIDTH = 6; // fits "YAHOO", "NASDAQ", "CBOE" left-padded
function logProxy(proxy: string, localPathOrUrl: string, remoteUrl: string): void {
    const col = proxy.padEnd(PROXY_LABEL_WIDTH);
    console.log(`${col} | ${localPathOrUrl} -> ${remoteUrl}`);
}

/** Extract Set-Cookie values into a single Cookie header string. */
function collectCookies(res: Response): string {
    // Bun exposes multiple Set-Cookie via getSetCookie(); fall back to single.
    const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
    const list = anyHeaders.getSetCookie?.() ?? [];
    const single = res.headers.get("set-cookie");
    const all = list.length ? list : single ? [single] : [];
    return all.map((c) => c.split(";")[0]).join("; ");
}

/** Establish (or reuse) a Yahoo session: cookies then crumb. */
async function getSession(): Promise<YahooSession> {
    if (session && Date.now() - session.fetchedAt < SESSION_TTL_MS) return session;

    // Step 1: hit finance.yahoo.com to receive session cookies.
    const seed = await fetch("https://fc.yahoo.com/", {
        headers: { "User-Agent": UA, Accept: "text/html" },
    }).catch(() => null);
    let cookies = seed ? collectCookies(seed) : "";

    if (!cookies) {
        const seed2 = await fetch("https://finance.yahoo.com/", {
            headers: { "User-Agent": UA, Accept: "text/html" },
        });
        cookies = collectCookies(seed2);
    }

    // Step 2: use cookies to fetch the crumb token.
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
        headers: { "User-Agent": UA, Cookie: cookies, Accept: "text/plain" },
    });
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes("<")) throw new Error("Failed to obtain Yahoo crumb");

    session = { crumb, cookies, fetchedAt: Date.now() };
    console.log("↻ Yahoo session refreshed (crumb len:", crumb.length, ")");
    return session;
}

/** Standard permissive CORS headers for local development. */
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
};

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...CORS },
    });
}

/**
 * GET /api/cboe?symbol=AAPL  (or _SPX for indices)
 * Relays CBOE's Global Delayed Quotes JSON, which has NO CORS header of its own.
 * The app's CBOE provider already picks the right symbol (index -> "_SPX" etc.),
 * so here we just pass `symbol` straight through to the CDN path.
 */
async function handleCboe(url: URL): Promise<Response> {
    const symbol = (url.searchParams.get("symbol") || "").toUpperCase().trim();
    if (!symbol) return json({ error: "missing symbol" }, 400);
    const target = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`;
    logProxy("CBOE", `${url.pathname}?symbol=${symbol}`, target);
    const res = await fetch(target, { headers: { "User-Agent": UA, Accept: "application/json" } });
    return new Response(await res.text(), {
        status: res.status,
        headers: { "Content-Type": "application/json", ...CORS },
    });
}

/**
 * GET /api/nasdaq?symbol=AAPL[&assetclass=stocks|etf|index]
 * Relays NASDAQ's option-chain JSON (no CORS of its own). Returns the FULL chain
 * (all expirations) in one call; the app parses expiry/side/strike from each
 * row's drillDownURL (OCC symbol) and reads spot from data.lastTrade.
 */
async function handleNasdaq(url: URL): Promise<Response> {
    const symbol = (url.searchParams.get("symbol") || "").toUpperCase().trim();
    if (!symbol) return json({ error: "missing symbol" }, 400);
    const assetclass = (url.searchParams.get("assetclass") || "stocks").toLowerCase();
    const target = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}` +
        `/option-chain?assetclass=${encodeURIComponent(assetclass)}&limit=10000&fromdate=all`;
    logProxy("NASDAQ", `${url.pathname}?symbol=${symbol}`, target);
    const res = await fetch(target, {
        headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" },
    });
    return new Response(await res.text(), {
        status: res.status,
        headers: { "Content-Type": "application/json", ...CORS },
    });
}

interface TickerSuggestion {
    symbol: string;
    name?: string;
    exchange?: string;
    source: string;
    hasOptions: boolean;
}

const SEARCH_LIMIT = 24;
const CBOE_SYMBOL_BOOK_URL = "https://cdn.cboe.com/api/global/delayed_quotes/symbol_book/symbol-book.json";
const CBOE_SYMBOL_BOOK_TTL_MS = 6 * 60 * 60 * 1000;
let cboeSymbolBook: { fetchedAt: number; rows: Array<{ name?: string; company_name?: string }> } | null = null;

const CBOE_INDEX_SUGGESTIONS: TickerSuggestion[] = [
    { symbol: "SPX", name: "S&P 500 Index options (CBOE _SPX)", exchange: "CBOE", source: "CBOE", hasOptions: true },
    { symbol: "XSP", name: "Mini-SPX Index options (CBOE _XSP)", exchange: "CBOE", source: "CBOE", hasOptions: true },
    { symbol: "VIX", name: "Cboe Volatility Index options (CBOE _VIX)", exchange: "CBOE", source: "CBOE", hasOptions: true },
    { symbol: "NDX", name: "Nasdaq-100 Index options (CBOE _NDX)", exchange: "CBOE", source: "CBOE", hasOptions: true },
    { symbol: "RUT", name: "Russell 2000 Index options (CBOE _RUT)", exchange: "CBOE", source: "CBOE", hasOptions: true },
    { symbol: "DJX", name: "Dow Jones Industrial Average Index options (CBOE _DJX)", exchange: "CBOE", source: "CBOE", hasOptions: true },
    { symbol: "OEX", name: "S&P 100 Index options (CBOE _OEX)", exchange: "CBOE", source: "CBOE", hasOptions: true },
    { symbol: "VXN", name: "Nasdaq-100 Volatility Index options (CBOE _VXN)", exchange: "CBOE", source: "CBOE", hasOptions: true },
];

function normalizeSuggestionSymbol(v: unknown): string {
    return String(v ?? "").trim().toUpperCase();
}
function isTickerLike(symbol: string): boolean {
    return /^[A-Z][A-Z0-9.\-]{0,15}$/.test(symbol);
}
function rankSuggestion(query: string, symbol: string, name = ""): number | null {
    const q = query.toUpperCase().trim();
    const s = symbol.toUpperCase();
    const n = name.toUpperCase();
    if (!q) return 50;
    if (s === q) return 0;
    if (s.startsWith(q)) return 10 + Math.min(s.length, 20);
    if (n.startsWith(q)) return 35 + Math.min(s.length, 20);
    const si = s.indexOf(q);
    if (si >= 0) return 60 + si + Math.min(s.length, 20);
    const ni = n.indexOf(q);
    if (ni >= 0) return 90 + ni + Math.min(s.length, 20);
    return null;
}
function dedupeSuggestions(items: TickerSuggestion[]): TickerSuggestion[] {
    const seen = new Set<string>();
    const out: TickerSuggestion[] = [];
    for (const item of items) {
        const symbol = normalizeSuggestionSymbol(item.symbol);
        if (!symbol || seen.has(symbol) || !isTickerLike(symbol)) continue;
        seen.add(symbol);
        out.push({ ...item, symbol, hasOptions: item.hasOptions !== false });
        if (out.length >= SEARCH_LIMIT) break;
    }
    return out;
}

async function handleYahooSearch(q: string): Promise<TickerSuggestion[]> {
    const target = new URL("https://query1.finance.yahoo.com/v1/finance/search");
    target.searchParams.set("q", q);
    target.searchParams.set("quotesCount", String(SEARCH_LIMIT));
    target.searchParams.set("newsCount", "0");
    target.searchParams.set("enableFuzzyQuery", "true");
    logProxy("YAHOO", `/api/search?provider=yahoo&q=${q}`, target.toString());
    const res = await fetch(target.toString(), { headers: { "User-Agent": UA, Accept: "application/json" } });
    const data: any = await res.json();
    const rows: any[] = Array.isArray(data?.quotes) ? data.quotes : [];
    return dedupeSuggestions(rows
        .filter((r) => /^(EQUITY|ETF|INDEX)$/i.test(String(r.quoteType || r.typeDisp || "")))
        .map((r) => ({
            symbol: normalizeSuggestionSymbol(r.symbol),
            name: String(r.longname || r.shortname || r.name || ""),
            exchange: String(r.exchDisp || r.exchange || ""),
            source: "Yahoo",
            hasOptions: true,
        })));
}

async function handleNasdaqSearch(q: string): Promise<TickerSuggestion[]> {
    const target = `https://api.nasdaq.com/api/autocomplete/slookup/${SEARCH_LIMIT}?search=${encodeURIComponent(q)}`;
    logProxy("NASDAQ", `/api/search?provider=nasdaq&q=${q}`, target);
    const res = await fetch(target, {
        headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" },
    });
    const data: any = await res.json();
    const rows: any[] = Array.isArray(data?.data) ? data.data : [];
    return dedupeSuggestions(rows
        .filter((r) => /^(STOCKS|ETF|INDEX)$/i.test(String(r.asset || "")))
        .map((r) => ({
            symbol: normalizeSuggestionSymbol(r.symbol),
            name: String(r.name || ""),
            exchange: String(r.exchange || ""),
            source: "NASDAQ",
            hasOptions: true,
        })));
}

async function loadCboeSymbolBook(): Promise<Array<{ name?: string; company_name?: string }>> {
    if (cboeSymbolBook && Date.now() - cboeSymbolBook.fetchedAt < CBOE_SYMBOL_BOOK_TTL_MS) {
        return cboeSymbolBook.rows;
    }
    logProxy("CBOE", "/api/search?provider=cboe", CBOE_SYMBOL_BOOK_URL);
    const res = await fetch(CBOE_SYMBOL_BOOK_URL, { headers: { "User-Agent": UA, Accept: "application/json" } });
    const data: any = await res.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    cboeSymbolBook = { fetchedAt: Date.now(), rows };
    return rows;
}
async function handleCboeSearch(q: string): Promise<TickerSuggestion[]> {
    const qNorm = q.toUpperCase().trim();
    const builtIns = CBOE_INDEX_SUGGESTIONS
        .map((s) => ({ s, rank: rankSuggestion(qNorm, s.symbol, s.name || "") }))
        .filter((x): x is { s: TickerSuggestion; rank: number } => x.rank != null);
    const rows = await loadCboeSymbolBook();
    const book = rows
        .map((r) => {
            const symbol = normalizeSuggestionSymbol(r.name);
            const name = String(r.company_name || "");
            const rank = rankSuggestion(qNorm, symbol, name);
            return { s: { symbol, name, exchange: "CBOE", source: "CBOE", hasOptions: true } as TickerSuggestion, rank };
        })
        .filter((x): x is { s: TickerSuggestion; rank: number } => x.rank != null && !x.s.symbol.startsWith("^") && isTickerLike(x.s.symbol));
    return dedupeSuggestions([...builtIns, ...book]
        .sort((a, b) => a.rank - b.rank || a.s.symbol.localeCompare(b.s.symbol))
        .map((x) => x.s));
}

async function handleSearch(url: URL): Promise<Response> {
    const provider = (url.searchParams.get("provider") || "").toLowerCase();
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json({ suggestions: [] });
    if (provider === "yahoo") return json({ suggestions: await handleYahooSearch(q) });
    if (provider === "nasdaq") return json({ suggestions: await handleNasdaqSearch(q) });
    if (provider === "cboe") return json({ suggestions: await handleCboeSearch(q) });
    return json({ error: "unsupported search provider" }, 400);
}

/** GET /api/options?symbol=AAPL[&date=YYYY-MM-DD] -> Yahoo optionChain JSON. */
async function handleOptions(url: URL): Promise<Response> {
    const symbol = (url.searchParams.get("symbol") || "").toUpperCase().trim();
    if (!symbol) return json({ error: "missing symbol" }, 400);

    const s = await getSession();
    const y = new URL(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`);
    y.searchParams.set("crumb", s.crumb);
    const date = url.searchParams.get("date"); // optional: unix seconds OR YYYY-MM-DD
    if (date) {
        const ts = /^\d+$/.test(date) ? date : String(Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000));
        y.searchParams.set("date", ts);
    }

    logProxy("YAHOO", `${url.pathname}?symbol=${symbol}${date ? `&date=${date}` : ""}`, y.toString());
    const res = await fetch(y.toString(), {
        headers: { "User-Agent": UA, Cookie: s.cookies, Accept: "application/json" },
    });
    // If the crumb expired mid-flight, refresh once and retry.
    if (res.status === 401) {
        session = null;
        const s2 = await getSession();
        y.searchParams.set("crumb", s2.crumb);
        const retry = await fetch(y.toString(), {
            headers: { "User-Agent": UA, Cookie: s2.cookies, Accept: "application/json" },
        });
        return new Response(await retry.text(), { status: retry.status, headers: { "Content-Type": "application/json", ...CORS } });
    }
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json", ...CORS } });
}

// ─── Server ──────────────────────────────────────────────────────────────────
Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
        if (url.pathname === "/api/options") {
            try { return await handleOptions(url); }
            catch (e) { return json({ error: String(e) }, 502); }
        }
        if (url.pathname === "/api/cboe") {
            try { return await handleCboe(url); }
            catch (e) { return json({ error: String(e) }, 502); }
        }
        if (url.pathname === "/api/nasdaq") {
            try { return await handleNasdaq(url); }
            catch (e) { return json({ error: String(e) }, 502); }
        }
        if (url.pathname === "/api/search") {
            try { return await handleSearch(url); }
            catch (e) { return json({ error: String(e) }, 502); }
        }
        if (url.pathname === "/" || url.pathname === "/health") {
            return json({ ok: true, service: "options-desk-proxy", endpoints: ["/api/options?symbol=AAPL", "/api/cboe?symbol=AAPL", "/api/nasdaq?symbol=AAPL", "/api/search?provider=yahoo&q=apple", "/api/search?provider=nasdaq&q=tesla", "/api/search?provider=cboe&q=spx"] });
        }
        return json({ error: "not found" }, 404);
    },
});

console.log(`\n🚀 Options Desk proxy running at http://localhost:${PORT}`);
console.log(`   Yahoo  | http://localhost:${PORT}/api/options?symbol=AAPL`);
console.log(`   CBOE   | http://localhost:${PORT}/api/cboe?symbol=AAPL   (indices: _SPX, _VIX)`);
console.log(`   NASDAQ | http://localhost:${PORT}/api/nasdaq?symbol=AAPL`);
console.log(`   SEARCH | http://localhost:${PORT}/api/search?provider=yahoo&q=apple`);
console.log(`   (relay logs below: "$proxy | $localPath -> $remoteUrl")\n`);
