# Configuration

Every setting of gex in one place: what the app remembers in the browser, the environment variables of the scripts, the workflow settings and the ports. Back to the [README](../README.md)

## Contents

- [Data source](#data-source)
- [Settings panel](#settings-panel)
- [What the browser remembers](#what-the-browser-remembers)
- [URL parameter](#url-parameter)
- [Environment variables](#environment-variables)
- [Workflow settings](#workflow-settings)
- [Ports and URLs](#ports-and-urls)
- [Fixed constants worth knowing](#fixed-constants-worth-knowing)

## Data source

The app has exactly four providers and no provider menu (`src/proxy-discovery.ts`):

| Provider | Needs | Notes |
|---|---|---|
| CACHE | nothing | `api/options/<SYM>.json` published with the site, refreshed by the workflows |
| CBOE | local proxy | delayed quotes with greeks, IV, OI and spot (`/api/cboe`) |
| YAHOO | local proxy | one request per expiration, the proxy handles crumb and cookies (`/api/options`) |
| NASDAQ | local proxy | full chain in one call, no IV, so no model greeks (`/api/nasdaq`) |

- **Auto (default):** the app asks `{proxy URL}/health` (500 ms timeout). Proxy found -> each ticker tries CBOE, then YAHOO, then NASDAQ, then CACHE, the first one that knows the ticker serves it. Not found -> CACHE, never an error
- **When it looks:** with **Proxy auto-discovery** off (default) once when the page loads; on, every 30 s and whenever the tab gets focus or becomes visible, and the open ticker is reloaded from the new source when the result changes
- **Published site:** a page not served from this machine (anything but `localhost`, `*.localhost`, `127.x.x.x`, `::1`) never contacts the proxy, not even the probe, until **Use my local proxy** is on, because Chrome 142+ asks every visitor for local network permission as soon as a page calls `localhost`. There the two are one switch: turning **Proxy auto-discovery** (Auto) on also turns `localProxyOptIn` on, turning `localProxyOptIn` off also turns `proxyAutoPoll` off. Locally they stay independent
- **Overrides** (Settings -> Data source -> Advanced): **Always cache** (never contacts the proxy) or one provider only (`CBOE only`, `YAHOO only`, `NASDAQ only`, no fallback)
- **Source label** next to the ticker: `LIVE CBOE`, `LIVE YAHOO`, `LIVE NASDAQ` or `CACHE <date of the data>` (amber when that day is not today); before a ticker is loaded `LIVE` or `CACHE`, while the first probe runs `…`
- The Chart tab follows the same result: candles through the proxy (`/api/chart`) when live, else `api/charts/<SYM>.json`

## Settings panel

The gear button in the top bar. Sections:

- **Theme:** system, light or dark (also the sun and moon button in the header, from `sm` width up)
- **Color palette:** `gex` (default) or `fundamentals`
- **Language:** English (default) or Russian (also in the header, from `sm` width up)
- **Data source:** Proxy auto-discovery switch (the same setting as **Auto** in the top bar), the probe status, a warning when Chrome blocked local network access for the published site, on the published site **Use my local proxy** or **Stop using my local proxy**; **Advanced:** Source override (Auto, Always cache, `<provider> only`) and the **Proxy base URL** (default `http://localhost:8787`); **Source:** the top bar's source label, read-only, with the same tooltip
- **Backtest (As of):** the same choice as the top bar's As of selector plus Import zip, Create backup and Backtest data
- **Desk columns:** per side (calls, puts) open interest, volume, IV, delta, gamma, theta, vega on by default; rho, lambda, vanna, vomma, charm, speed, zomma, color off. Bid, mid, ask and the strike are always shown
- **Cache:** record count and size of the query cache, size of the settings, oldest and newest record; **Clear data** (the query cache), **Clear settings** (the settings blob only), **Clear everything** (every `gex.*` key and the query cache; the backtest data stays, it has its own manager under "As of"). Each asks for a second click to confirm

## What the browser remembers

Everything stays in this browser (`localStorage` and IndexedDB), nothing is sent anywhere

| Key | What | Default |
|---|---|---|
| `gex.settings.v5` | the settings blob: `source` (`auto`, `static`, `cboe`, `yahoo`, `nasdaq`), `proxyAutoPoll`, `localProxyOptIn`, `proxyBase`, `language`, `theme`, `colorTheme`, `deskColumns`, `lastTicker`, `selectedExps`, `activeTab`, `gexMetrics`, `vixFuturesPricing` (Settings -> VIX futures-priced greeks, off) and leftovers `tokens`, `secrets`, `proxyTemplate` of removed providers | Auto, off, off, `http://localhost:8787`, `en`, `system`, `gex`, see above, `AAPL`, none, `desk`, Net GEX and AG |
| `gex.metricColors.v1` | colours of the metrics (Net GEX (+) and (-), AG, OI, volume, P/C) | built-in palette |
| `gex.levelColors.v1` | colours of the built-in levels | built-in palette |
| `gex.selectedLevels.v1` | which built-in levels are on: `{ "<level>": true/false }` for every level | Max Net GEX, Min Net GEX, Gamma Flip, Zero GEX, Max Pain, Max AG and Spot on; Net GEX+, Net GEX-, the two 75% Sum levels and Sigma off |
| `gex.netGexView.v1` | the switch in the Net GEX chip: `net` or `split` (Abs GEX) | `net` |
| `gex.zeroGexDisplay.v1` | the switch in the Zero GEX chip: `line` or `area` | `line` |
| `gex.sigmaMode.v1` | the switch in the Sigma chip: `pct` or `stat` | `pct` |
| `gex.customLevels.v1.<SYM>` | your custom levels of one symbol: id, name, price, colour, hidden flag | none |
| `gex.chartZoom.v2` | the GEX chart zoom per ticker (strike range), the last 200 tickers | full view |
| `gex.chartView.v1` | the Chart tab's visible window per ticker (offsets from the last bar) | the range button's view |
| `gex.chartRange.v1` | the Chart tab's range button | `6M` |
| `gex.valuesOpen.v1` | the Values table of the GEX sidebar open or closed | closed |
| `gex.backup.choice.v2` | what the last "Create backup" was made of | the preset (default tickers) |
| IndexedDB `gex-cache-db` | the query cache: every loaded chain, LRU, about 200 MB soft cap | empty |
| IndexedDB `gex-backtest-db` | archived days and backups you opened, imported or created (which day is open is not stored: every page load starts at today) | empty |

Not remembered on purpose: the collapsed or expanded Desk sections

**Migration:** an unknown or removed value falls back to its default when the blob is read (`loadSettings`): an unknown tab -> `desk`, an unknown metric is dropped (none left -> Net GEX and AG), an old `providerId` of the removed provider menu is dropped so everyone starts on Auto, a removed Cloudflare Worker template falls back to the default. The old `gex.cache.*` keys of the localStorage query cache are deleted on load. `gex.chartZoom.v1` (one ticker) is read once into `gex.chartZoom.v2`. `gex.selectedLevels.v1`: a level missing from the stored map (a browser from before the key existed, or a level added later) takes its default, unknown keys are ignored

**First visit:** with no `gex.settings.v5` nothing is fetched until you load a ticker; on later visits the last ticker and its expirations load by themselves

## URL parameter

`?debug=true` turns on verbose console logging

## Environment variables

### Fetcher `scripts/options-data.ts`

The full table with defaults is in [Automations: environment variables](automations.md#environment-variables-and-arguments). The ones you will use: `TICKERS` (add tickers), `DEFAULT_TICKERS` (replace the default list), `MAX_EXPIRATIONS`, `EXPIRATION_RULE`, `KEEP_EXPIRATIONS`, `ROTATE_STALE`, `DRY_RUN`, `CONCURRENCY`, `REQUEST_SLEEP`, `HISTORY`, and the argument `all`

### Run scripts and proxy

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `APP_PORT` | `bun run app`, `all`, `start`, `scripts/check-ports.ts` | 1234 | port of the Parcel dev server (`PORT` does not move the app) |
| `PORT` | `bun run proxy`, `all`, `start`, the proxy | 8787 | port of the local proxy |
| `HOST` | the proxy | `127.0.0.1` | interface the proxy listens on; `0.0.0.0` opens it to the LAN |

### Local data runner `scripts/data-local.ts`

| Variable or path | Default | Meaning |
|---|---|---|
| `GEX_DATA_RUNNER` | `<parent of the checkout>/.worktrees/<repo>/data-runner` | the worktree the runs use (detached HEAD on `origin/main`) |
| `GEX_DATA_HOME` | `../gex-data-state` next to the main gex checkout (outside every repo) | `state.json` (last run per job, read by `data:status`) and `run.lock` (`{pid, job, started}`, one run at a time) |
| `GEX_DATA_LOG` | `<GEX_DATA_HOME>/gex-data.log` | the log (launchd stdout and stderr; foreground runs append too) |
| `GEX_DATA_PLIST` | `~/Library/LaunchAgents/com.daggerok.gex-data.plist` | the launchd agent written by `data:setup` |
| `GEX_DATA_LABEL` | `com.daggerok.gex-data` | the launchd label |
| `HISTORY_KEEP_DAYS`, `HISTORY_KEEP_BACKUP_DAYS` | 14 | passed to the fetcher on a final partial run, like the repository variables of the same names |

The fetcher settings of each job are the workflow's (see [Automations](automations.md#jobs)); they are not configurable here on purpose

### TradingView futures and the live mode

The session lives in `~/.config/gex/tradingview.env` (mode 600, outside the repository, never committed). Full guide: [README, Local proxy and TradingView live mode](../README.md#local-proxy-and-tradingview-live-mode)

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `GEX_TV` | the proxy | on | `0` turns the TradingView live mode off |
| `GEX_TV_ENV` | the proxy, `tv:*` | `~/.config/gex/tradingview.env` | another session file (a copy with a wrong value shows the "session expired" path without touching the real one) |
| `TV_SESSIONID`, `TV_SESSIONID_SIGN` | the proxy, `tv:*` | from the file | the session in the environment instead of the file |
| `TV_RENEW_EVERY_MS` | `tv:futures`, the proxy | off | debug: renew the 4-hour token this often (at least 60000) |

### Tests

| Variable | Default | Meaning |
|---|---|---|
| `E2E_JOBS` | `min(4, CPUs)` | browser checks run side by side; 1 = one at a time |
| `E2E_BUILD` | set by the runner | the prebuilt app the checks serve |
| `SHOTS_DIR`, `CROSSHAIR_SHOTS` | off | two checks save screenshots there when set |

## Workflow settings

| Setting | Where | Default | Meaning |
|---|---|---|---|
| `BACKTEST_TICKERS` | repository variable | empty (off) | `all` or a list: the hourly workflow also makes a backup zip every run |
| `HISTORY_KEEP_DAYS` | repository variable | 14 | days of daily zips kept |
| `HISTORY_KEEP_BACKUP_DAYS` | repository variable | 14 | days of backup zips kept |
| fetch env of each workflow | the workflow files | see [Automations](automations.md#workflows-at-a-glance) | `MAX_EXPIRATIONS`, `KEEP_EXPIRATIONS`, `CONCURRENCY`, `REQUEST_SLEEP`, `MAX_FETCHES`, `ROTATE_STALE` |
| `api/All.txt` | the repository | 356 tickers | the extra tickers of the weekly refresh |
| `api/Indices.txt` | the repository | SPX, XSP, NDX, DJX, RUT | the supported cash indices (kept in sync with `INDEX_DIVIDEND_YIELDS`, checked by `src/greeks.test.ts`); no workflow reads it since 2026-10-26 |
| Pages | Settings -> Pages | GitHub Actions | the site is deployed by the workflows |
| Workflow permissions | Settings -> Actions -> General | Read and write | the data workflows commit |

No secrets are used: the workflows use the built-in `GITHUB_TOKEN` only

## Ports and URLs

| What | Default |
|---|---|
| app (dev) | http://localhost:1234 (`APP_PORT`) |
| local proxy | http://localhost:8787 (`PORT`), `GET /health` answers `{"ok":true,...}` |
| published site | https://daggerok.github.io/gex/ (built with `--public-url=/gex/`) |
| proxy CORS allowlist | `http(s)://localhost:*`, `http(s)://127.0.0.1:*`, `https://daggerok.github.io` (`scripts/proxy-cors.ts`) |

## Fixed constants worth knowing

Not settings, but they decide what you see. All in `src/gex.ts` and `src/greeks.ts` unless noted

| Constant | Value | Effect |
|---|---|---|
| `CONTRACT_MULTIPLIER` | 100 | shares per option contract in every $ value |
| `BS_RISK_FREE_RATE` | 4.5% | model greeks |
| `INDEX_DIVIDEND_YIELDS` | SPX and XSP 1.1%, NDX 0.6%, DJX 1.5%, RUT 1.1%; others 0 | model greeks |
| `SETTLEMENT_HOUR_ET`, `AM_SETTLEMENT_ET` | 16:00, 9:30 for the SPX, NDX, RUT monthlies | time to expiration |
| `MIN_MINUTES_TO_EXPIRATION` | 15 | floor of the time to expiration |
| `NET_GEX_PLUS_MINUS_MIN_DISTANCE_PCT` | 3% of spot (SPY: $3) | Net GEX+ and Net GEX- distance |
| `SUM_NET_GEX_SHARE` | 75% | the 75% Sum levels |
| `GAMMA_FLIP_RANGE_PCT`, `GAMMA_FLIP_GRID_POINTS` | +/-20%, 60 points | Gamma Flip sweep |
| `GAMMA_FLIP_MIN_IV` | 5% | below it an IV counts as a failed solve |
| `GAMMA_FLIP_COVERAGE_WINDOW_PCT`, `GAMMA_FLIP_MIN_IV_COVERAGE` | +/-2% of spot, 80% | Gamma Flip coverage gate |
| `SIGMA_PCT_STEP` | 1% | Sigma % mode step |
| `PROXY_PROBE_TIMEOUT_MS`, `PROXY_POLL_MS` | 500 ms, 30 s | proxy discovery (`src/proxy-discovery.ts`) |
| `CACHE_MAX_BYTES` | 200 MB | query cache soft cap (`src/settings-store.ts`) |
