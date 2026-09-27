# SPX / Index Options Support — Research & Implementation Plan

Status: RESEARCHED — ready for implementation

## Context

GEX is a static React + TypeScript + Tailwind v4 app (Parcel/Bun build) that shows
options chains (Calls | Strike | Puts) for a ticker, through four data providers
in a fixed UI order: **CACHE, CBOE, NASDAQ, YAHOO**.

- **CACHE** reads `data/options/{TICKER}.json` + `data/options/index.json`,
  static files built offline by `scripts/options-data.py` (using the `yfinance`
  PyPI package) and refreshed on a schedule by
  `.github/workflows/update-data.yml`. That workflow does **not** let the script
  discover its own ticker universe — it pins the list with
  `TICKERS=$(cat data/All.txt) uv run ... python scripts/options-data.py`, so
  `load_universe()`'s "explicit TICKERS override" branch runs and live discovery
  never executes.
- **CBOE / NASDAQ / YAHOO** are *live* providers that run in the browser and talk
  to a proxy (`scripts/options-local-proxy.ts` for local dev,
  `scripts/options-cloudflare-proxy.js` for the public GitHub Pages site),
  exposing `/api/cboe`, `/api/nasdaq`, `/api/options`, `/api/search`.
- **Hard architecture rule (unchanged by this plan):** `scripts/options-data.py`
  only ever attaches Cboe's 1st-order greeks (delta/gamma/theta/vega/rho).
  `src/main.tsx` is the **only** place with the Black-Scholes model and the
  2nd/3rd-order greeks (`blackScholesGreeks` / `enrichQuotesWithModelGreeks`).
  Nothing in this plan moves BS math into Python.

SPY (an ordinary ETF) was simply missing from the hand-curated `data/All.txt`
snapshot — a trivial one-line fix (Part A). SPX (a cash-settled index) is a
different story: indices don't behave like equities for any of the four
providers, and — as the research below shows — parts of the codebase already
have partial, untested scaffolding for indices (an `INDEX_SET`/`CBOE_INDEX_SET`
appears in three different files) that nobody had wired up end-to-end or
verified actually works.

## Part A — SPY (shipped in this PR)

1. Added `SPY` as a new line at the end of `data/All.txt` (354 lines now; the
   file is not sorted, so an append is fine and matches the existing style).
2. Ran the smoke test locally:
   `TICKERS=SPY MAX_FETCHES=1 REQUEST_SLEEP=0 uv run --with yfinance --with requests python scripts/options-data.py`
   — it succeeded (`writes=1`, wrote `data/options/SPY.json` +
   `data/options/index.json`). Per instructions, the resulting
   `data/options/SPY.json` / `data/options/index.json` changes were discarded
   (`git checkout -- data/options/index.json`, `rm data/options/SPY.json`) so
   this PR only touches `data/All.txt`; the real SPY fetch happens on the next
   scheduled `Update options data` run.
3. Ran the existing checks — all green:
   - `uv run python -m py_compile scripts/options-data.py`
   - `node --check scripts/options-cloudflare-proxy.js`
   - `bun run build` (Parcel build succeeded, `dist/` produced)
   - `bun test` (10 pass, 0 fail, 38 expect() calls)

## Research Findings

### 1. yfinance — does index option-chain data even work? **Supported, with caveats**

Tested directly (`uv run --with yfinance --with requests python3 -c "..."`) against
`^SPX`, `^GSPC`, and `AAPL` for comparison:

