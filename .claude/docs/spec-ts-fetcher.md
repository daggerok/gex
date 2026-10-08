# Bun TypeScript options fetcher - findings, endpoint mapping, parity

Research and verification notes for `scripts/options-data.ts`, the port of `scripts/options-data.py` (yfinance plus requests). Done 2026-10-08. Both fetchers coexist until the user declares parity proven, the Python one is not deleted by this change

## 1. Goal and result

- One Bun script, no dependencies (global `fetch` only), runnable as `./scripts/options-data.ts`, same env vars and same output files as the Python script (rule R3, `data/options/*.json` schema untouched)
- Output is byte-identical: every file in every replay scenario and in two live runs compared exactly once the `updated` value is masked, details in section 5
- Not done on purpose: no change to `.github/workflows/*.yml` (rule R4), the migration is described in section 7

## 2. What yfinance actually did (read from yfinance 1.7.0 source, confirmed by request logs)

- `Ticker.options` is one call, `GET https://query2.finance.yahoo.com/v7/finance/options/{sym}` with the crumb. Expiration labels come from `pd.Timestamp(unix, unit="s").strftime("%Y-%m-%d")`, that is the UTC date, kept in an insertion-ordered dict that every later response also updates
- `Ticker.option_chain(date)` is `GET .../options/{sym}?date={unix}`, the unix value is the one stored for that label. The frames are built with a fixed 14-column `reindex`, so a key missing in the response becomes NaN and ends up as `null`
- Spot: `_spot` calls `fast_info.get("last_price")`, but `FastInfo.get` only accepts the camelCase keys, so it returns `None` for `last_price` on every ticker. The spot has therefore always come from the fallback `history(period="1d")["Close"].iloc[-1]`. Because `history` defaults to `auto_adjust=True`, that Close is Yahoo's `adjclose` of the last daily bar. This matches the observation in `spec-index-options.md` section 5.1 and is kept on purpose, see section 6
- `history("1d")` is `GET .../v8/finance/chart/{sym}?range=1d&interval=1d&includePrePost=false&events=div,splits,capitalGains`, then: sort by timestamp, if the last two bars fall on the same exchange-timezone day drop the second to last, drop duplicate days, scale Open, High and Low by `adjclose/close` and make `adjclose` the Close, drop rows where every price, the volume and the event columns are NaN or zero, take the last row. Any failure makes the spot `None` (the wrapper swallows exceptions)
- Session: `GET https://fc.yahoo.com` for the `A3` cookie, then `GET https://query1.finance.yahoo.com/v1/test/getcrumb` with that cookie. The crumb is appended as `crumb=` to every request. On HTTP 400 or higher yfinance switches the cookie strategy, fetches a new crumb and retries once, HTTP 429 raises `YFRateLimitError`. yfinance also keeps the cookie in a local sqlite cache between runs and the exchange timezone in another one
- A ticker with no listed options answers HTTP 200 `{"optionChain":{"result":[],"error":null}}`, an unknown ticker on the chart endpoint answers 404 `{"chart":{"result":null,"error":...}}`

## 3. Endpoint mapping

| Python | TypeScript (`scripts/options-data.ts`) | Request |
|---|---|---|
| `yf.Ticker(c).options` | `YahooTicker.options()` | `GET query2/v7/finance/options/{c}?crumb=` |
| `Ticker.option_chain(exp)` | `YahooTicker.optionChain(exp)` | `GET query2/v7/finance/options/{c}?date={unix}&crumb=` |
| `_spot` via `history("1d")` | `YahooTicker.lastClose()` and `parseChartLastClose` | `GET query2/v8/finance/chart/{c}?range=1d&interval=1d&includePrePost=false&events=div,splits,capitalGains` |
| cookie and crumb | `newYahooSession` and `yahooGet` | `GET fc.yahoo.com`, `GET query1/v1/test/getcrumb` |
| `_rows_from_frame` | `rowsFromChain` | none |
| `_fetch_cboe_greeks`, `_apply_greeks_enrichment` | `fetchCboeGreeks`, `applyCboeRows` | `GET cdn.cboe.com/api/global/delayed_quotes/options/{sym}.json` |
| `_live_cboe_universe` | `liveCboeUniverse` | `GET cdn.cboe.com/data/us/options/market_statistics/symbol_reference/opt-underlying.csv` |
| `_live_nasdaq_marketcap_universe` | `liveNasdaqUniverse` | `GET api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000&download=true` |

