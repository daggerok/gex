/**
 * =============================================================================
 * Options Desk — Cloudflare Worker proxy (deploy for public GitHub Pages)
 * -----------------------------------------------------------------------------
 * INFRASTRUCTURE (not part of the 3-file app source).
 *
 * WHY: A free Cloudflare Worker gives your public GitHub Pages site a stable
 *      CORS-enabled endpoint that handles Yahoo's crumb/cookie flow and relays
 *      NASDAQ/CBOE/search endpoints that do not expose browser-usable CORS.
 *
 * DEPLOY (free):
 *   1. https://dash.cloudflare.com → Workers & Pages → Create → Worker.
 *   2. Paste this file, Deploy. You get https://<name>.<you>.workers.dev
 *   3. (Recommended) lock ALLOW_ORIGIN below to your Pages origin.
 *
 * USE FROM THE APP (Option Desk → Settings → Proxy base URL = your Worker URL):
 *   - Provider "Yahoo (via proxy)" calls {base}/api/options?symbol=AAPL[&date=...]
 *   - Provider "NASDAQ"           calls {base}/api/nasdaq?symbol=AAPL
 *   - Provider "CBOE"             calls {base}/api/cboe?symbol=AAPL (or _SPX)
 *   - Provider suggestions         call {base}/api/search?provider=...&q=...
 *   - (Advanced) generic proxying can use {worker}/raw?url={url}.
 *
 * ENDPOINTS THIS WORKER EXPOSES:
 *   GET /api/options?symbol=AAPL[&date=...]   -> Yahoo optionChain (crumb-handled)
 *   GET /api/cboe?symbol=AAPL                 -> CBOE delayed quotes (CORS-wrapped)
 *   GET /api/nasdaq?symbol=AAPL               -> NASDAQ option chain (CORS-wrapped)
 *   GET /api/search?provider=yahoo&q=apple    -> provider-native ticker suggestions
 *   GET /api/search?provider=nasdaq&q=tesla   -> provider-native ticker suggestions
 *   GET /api/search?provider=cboe&q=spx       -> provider-native ticker suggestions
 *   GET /raw?url=<encoded-target>             -> generic CORS passthrough
 * =============================================================================
 */

// Lock this to your site in production, e.g. "https://daggerok.github.io".
const ALLOW_ORIGIN = "*";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function cors() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}
// Column-aligned relay logger (visible in `wrangler tail` / Worker logs):
//   "$proxy | $localPath -> $remoteUrl"  with a fixed-width proxy column.
const PROXY_LABEL_WIDTH = 6;
function logProxy(proxy, localPathOrUrl, remoteUrl) {
  console.log(`${String(proxy).padEnd(PROXY_LABEL_WIDTH)} | ${localPathOrUrl} -> ${remoteUrl}`);
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

// ─── Yahoo crumb/cookie flow (cached in module scope per isolate) ────────────
let session = null; // { crumb, cookies, fetchedAt }
const SESSION_TTL_MS = 50 * 60 * 1000;

async function getSession() {
  if (session && Date.now() - session.fetchedAt < SESSION_TTL_MS) return session;

  const seed = await fetch("https://fc.yahoo.com/", {
    headers: { "User-Agent": UA, Accept: "text/html" },
  }).catch(() => null);
  let cookies = "";
  if (seed) {
    const list = seed.headers.getSetCookie ? seed.headers.getSetCookie() : [];
    const single = seed.headers.get("set-cookie");
    const all = list.length ? list : single ? [single] : [];
    cookies = all.map((c) => c.split(";")[0]).join("; ");
  }
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookies, Accept: "text/plain" },
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Failed to obtain Yahoo crumb");
  session = { crumb, cookies, fetchedAt: Date.now() };
  return session;
}

