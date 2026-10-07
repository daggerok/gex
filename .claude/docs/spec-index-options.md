# Index options support (SPX and friends) - research and routing

Condensed from the original SPX research plan (gex-spx-index-options-plan.txt in the old .plans folder, 2026-09-27, deleted from the repo, recoverable from git history). Shipped in #7 (SPX) and #15 (XSP, NDX, DJX, RUT). Section numbers kept for code references. VIX is its own document: `spec-vix-futures.md`

## 5. Findings (live checks, 2026-09-27)

### 5.1 yfinance

- `^SPX` works: 54 expirations, same 14 columns as an equity, so `_rows_from_frame()` needed no change. `^GSPC` has zero expirations and bare `SPX` or `GSPC` also return none, the caret and the `SPX` options root are mandatory
- `fast_info.last_price` is None for both indices and equities in that run, the existing `history(period="1d")` fallback returned the real close
- Contract roots: `SPXW` for weeklies and near terms, `SPX` for standard monthlies. The OCC parser is root-agnostic
- Size cost, measured once for SPX: `MAX_EXPIRATIONS=12` gives 4,326 quotes and 1.3 MB, `MAX_EXPIRATIONS=50` (the CI value) gives 17,801 quotes and 5.4 MB, nearly 2x the largest equity file. A lower index-specific cap (about 15) bounds it

### 5.2 CBOE

- `_SPX.json` works (29,206 contracts with bid, ask and 1st-order greeks, both SPX and SPXW roots). Bare `SPX.json` and `%5ESPX.json` both return 403. Underscore is the only valid form
- Both proxies' `/api/cboe` are pure pass-throughs, the index branching lives in the caller. CBOE greeks matched 100% of quotes at build time (4326/4326, 17801/17801)

### 5.3 NASDAQ

No index option chains at all: `Symbol not exists.` for every asset class, and autocomplete never returns the index. Unsupported by design, the provider throws the explicit `NASDAQ does not support index options (SPX). Switch to CBOE, YAHOO, or CACHE.`

### 5.4 Yahoo

- Upstream is fine with `^SPX`. Bare `SPX` returned a silently empty `result: []`. The provider therefore adds the caret for index symbols
- The proxy's `isTickerLike` regex required a leading letter and silently dropped Yahoo's own `^SPX` suggestion. Fixed in both proxies to accept an optional caret

### 5.5 Canonicalization and UX

`_canonical()` leaves index symbols alone, `_symbol_variants()` already tried `^{symbol}` as a last resort, so `TICKERS=SPX` resolves with the unmodified script. CBOE suggestions already hardcode the index list, CACHE suggestions come from `data/options/index.json` automatically

### 5.6 Greeks

`blackScholesGreeks` takes a dividend yield, which was 0 for every symbol. Index options are conventionally priced with the index dividend yield, so SPX needed one (kept client-side, never in Python). Now per-index in `INDEX_DIVIDEND_YIELDS` in `src/greeks.ts` (SPX 0.011, XSP the same, NDX 0.006, ...). Values are approximate trailing yields hardcoded, they drift over time

### 5.7 Scope

SPX was shipped first, RUT, NDX, DJX, XSP followed once checked. VIX was deliberately excluded: a deep ITM `VIXW` call showed bid 3.14 and ask 9.30, below spot intrinsic, the signature of futures-curve pricing. Spot-based Black-Scholes would give badly wrong greeks, see `spec-vix-futures.md`

### 5.8 Smoke test

`TICKERS=SPX MAX_FETCHES=1 REQUEST_SLEEP=0 MAX_EXPIRATIONS=12 uv run --with yfinance --with requests python scripts/options-data.py` logged `RESOLVE SPX: using Yahoo variant '^SPX'` and `GREEKS SPX: using Cboe symbol '_SPX'` and wrote `data/options/SPX.json` with the unmodified script

## 6. Symbol canonicalization (the routing rule)

| Where | Form for SPX |
|---|---|
| Input, display, cache key, file name | `SPX` |
| Yahoo and yfinance upstream | `^SPX` (mandatory) |
| CBOE upstream | `_SPX` (mandatory) |
| NASDAQ | unsupported |
| Chart tab (Yahoo chart endpoint) | `^SPX`, bare `SPX` answers 404 |

Each provider derives its own upstream spelling internally. Indices enter the cache only through `data/Indices.txt` (currently SPX, XSP, NDX, DJX, RUT) with `TICKERS=$(cat data/All.txt data/Indices.txt)` style pinning, never through universe discovery (`_live_cboe_universe`, `_live_nasdaq_marketcap_universe` stay untouched). `data/All.txt` drives equity discovery and must not contain indices. SPY itself was simply missing from `data/All.txt` and was appended

## 12. Limitations

1. Only SPX was live-tested in this research, the others should repeat the 5.1 and 5.2 checks per symbol when changed
2. The file-size cost was measured once and not tuned against a repo-size or Actions-minutes budget
3. Only the "Fetch option chains" step of `update-data.yml` was audited. Ask the user before changing any workflow (rule R4)
4. Dividend yields are hardcoded approximations
5. Yahoo suggestion normalization (caret to bare) was a recommendation, the interaction with CBOE's bare suggestion in the dedupe was not tested
6. Actions cost of the bigger index files was not known
7. On 2026-10-04 `cdn.cboe.com` answered the options endpoint with HTTP 307 to `cdn-api.cboe.com`. Redirect-following clients (curl -L, fetch, requests) are expected to keep working but this was not re-verified through the real proxies