The Cboe CSV is decoded as ISO-8859-1 because `requests` does that for `text/*` without a charset. Yahoo is called with a Chrome user agent, a plain default one gets HTTP 429 (also noted in `scripts/options-local-proxy.ts`)

## 4. Output compatibility details that are easy to get wrong

- Python `json.dump` prints floats with `repr`: `1.0`, `1e-05`, `1e+16`, `0.00012`. `JSON.stringify` prints `1`, `0.00001`. The port has its own serializer (`pyJsonDumps`, `pyFloatRepr`), plain JS numbers are floats and the few Python ints (`count`, the greeks counters, a missing strike which becomes `0`) are wrapped in `PyInt`
- `ensure_ascii` is on: every non-ASCII character and `0x7f` become `\uXXXX` (surrogate pairs for emoji). Chain files use `separators=(",",":")` and have no trailing newline, `index.json` uses `indent=2` and ends with a newline
- `_num` accepts numeric strings (`float("2.50")`), booleans and rejects NaN and infinity, `num()` does the same
- A missing `contractSymbol` becomes the string `"nan"` (pandas NaN passed through `str`), a missing or null numeric field becomes `null`, a quote with strike 0 or none gets the int `0`
- `updated` and every log line carry the market-timezone offset (`isoWithOffset`, same text as `datetime.isoformat`, microseconds only when non-zero)
- Weekend dead zone: Python compares aware datetimes that share one tzinfo, which compares wall clocks. The port compares wall-clock numbers (`wallMs`) for the same reason
- Error semantics kept: a chain answer with no `calls` or `puts` key skips that expiration (`SKIP_EXPIRATION`), an empty options payload for an expiration raises (the Python code calls `.iterrows()` on `None`), a null `optionChain` or a non-JSON body is an error, an empty `result` is "no options" and goes to the skiplist

## 5. Parity method and results

Tools live in `scripts/options-parity/` (temporary, delete together with `scripts/options-data.py`): `run.sh` drives the scenarios, `compare.ts` compares two output directories, `net-preload.ts` and `net_harness.py` replace the network layer of each implementation with the same recorded responses, `make-synth.ts` writes synthetic fixtures, `setup-legacy.ts` seeds the legacy-shape scenario. Every run works on scratch copies of `data/options`, the repo data is never written

Comparison levels in `compare.ts`:

- EXACT: bytes equal after masking the `updated` value
- STRUCTURAL: equal after masking every number (same keys, key order, nulls, number formatting style), value drift is then quantified per quote field
- DIFFERENT: anything else

### 5.1 Live runs, py then ts back to back, real network

| Run | Files | Result |
|---|---|---|
| `TICKERS="SPY AAPL BRK-B SPX QQQ ZZZZNOPE" MAX_FETCHES=10 MAX_EXPIRATIONS=15` | 346 | all EXACT |
| 30 tickers (indices NDX RUT XSP DJX VIX, ETFs, class share BRK-B) with `MAX_EXPIRATIONS=12` | 350 | all EXACT |

Both ran after the US close (Thursday 2026-10-08, about 18:30 New York time), so last, bid, ask and volume did not tick between the two runs and the value drift is zero. Drift during market hours is not measured by this change and cannot be separated from real market movement, rerun `scripts/options-parity/run.sh live` during the session to quantify it. The structural checks do not depend on timing

### 5.2 Recorded fixtures, identical upstream bytes into both implementations

`run.sh record <scenario>` records the TS run on the real network, `run.sh replay <scenario>` feeds those responses to the TS script and to the unmodified Python script (yfinance and requests patched below `YfData.get` and `requests.get`)

| Scenario | What it covers | Requests py vs ts | Output |
|---|---|---|---|
| `explicit` | the live set above, skiplist path via a nonexistent ticker, `^SPX` variant resolution, Cboe 403 then `BRK.B` retry, `_SPX` Cboe candidate | identical, 94 | 346 files EXACT |
| `universe` | no `TICKERS`: Cboe CSV plus a NASDAQ page, coverage phase (3 files removed from the seed) then oldest-first refresh, names with unicode, class share `BRK/B`, caret row, floor, empty and NaN caps | identical, 47 | 348 files EXACT, including `index.json` names |
| `legacy` | legacy `index.json` (files as a map plus `generated`), pre-v9 skiplist file migration and removal, cache files with missing, empty, naive, offset and date-only `updated` | identical, 44 | 346 files EXACT |
| `errors` | HTTP 429 text, null `optionChain`, HTML gateway page, three errors then STOP | differs by 2 (see below) | 346 files EXACT, nothing written, nothing skiplisted |
| `weird` | key missing in a chain row, string numbers, `1e-05`, `1e+16`, strike 0, missing `contractSymbol`, skipped expiration, empty expiration payload, Cboe strings and nulls, two bars on one day with `adjclose` different from `close` | identical, 8 | 347 files EXACT |