- `yf.Ticker("^SPX").options` → **54 expirations** (vs AAPL's 23). Real dated
  strings, not empty.
- `yf.Ticker("^SPX").option_chain(exp)` → non-empty `calls`/`puts` DataFrames
  with the **exact same 14 columns** as AAPL's
  (`contractSymbol, lastTradeDate, strike, lastPrice, bid, ask, change,
  percentChange, volume, openInterest, impliedVolatility, inTheMoney,
  contractSize, currency`). No column is missing or extra for the index — the
  existing `_rows_from_frame()` (`scripts/options-data.py:699-721`) needs zero
  changes.
- **`^GSPC` (the plain S&P 500 index) has ZERO expirations** — `t.options` is
  `()`. Options trade under the CBOE ticker **`^SPX`**, not the raw index
  quote symbol. The task's suggested "fall back to `^GSPC`" does **not** work;
  `^SPX` is the only correct symbol for yfinance/Yahoo. Bare `SPX`/`GSPC`
  (no caret) also return 0 expirations — confirmed by direct test — so the
  caret is mandatory for Yahoo.
- Spot price: `ticker.fast_info.get("last_price")` returned `None` for **both**
  `^SPX` and `AAPL` in this test run (not an index-specific issue — the
  existing `_spot()` fallback to `ticker.history(period="1d")`, already in
  `scripts/options-data.py:683-696`, correctly returns the real close, e.g.
  7743.41 for `^SPX`). No code change needed here.
- Contract symbols use the **`SPXW` root** for near-term/weekly expirations
  and **`SPX`** for standard monthlies (e.g. `SPXW260928C07710000`). The OCC
  parser in `src/main.tsx` (`parseOccSymbol`, line 1309) uses a non-greedy
  `[.\-A-Z0-9]*?` prefix match that doesn't care about root spelling/length —
  confirmed this needs no change.
- **Chain size / `MAX_EXPIRATIONS`:** the script's own default is
  `MAX_EXPIRATIONS=12` (`scripts/options-data.py:270`), but the actual
  production workflow (`.github/workflows/update-data.yml:63`) sets
  `MAX_EXPIRATIONS: "50"`. I fetched SPX end-to-end under **both** settings:
  - `MAX_EXPIRATIONS=12` (script default): 12 expirations, 4,326 quotes,
    **1.3 MB** file (comparable to a large equity like AAPL's 824 KB /
    2,672 quotes).
  - `MAX_EXPIRATIONS=50` (actual CI value): captures essentially all 54
    available expirations, **17,801 quotes, 5.4 MB** — nearly **2×** the
    largest file currently in the repo (`SNDK.json` at 2.9 MB). This is not a
    hard blocker, but it is a real, measured cost the CI budget/repo size
    should account for (see Implementation Plan §3).

### 2. Cboe (live CBOE provider + build-time greeks) — URL format for indices. **Supported (verified live)**

- `curl https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json` →
  **HTTP 200**, `data.options` has **29,206** contracts with real
  bid/ask/delta/gamma/theta/vega/rho/iv per row (both `SPX`- and `SPXW`-rooted
  OCC symbols are present in the same feed, matching yfinance's contract
  symbols exactly).
- `curl .../options/SPX.json` (no prefix) and `curl .../options/%5ESPX.json`
  (`^SPX`) → **both HTTP 403 `AccessDenied`**. The underscore-prefix convention
  the task described is confirmed correct and is the *only* form that works.
- `scripts/options-local-proxy.ts` (`handleCboe`, lines 118-133) and
  `scripts/options-cloudflare-proxy.js` (`handleCboe`, lines 120-131) are
  **pure pass-throughs** — they take whatever `symbol` query param the caller
  sends and forward it verbatim to
  `https://cdn.cboe.com/api/global/delayed_quotes/options/{symbol}.json`. They
  do **no** index-vs-equity branching themselves; that responsibility already
  lives entirely in the *caller*.
- The caller-side mapping **already exists and already works**:
  `src/main.tsx`'s `cboeProvider.fetchAll` (lines 2220-2224) has
  `const INDEX_SET = new Set(['SPX','VIX','NDX','RUT','DJX','XSP','OEX','VXN'])`
  and does `cboeSym = INDEX_SET.has(raw) ? \`_${raw}\` : raw`. I confirmed via
  the live proxy (`bun run scripts/options-local-proxy.ts` +
  `curl localhost:8787/api/cboe?symbol=_SPX`) that this round-trips correctly
  today (29,206 options returned). **The live CBOE provider already supports
  SPX correctly for a bare-typed "SPX" — this is not a gap.**
- `scripts/options-data.py` already has the same mapping independently, for
  build-time greeks enrichment: `CBOE_INDEX_SET` (line 730) and
  `_cboe_symbol_candidates()` (lines 733-743) prepend `_` for symbols in that
  set. Verified live in the SPX smoke test (§ below): log line
  `GREEKS SPX: using Cboe symbol '_SPX'`, **100% of quotes matched Cboe
  greeks** (`cboeMatched: 4326/4326` and `17801/17801` in the two runs).

### 3. NASDAQ live provider. **Not supported by design (confirmed)**

- `curl "https://api.nasdaq.com/api/quote/SPX/option-chain?assetclass=stocks&limit=20&fromdate=all"`
  → HTTP 200 body `{"data":null,...,"errorMessage":"Symbol not exists."}`.
  Tried all three `assetclass` values NASDAQ's own endpoint accepts —
  `stocks`, `index`, `etf` — **all three return the identical "Symbol not
  exists" error** for SPX. There is no index option-chain endpoint on NASDAQ.
- `curl "https://api.nasdaq.com/api/autocomplete/slookup/24?search=SPX"` (the
  same endpoint behind `handleNasdaqSearch`) returns only unrelated tickers
  that happen to start with "SPX" (`SPXC`, `SPXD`, `SPXE`, ...) — **the index
  itself never appears**, confirming the NASDAQ screener has no concept of
  indices at all (it's an equities/ETF screener, matching
  `_live_nasdaq_marketcap_universe()`'s design in
  `scripts/options-data.py:560-623`, which explicitly filters to
  market-cap-bearing rows).
- **Verdict: NASDAQ provider: indices unsupported by design.** This should be
  a clean, explicit, early error in `nasdaqProvider.fetchAll`
  (`src/main.tsx:2136-2191`), not a bubbled-up generic parse/HTTP error (see
  Implementation Plan §5).

### 4. YAHOO live provider. **Needs custom handling (one bug found + one missing prefix)**

Tested live through the actual proxy (`bun run scripts/options-local-proxy.ts`,
port 8787):

- `curl "http://localhost:8787/api/options?symbol=SPX"` (bare, no caret) →
  `{"optionChain":{"result":[],"error":null}}` — a **silently empty result**,
  not an HTTP error. `yahooProvider.fetchMeta` (`src/main.tsx:2039-2057`) does
  `const raw = symbol.toUpperCase().replace(/^[.]/, '')` — this strips a
  leading dot but **never adds the `^` prefix indices need**, and does treat
  an empty `result` array as "no option data", which is at least a safe
  failure, but it means **typing "SPX" on the YAHOO provider fails today**,
  silently, with a generic message.
- `curl "http://localhost:8787/api/options?symbol=%5ESPX"` (`^SPX`) →
  full real chain, `expirationDates` array with the same 54 dates as the
  direct yfinance test.
- **Ticker-suggestion bug (confirmed live):**
  `curl "http://localhost:8787/api/search?provider=yahoo&q=spx"` returns
  `SPXL, SPXS, SPXU, SPXC, ...` but **never `^SPX`**, even though a direct
  `curl` to Yahoo's own search API
  (`https://query1.finance.yahoo.com/v1/finance/search?q=SPX`) **does**
  return `^SPX` first, with `"quoteType":"INDEX"` — and
  `handleYahooSearch`'s own filter regex
  (`/^(EQUITY|ETF|INDEX)$/i` in `scripts/options-local-proxy.ts:225` /
  `scripts/options-cloudflare-proxy.js:207`) already accepts `INDEX`. The
  culprit is `isTickerLike()`
  (`scripts/options-local-proxy.ts:184`, `scripts/options-cloudflare-proxy.js:167`):
  `/^[A-Z][A-Z0-9.\-]{0,15}$/` requires the symbol to **start with a letter**,
  so `^SPX` is silently dropped by `dedupeSuggestions()` before it ever
  reaches the browser. (Note `src/main.tsx`'s own `looksLikeTicker`, line
  1789, already allows a leading `^`/`_` — the bug is proxy-side only.)
- **Verdict:** the upstream Yahoo API itself has no problem with indices (same
  root cause as finding #1 — needs the `^` prefix); the gaps are entirely in
  this repo's own symbol handling: (a) `yahooProvider` never adds `^`, and
  (b) the proxy's `isTickerLike` silently filters out the one real Yahoo
  suggestion that would have told the user the right spelling.

### 5. Symbol canonicalization & UX. **Needs custom handling (recommendation below)**

- `_canonical()` (`scripts/options-data.py:333-346`) only rewrites `.`/`/` →
  `-` for class shares (e.g. `BRK.B` → `BRK-B`); it does not touch `^`/`_` and
  would leave `SPX` untouched, which is exactly what's wanted.
- `_symbol_variants()` (`scripts/options-data.py:363-394`) **already**
  appends `^{base}` / `^{raw}` as a last-resort fallback (lines 391-393) "in
  case the symbol is an index" — this is exactly why `TICKERS=SPX` already
  works today (see smoke test below) without any code change: `_resolve_options`
  tries bare `SPX` first (fails, 0 expirations), then falls through to
  `^SPX` (succeeds). This scaffolding already existed and is sound.
- `normalizeTickerSymbol()` (`src/main.tsx:1784-1786`) just upper-cases/trims;
  `looksLikeTicker()` (line 1789) already allows `^`/`_`/`.`/`-` in its regex,
  so the UI itself has no problem *rendering* an index symbol either form.
- **Recommendation:** standardize on the **bare form** ("SPX", not "^SPX" or
  "_SPX") as the single canonical *display/input/cache-key* spelling, because:
  (a) it's what a user would naturally type, (b) it's already what
  `cboeProvider`'s `INDEX_SET`, the proxies' `CBOE_INDEX_SUGGESTIONS`, and the
  CACHE file-naming convention already assume, and (c) it's exactly what the
  SPX smoke test (below) produced as the on-disk file name
  (`data/options/SPX.json`, `"symbol": "SPX"` inside it) with zero extra code.
  Each provider then derives its own upstream spelling internally
  (`^SPX` for Yahoo, `_SPX` for Cboe, unsupported for NASDAQ) — exactly the
  pattern `cboeProvider` already uses, just not yet shared/reused by
  `yahooProvider` or the proxies' suggestion filters.
- `/api/search` (autocomplete): CBOE's suggestions already special-case
  indices via a hardcoded list (`CBOE_INDEX_SUGGESTIONS`,
  `scripts/options-local-proxy.ts:170-179` /
  `scripts/options-cloudflare-proxy.js:154-163`) — SPX/XSP/VIX/NDX/RUT/DJX/OEX/VXN
  are already there. NASDAQ's autocomplete has no notion of indices (§3) and
  doesn't need special-casing — there's nothing to add. Yahoo's autocomplete
  *does* return the index natively but is dropped by the `isTickerLike` bug
  (§4) — that's the one fix needed. CACHE's local-index suggestions come
  entirely from `data/options/index.json`'s `files`/`names`, so once SPX is
  cached there, it will show up in suggestions automatically with zero code
  change (confirmed by reading `loadStaticTickerManifest`,
  `src/main.tsx:1799-1824`, which is fully generic).

### 6. Greeks/pricing-model implications. **Needs custom handling**

- `blackScholesGreeks()` (`src/main.tsx:1468-1560`) **does** already take a
  `dividendYield` parameter (4th arg), defaulting to the module constant
  `BS_DIVIDEND_YIELD = 0.0` (`src/main.tsx:1416`, next to
  `BS_RISK_FREE_RATE = 0.045` on line 1415). Every current call site
  (`enrichModelGreeksForQuote` → `blackScholesGreeks(q, spot)`, line 1586)
  uses the **default**, i.e. **q = 0 for every symbol today**, equities and
  (if fetched) indices alike.
- For SPX specifically this is a real, silent mispricing risk: SPX index
  options are conventionally priced off a continuous dividend yield
  (approximating the S&P 500's aggregate dividend yield, historically
  ~1.2–1.5%), not the near-zero yield appropriate for most individual growth
  stocks the app otherwise shows. Using q=0 will skew delta/theta/rho and all
  the higher-order greeks derived from them, worse for longer-dated
  expirations.
- **Recommendation:** do not touch Python (per the hard architecture rule —
  this is exactly the kind of change that must stay client-side). In
  `src/main.tsx`, add a small `INDEX_DIVIDEND_YIELD` constant (e.g. `0.013`)
  and pass it explicitly at the `blackScholesGreeks` call site when the
  underlying symbol is a recognized index, leaving `BS_DIVIDEND_YIELD` (0)
  as the default for everything else. This only affects the **UI-computed**
  model greeks (used as a fallback when Cboe doesn't supply 1st-order greeks,
  and always for the higher-order/λ/vanna/etc. greeks) — it does not touch
  `scripts/options-data.py` at all.

### 7. Scope recommendation: SPX only, or a small allowlist? **Recommendation: ship SPX only in v1**

- SPX already works **end-to-end today with zero Python changes** (see smoke
  test below) — CACHE, and the live CBOE provider, both function correctly
  right now for a bare "SPX" input. Only YAHOO (missing `^` prefix + dropped
  suggestion) and NASDAQ (needs an explicit "unsupported" message instead of a
  raw upstream error) need code changes, both small and localized to
  `src/main.tsx` (+ the `isTickerLike` proxy fix).
- Mechanically, `RUT`, `NDX`, `DJX`, `XSP`, `OEX` would very likely work the
  same way — they're already listed in `cboeProvider`'s `INDEX_SET`,
  `scripts/options-data.py`'s `CBOE_INDEX_SET`, and the proxies'
  `CBOE_INDEX_SUGGESTIONS` — this repo's authors clearly anticipated a small
  allowlist, not just SPX alone. I did **not** independently verify all of
  them against yfinance/Cboe live in this pass (out of scope for the
  requested spike, which centers on SPX); a follow-up can extend the same
  allowlist trivially once SPX has proven out in production.
- **VIX is a deliberate exception, not a "trivial add".** I fetched
  `^VIX`'s live option chain: `fast_info` spot = 14.87, but the
  `VIXW260930C00010000` ($10 strike, deep in-the-money if priced off spot)
  call showed `bid=3.14, ask=9.30` — **below the $4.87 spot-minus-strike
  intrinsic value a naive spot-based BS model would expect.** This is the
  textbook signature of VIX options being priced off the **VIX futures curve**
  for each expiration, not the cash/spot VIX index — a fundamentally
  different pricing model than SPX's (spot-based, dividend-yield-adjusted)
  Black-Scholes. Extending the current `blackScholesGreeks` model to VIX as
  if it were "just another index" would silently produce **badly wrong**
  greeks, not just slightly-off ones like the SPX dividend-yield gap in §6.
- **Recommendation:** ship **SPX only** in v1. Treat `RUT`/`NDX`/`DJX`/`XSP`/`OEX`
  as a cheap, low-risk fast-follow once SPX is live and its CI/cache-size cost
  (§1) is observed in practice. Explicitly **do not** add `VIX` to the
  allowlist until/unless a separate futures-based pricing workstream is
  scoped — bolting it onto the existing spot-based model would be actively
  misleading to users, worse than not supporting it at all.

### Smoke test performed for this research (not committed)

Run in an isolated scratch directory (`/tmp/gex_spx_test*`, never inside the
repo), so nothing from this section touched the working tree:

```
TICKERS=SPX MAX_FETCHES=1 REQUEST_SLEEP=0 MAX_EXPIRATIONS=12 \
  uv run --with yfinance --with requests python scripts/options-data.py
```
→ `RESOLVE SPX: using Yahoo variant '^SPX'`, `GREEKS SPX: using Cboe symbol
'_SPX'`, wrote `data/options/SPX.json` (12 expirations, 4,326 quotes, 1.3 MB,
`cboeMatched: 4326/4326`) — **all with the existing, unmodified script.**
Re-ran with `MAX_EXPIRATIONS=50` (the real CI value) → 17,801 quotes, 5.4 MB,
`cboeMatched: 17801/17801`.

## Implementation Plan (for a follow-up implementation agent)

This section assumes **no memory of the research above** — it's self-contained.

### Scope for v1: SPX only. Explicitly exclude VIX (different pricing model — futures-based, needs its own workstream). RUT/NDX/DJX/XSP/OEX are plausible fast-follows but not in v1.

### Canonicalization rule (adopt everywhere)
- **Display / input / cache-key form:** bare ticker, no prefix — `"SPX"`.
- **Yahoo/yfinance upstream form:** `"^SPX"` (caret prefix — mandatory, `^GSPC`
  does NOT have options, do not use it as a fallback).
- **Cboe upstream form:** `"_SPX"` (underscore prefix — mandatory, bare `SPX`
  and `^SPX` both 403).
- **NASDAQ:** unsupported — no valid upstream form exists.

### 1. `data/Indices.txt` (new file)
Create a new, separate allowlist file (do **not** add SPX to `data/All.txt` —
that file drives equity market-cap discovery/rotation and indices must never
be auto-discovered or treated like an equity for universe/skiplist purposes).
Contents for v1: a single line, `SPX`.

### 2. `.github/workflows/update-data.yml`
Change the "Fetch option chains" step so indices are included in the pinned
`TICKERS` list, e.g.:
```
TICKERS=$(cat data/All.txt data/Indices.txt) uv run --with yfinance --with requests python scripts/options-data.py
```
Optionally (recommended, given the measured 5.4 MB file size at
`MAX_EXPIRATIONS=50`): fetch indices in a **separate step** with their own,
smaller cap, e.g. a second invocation:
```
TICKERS=$(cat data/Indices.txt) MAX_EXPIRATIONS=15 MAX_FETCHES=5 \
  uv run --with yfinance --with requests python scripts/options-data.py
```
so a slow/large index fetch can never crowd out the equity budget in the main
step, and the index file stays closer in size to a typical large-cap equity
file (~1–1.5 MB) instead of ~5 MB. Either approach is acceptable; document
whichever is chosen in the workflow's header comment (matching its existing
style).

### 3. `scripts/options-data.py`
**No changes are strictly required** — `TICKERS=SPX` already resolves
correctly end-to-end today (`_symbol_variants()` already tries `^SPX` as a
fallback; `_cboe_symbol_candidates()` already tries `_SPX` for greeks). Verified
live in the research above. Leave the universe-discovery `"^" in sym` filters
in `_live_cboe_universe()` (line ~545) and the market-cap-only
`_live_nasdaq_marketcap_universe()` completely untouched — indices must
continue to enter the cache **only** via the explicit `TICKERS`/allowlist
path, never via live discovery.

Optional (recommended) improvement: if the two-step workflow approach from §2
is not used, add an index-specific expiration cap inside the script itself —
e.g. a new `INDEX_MAX_EXPIRATIONS` env (default `15`) applied in
`fetch_ticker()` when `symbol` is in a small hardcoded `INDEX_SYMBOLS` set
(mirroring `CBOE_INDEX_SET` at line 730), instead of the general
`MAX_EXPIRATIONS`. This bounds file size regardless of what the workflow's
`MAX_EXPIRATIONS` is set to.

### 4. `scripts/options-local-proxy.ts` and `scripts/options-cloudflare-proxy.js`
Both files need the identical one-line fix (keep them in sync, as the header
comments in each already ask):
- `isTickerLike()` (`options-local-proxy.ts:184`,
  `options-cloudflare-proxy.js:167`): change
  `/^[A-Z][A-Z0-9.\-]{0,15}$/` to also accept an optional leading caret, e.g.
  `/^\^?[A-Z][A-Z0-9.\-]{0,15}$/`, so Yahoo's native `^SPX` suggestion isn't
  silently dropped by `dedupeSuggestions()`. Decide at implementation time
  whether to keep the caret in the surfaced suggestion or normalize it to the
  bare form there (recommend normalizing to bare form, in
  `handleYahooSearch`'s `.map(...)`, for consistency with the CBOE suggestion
  list and the CACHE manifest naming from the canonicalization rule above).
- No other proxy changes are needed. `/api/cboe` and `/api/options` are
  already pure pass-throughs that forward whatever `symbol` the caller sends;
  all of the index-vs-equity branching correctly belongs in the caller
  (`src/main.tsx`), not the proxy.

### 5. `src/main.tsx`
- Add one shared constant near the top of the providers section (it's
  currently duplicated ad hoc only inside `cboeProvider.fetchAll`, line 2221):
  ```ts
  const INDEX_SYMBOLS = new Set(['SPX']); // v1: SPX only. Do NOT add VIX (different, futures-based pricing model).
  ```
  and use it in place of `cboeProvider`'s inline `INDEX_SET` (line 2221).
- `yahooProvider.fetchMeta` / `fetchExpiration` (lines 2039-2091): after
  computing `raw`, add
  `const ySym = INDEX_SYMBOLS.has(raw) ? \`^${raw}\` : raw;` and use `ySym` in
  the `/api/options?symbol=...` URL (both places). Today it silently sends the
  bare symbol and gets an empty `result: []` back.
- `nasdaqProvider.fetchAll` (lines 2136-2191): add an early explicit check
  right after computing `raw`:
  ```ts
  if (INDEX_SYMBOLS.has(raw)) {
      throw new Error(`NASDAQ does not support index options (${raw}). Switch to CBOE, YAHOO, or CACHE.`);
  }
  ```
  so the user sees a clear, correct message instead of NASDAQ's generic
  `"Symbol not exists."` bubbling up as if it were a typo.
- `blackScholesGreeks` call site (`enrichModelGreeksForQuote`, around line
  1586): add `const INDEX_DIVIDEND_YIELD = 0.013;` near `BS_DIVIDEND_YIELD`
  (line 1416), and pass
  `INDEX_SYMBOLS.has(<underlying symbol root>) ? INDEX_DIVIDEND_YIELD : BS_DIVIDEND_YIELD`
  as the 4th argument instead of relying on the default. This requires
  threading the current ticker/symbol down to wherever
  `enrichQuotesWithModelGreeks`/`enrichModelGreeksForQuote` is called (check
  `enrichQuotesWithModelGreeks(quotes, underlyingPrice)`, line 1651, and its
  caller at line 1665 — it will need a 3rd `symbol` argument plumbed through).
  This is purely client-side; do not touch `scripts/options-data.py`.
- No changes needed for: CACHE (`staticProvider`) — it automatically surfaces
  whatever is in `data/options/index.json`; CBOE — already works correctly
  today; `looksLikeTicker`, `normalizeTickerSymbol`, `parseOccSymbol` — all
  already index-agnostic and confirmed correct as-is.

### Smoke-test plan for the implementer (mirrors the existing AAPL pattern)

1. Fetcher (CACHE path):
   ```
   TICKERS=SPX MAX_FETCHES=1 REQUEST_SLEEP=0 MAX_EXPIRATIONS=15 \
     uv run --with yfinance --with requests python scripts/options-data.py
   ```
   Expect: log lines `RESOLVE SPX: using Yahoo variant '^SPX'` and
   `GREEKS SPX: using Cboe symbol '_SPX'`; `data/options/SPX.json` with
   `"symbol": "SPX"`, non-null `underlyingPrice`, and most/all quotes carrying
   `"greeksSource": "cboe"`. As with the Part A SPY smoke test, discard the
   resulting `data/options/SPX.json` / `data/options/index.json` from the
   working tree afterward unless this is the intended real commit (the real
   data lands via the scheduled workflow, same as any other ticker).
2. Live proxy path: `bun run scripts/options-local-proxy.ts` (defaults to
   `:8787`), then:
   ```
   curl "http://localhost:8787/api/cboe?symbol=_SPX"          # expect ~29k options, HTTP 200
   curl "http://localhost:8787/api/options?symbol=%5ESPX"     # expect optionChain.result[0] populated, 54 expirationDates
   curl "http://localhost:8787/api/nasdaq?symbol=SPX"         # expect rCode 400 "Symbol not exists." — this is EXPECTED, not a bug
   curl "http://localhost:8787/api/search?provider=yahoo&q=spx"  # after the isTickerLike fix, expect SPX/^SPX to appear in suggestions
   ```
3. In the running app (`bun run dev` or equivalent): type "SPX" in the ticker
   box; switch through all four providers in the fixed dropdown order and
   confirm CACHE, CBOE, and YAHOO each render a real chain, while NASDAQ shows
   the new explicit "NASDAQ does not support index options" message instead of
   a raw parse/HTTP error.
4. Run the standard checks: `bun run build`, `bun test`,
   `uv run python -m py_compile scripts/options-data.py`,
   `node --check scripts/options-cloudflare-proxy.js`.

### Rollout / backward-compatibility notes

- Existing equity `data/options/*.json` files and `data/All.txt` are
  completely unaffected — SPX enters the cache through a brand-new, separate
  file (`data/Indices.txt`) and is never mixed into equity market-cap
  discovery, rotation, or the no-options skiplist logic.
- The CACHE file **format**/schema for an index ticker is byte-for-byte the
  same shape as any equity file (proven in the smoke test above — same keys,
  same quote shape, same `greeks` summary block) — no `DataProvider` interface
  change, no `main.tsx` static-cache parsing change needed.
- All changes are additive: new small `INDEX_SYMBOLS` allowlist checks inside
  existing provider functions, one shared regex fix in the two proxies, and
  one new constant/threaded-argument in the client-side BS model. Nothing
  existing is renamed, removed, or restructured.
- If VIX or other indices are added later, only the `INDEX_SYMBOLS` /
  `data/Indices.txt` allowlists need to grow — **except** VIX, which
  additionally needs its own pricing-model decision (§7) before it can safely
  reuse `blackScholesGreeks`.