async function handleYahooOptions(url) {
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase().trim();
  if (!symbol) return json({ error: "missing symbol" }, 400);

  const s = await getSession();
  const y = new URL(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`);
  y.searchParams.set("crumb", s.crumb);
  const date = url.searchParams.get("date");
  if (date) {
    const ts = /^\d+$/.test(date)
      ? date
      : String(Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000));
    y.searchParams.set("date", ts);
  }

  logProxy("YAHOO", `${url.pathname}?symbol=${symbol}${date ? `&date=${date}` : ""}`, y.toString());
  let res = await fetch(y.toString(), {
    headers: { "User-Agent": UA, Cookie: s.cookies, Accept: "application/json" },
  });
  if (res.status === 401) {
    session = null;
    const s2 = await getSession();
    y.searchParams.set("crumb", s2.crumb);
    res = await fetch(y.toString(), {
      headers: { "User-Agent": UA, Cookie: s2.cookies, Accept: "application/json" },
    });
  }
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

// GET /api/cboe?symbol=AAPL (or _SPX) -> CBOE delayed-quotes JSON (no CORS of its own).
async function handleCboe(url) {
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase().trim();
  if (!symbol) return json({ error: "missing symbol" }, 400);
  const target = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`;
  logProxy("CBOE", `${url.pathname}?symbol=${symbol}`, target);
  const res = await fetch(target, { headers: { "User-Agent": UA, Accept: "application/json" } });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

// GET /api/nasdaq?symbol=AAPL[&assetclass=stocks|etf|index] -> NASDAQ option-chain JSON.
async function handleNasdaq(url) {
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
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

const SEARCH_LIMIT = 24;
const CBOE_SYMBOL_BOOK_URL = "https://cdn.cboe.com/api/global/delayed_quotes/symbol_book/symbol-book.json";
const CBOE_SYMBOL_BOOK_TTL_MS = 6 * 60 * 60 * 1000;
let cboeSymbolBook = null; // { fetchedAt, rows }
const CBOE_INDEX_SUGGESTIONS = [
  { symbol: "SPX", name: "S&P 500 Index options (CBOE _SPX)", exchange: "CBOE", source: "CBOE", hasOptions: true },
  { symbol: "XSP", name: "Mini-SPX Index options (CBOE _XSP)", exchange: "CBOE", source: "CBOE", hasOptions: true },
  { symbol: "VIX", name: "Cboe Volatility Index options (CBOE _VIX)", exchange: "CBOE", source: "CBOE", hasOptions: true },
  { symbol: "NDX", name: "Nasdaq-100 Index options (CBOE _NDX)", exchange: "CBOE", source: "CBOE", hasOptions: true },
  { symbol: "RUT", name: "Russell 2000 Index options (CBOE _RUT)", exchange: "CBOE", source: "CBOE", hasOptions: true },
  { symbol: "DJX", name: "Dow Jones Industrial Average Index options (CBOE _DJX)", exchange: "CBOE", source: "CBOE", hasOptions: true },
  { symbol: "OEX", name: "S&P 100 Index options (CBOE _OEX)", exchange: "CBOE", source: "CBOE", hasOptions: true },
  { symbol: "VXN", name: "Nasdaq-100 Volatility Index options (CBOE _VXN)", exchange: "CBOE", source: "CBOE", hasOptions: true },
];
function normalizeSuggestionSymbol(v) {
  return String(v ?? "").trim().toUpperCase();
}
function isTickerLike(symbol) {
  return /^[A-Z][A-Z0-9.\-]{0,15}$/.test(symbol);
}
function rankSuggestion(query, symbol, name = "") {
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
function dedupeSuggestions(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const symbol = normalizeSuggestionSymbol(item.symbol);
    if (!symbol || seen.has(symbol) || !isTickerLike(symbol)) continue;
    seen.add(symbol);
    out.push({ ...item, symbol, hasOptions: item.hasOptions !== false });
    if (out.length >= SEARCH_LIMIT) break;
  }
  return out;
}
async function handleYahooSearch(q) {
  const target = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  target.searchParams.set("q", q);
  target.searchParams.set("quotesCount", String(SEARCH_LIMIT));
  target.searchParams.set("newsCount", "0");
  target.searchParams.set("enableFuzzyQuery", "true");
  logProxy("YAHOO", `/api/search?provider=yahoo&q=${q}`, target.toString());
  const res = await fetch(target.toString(), { headers: { "User-Agent": UA, Accept: "application/json" } });
  const data = await res.json();
  const rows = Array.isArray(data?.quotes) ? data.quotes : [];
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
async function handleNasdaqSearch(q) {
  const target = `https://api.nasdaq.com/api/autocomplete/slookup/${SEARCH_LIMIT}?search=${encodeURIComponent(q)}`;
  logProxy("NASDAQ", `/api/search?provider=nasdaq&q=${q}`, target);
  const res = await fetch(target, {
    headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" },
  });
  const data = await res.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
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
async function loadCboeSymbolBook() {
  if (cboeSymbolBook && Date.now() - cboeSymbolBook.fetchedAt < CBOE_SYMBOL_BOOK_TTL_MS) return cboeSymbolBook.rows;
  logProxy("CBOE", "/api/search?provider=cboe", CBOE_SYMBOL_BOOK_URL);
  const res = await fetch(CBOE_SYMBOL_BOOK_URL, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const data = await res.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
  cboeSymbolBook = { fetchedAt: Date.now(), rows };
  return rows;
}
async function handleCboeSearch(q) {
  const qNorm = q.toUpperCase().trim();
  const builtIns = CBOE_INDEX_SUGGESTIONS
    .map((s) => ({ s, rank: rankSuggestion(qNorm, s.symbol, s.name || "") }))
    .filter((x) => x.rank != null);
  const rows = await loadCboeSymbolBook();
  const book = rows
    .map((r) => {
      const symbol = normalizeSuggestionSymbol(r.name);
      const name = String(r.company_name || "");
      const rank = rankSuggestion(qNorm, symbol, name);
      return { s: { symbol, name, exchange: "CBOE", source: "CBOE", hasOptions: true }, rank };
    })
    .filter((x) => x.rank != null && !x.s.symbol.startsWith("^") && isTickerLike(x.s.symbol));
  return dedupeSuggestions([...builtIns, ...book]
    .sort((a, b) => a.rank - b.rank || a.s.symbol.localeCompare(b.s.symbol))
    .map((x) => x.s));
}
async function handleSearch(url) {
  const provider = (url.searchParams.get("provider") || "").toLowerCase();
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ suggestions: [] });
  if (provider === "yahoo") return json({ suggestions: await handleYahooSearch(q) });
  if (provider === "nasdaq") return json({ suggestions: await handleNasdaqSearch(q) });
  if (provider === "cboe") return json({ suggestions: await handleCboeSearch(q) });
  return json({ error: "unsupported search provider" }, 400);
}

// Generic CORS passthrough, e.g. for CBOE/DoltHub: /raw?url=<encoded url>
async function handleRaw(url) {
  const target = url.searchParams.get("url");
  if (!target) return json({ error: "missing url" }, 400);
  logProxy("RAW", `${url.pathname}`, decodeURIComponent(target));
  const res = await fetch(decodeURIComponent(target), {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json", ...cors() },
  });
}

export default {
  async fetch(request /*, env */) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    try {
      if (url.pathname === "/api/options") return await handleYahooOptions(url);
      if (url.pathname === "/api/cboe") return await handleCboe(url);
      if (url.pathname === "/api/nasdaq") return await handleNasdaq(url);
      if (url.pathname === "/api/search") return await handleSearch(url);
      if (url.pathname === "/raw") return await handleRaw(url);
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({ ok: true, service: "options-desk-worker", endpoints: ["/api/options?symbol=AAPL", "/api/cboe?symbol=AAPL", "/api/nasdaq?symbol=AAPL", "/api/search?provider=yahoo&q=apple", "/api/search?provider=nasdaq&q=tesla", "/api/search?provider=cboe&q=spx", "/raw?url=..."] });
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  },
};