Notes:

- The NASDAQ screener does not answer scripted clients from the machine used here (read timeout for `requests` and for `fetch` alike), so the `universe` and `legacy` scenarios use a synthetic page built in `make-synth.ts`. The real NASDAQ response shape is unchanged from what the Python code already parsed
- The `errors` request difference is the harness: the TS script retries once with a fresh session on HTTP 400 or higher, like yfinance does below `YfData.get`, a layer the harness replaces. The retry itself is covered by a unit test
- On a cold timezone cache yfinance issues one extra chart request per new ticker (`TZLOOKUP` in the logs, seen once in `universe`). `run.sh` ignores it, it has no effect on the output
- Log lines match except for deliberate wording: arrows and dashes in a few messages are ASCII in the TS script (writing style rule), and error texts that come from the runtime (`JSON.parse` messages, Python exception text)

### 5.3 Cross-checks of helpers against Python (scratch, not committed)

| Check | Cases | Result |
|---|---|---|
| `json.dumps` text (indent 2 and compact) re-emitted by `pyJsonDumps`: 220k random floats across 60 decades, integer-valued floats up to 1e20, escapes, empty containers | 220,022 floats and 9 strings | identical |
| `is_fresh`, `_file_is_fresh`, `_skip_is_active` with a faked clock, random instants over 400 days, offset, UTC, naive, date-only and invalid `updated` values, for `America/New_York`, `UTC`, `Asia/Tokyo`, `Europe/London` | 24,000 | identical |
| `datetime.fromtimestamp(ms, tz).isoformat()` vs `isoWithOffset` for six zones including `Asia/Kolkata` and `Australia/Lord_Howe` | 24,000 | identical |

## 6. Intentional differences and open choices

- Spot source is kept as the `history("1d")` adjusted close, although the intent of the Python code was `fast_info.last_price`. Changing it to `regularMarketPrice` would alter output, so it needs a separate decision after the port is accepted
- Queue order for equal `updated` strings: Python iterates a `set` of cached symbols (random per process), the port sorts symbols first, so ties are deterministic
- Not ported: yfinance's persistent cookie and timezone sqlite caches (a run does one cookie and crumb exchange at start) and the EU consent (`csrf`) cookie strategy. If `fc.yahoo.com` gives no cookie the port falls back to the `finance.yahoo.com` cookie like `scripts/options-local-proxy.ts`. A crumb that stays empty means requests without it, which Yahoo answers with an error and the run counts it as an error streak
- Risk, unverified: yfinance impersonates Chrome TLS through curl_cffi, Bun's `fetch` does not. It works from a home connection, a GitHub-hosted runner (datacenter address) may be rate limited more aggressively. Run the workflow manually once before switching

## 7. Migration notes for the workflow (rule R4, not applied here)

When parity is accepted, `.github/workflows/update-data.yml` needs: Bun instead of uv in the two fetch steps (`./.github/actions/uv` replaced by a Bun setup step), the commands `TICKERS=$(cat data/All.txt) bun scripts/options-data.ts` and `TICKERS=$(cat data/Indices.txt) bun scripts/options-data.ts` (a multi-line `TICKERS` works, any whitespace separates symbols), `PYTHONUNBUFFERED` can go. `ci.yaml` and `dependency-updates.yml` keep the `py_compile` step until `scripts/options-data.py` is deleted. After that remove `scripts/options-data.py` and `scripts/options-parity/`, the `pyproject.toml` and `uv.lock` entries need a separate look

## 8. Tests

`src/options-data.test.ts` covers the pure helpers (formatting, symbols, freshness and skiplist, queue, index planning, Cboe overlay, chart parsing, a mocked Yahoo client including the 429 retry). The fetcher source layout is also checked in `src/data-paths.test.ts`
