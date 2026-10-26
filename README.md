# GEX [![CI](https://github.com/daggerok/gex/actions/workflows/ci.yaml/badge.svg)](https://github.com/daggerok/gex/actions/workflows/ci.yaml)

A single-page **options board** with English and Russian interface: enter a ticker, select one or more expirations, and view the classic **Calls | Strike | Puts** chain with bid / mid / ask, IV, volume, open interest and greeks. More tabs show a per-strike **Board**, **GEX** (gamma exposure by strike with key levels) and a price **Chart** with the same levels. The app is a static React + TypeScript + Tailwind CSS v4 site built by Parcel and published on GitHub Pages (https://daggerok.github.io/gex/). Data comes live through a small local proxy when it runs on your computer, otherwise from the cache published with the site.

We use **Bun** for JavaScript and TypeScript, including the data fetcher. Always use `bun` instead of `npm`.

---

## Table of contents

- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [How to use](#how-to-use)
- [Tabs: Desk, Board, GEX, Chart](#tabs-desk-board-gex-chart)
- [Data sources](#data-sources)
- [Local proxy and auto-discovery](#local-proxy-and-auto-discovery)
- [Ticker suggestions](#ticker-suggestions)
- [Static-cache greeks](#static-cache-greeks)
- [Updating the data](#updating-the-data)
- [Deploy to GitHub Pages](#deploy-to-github-pages)
- [Companion infrastructure](#companion-infrastructure)
- [Development](#development)
- [Project structure](#project-structure)
- [Privacy and keys](#privacy-and-keys)
- [Troubleshooting](#troubleshooting)

---

## What you get

- **Quota-friendly loading:** nothing fetches on page open except the ticker you had open last time. Type or pick a ticker and press Enter: its expirations load (the nearest one is selected); every expiration you select loads by itself
- **Automatic data source:** with the local proxy running you get live data (CBOE, else YAHOO, else NASDAQ, else the cache, per ticker), without it the cache published with the site. A label next to the ticker says which: `LIVE CBOE`, `LIVE YAHOO`, `CACHE 2026-10-23`. See [Local proxy and auto-discovery](#local-proxy-and-auto-discovery)
- **Ticker suggestions:** searchable ticker and company combobox. Local static suggestions use `api/options/index.json` names and mark known valid tickers without options as **`(no options)`**. The empty field hints at the main indices, ETFs and mega caps
- **Multiple expirations:** select one, many, or all expirations. Chains render stacked earliest to latest with sticky expiration headers
- **Desk UX:** ATM row highlight, sticky Calls / Strike / Puts headers, greeks columns enabled by default, per-side and per-column desk settings, empty cells for missing data, themed scrollbars, collapse and expand controls, and automatic centering on the current strike after load or expand
- **GEX and Chart tabs:** key levels (Max Net GEX, Min Net GEX, Net GEX+, Net GEX-, 75% Sum Net GEX+ and -, Gamma Flip, Zero GEX, Max Pain, Spot, Max AG, the strike with the largest absolute gamma, while the AG metric is on, and Sigma, off until you turn it on) computed once and drawn on both tabs, plus your own custom levels. Zero GEX is the owner's own rule (from the Max Net GEX strike walking down to the Min Net GEX strike, or from Min Net GEX walking up to Max Net GEX when the total is negative; each step into the other sign is a candidate zone, with several the one with the highest average absolute gamma of its two strikes wins; the line is the zone's strike of the other sign), a switch in its chip draws it as a line or as the band between the two strikes. Sigma marks the strikes nearest to spot +/- 1, 2, 3 %, or with the switch in its chip +/- 1, 2, 3 statistical sigma (spot x ATM IV x sqrt(days / 365) of the nearest selected expiration); grey dotted lines, on the Chart tab from the next day to the right edge
- **Themes:** light and dark (sun / moon button in the header) and two colour palettes in Settings
- **Internationalization:** English and Russian UI with a language switcher in the header and in Settings
- **Local browser state:** data source settings, theme, language, proxy URL, last ticker and expirations, active tab, desk columns, metric and level choices and colours, custom levels and the query cache are stored only in the browser (`localStorage` and IndexedDB)

## Quick start

This project uses **Bun** for installs and scripts and **Parcel** for the React and TypeScript build.

```bash
git clone https://github.com/daggerok/gex.git
cd gex
bun install -E
bun run start        # the app (Parcel, http://localhost:1234) and the local proxy (http://localhost:8787) together, under pm2
```

Open http://localhost:1234. `bun run serve` starts only the app (then it shows the cache), `bun run all:proxy` only the proxy. `bun run ps`, `bun run logs`, `bun run restart` and `bun run stop` manage the pm2 process. Add `?debug=true` to the URL for verbose console logging.

Production build:

```bash
bun run build
```

GitHub Pages build, with the correct `/gex/` public URL:

```bash
bun run build-github-pages
```

## How to use

1. Type a ticker or company name, pick a suggestion if useful, press Enter (or the search button): the expirations and the spot load, the nearest expiration is selected
2. Select more expirations in the Expirations panel next to the tabs (or **All**, **Reset** goes back to the nearest one): each loads by itself
3. Switch between the Desk, Board, GEX and Chart tabs, they all use the same selection

The source label next to the ticker shows where the data came from (`LIVE CBOE`, `CACHE 2026-10-23`, amber when the cached day is old). The data source is chosen automatically, see [Local proxy and auto-discovery](#local-proxy-and-auto-discovery)

## Tabs: Desk, Board, GEX, Chart

- **Desk:** the options chain described above
- **Board:** one row per strike of the selected expirations: Net GEX, Abs GEX, notional delta (the dealer delta exposure in $, this app's own definition), total, call and put OI and volume, P/C ratios and each strike's share of the Abs GEX. A dot marks each column's peak (Net GEX: its largest positive and most negative strike) in the positive or negative colour by the value's sign and tints the row by its Net GEX sign, the runner-up of a column gets the same dot and a tinted cell; the ATM row has the Spot colour and opens in the middle of the table. The same Metrics and Levels panels as on the GEX tab choose the columns and mark the levels on their strikes. The Expirations panel shows each expiration's share of the open interest
- **GEX:** gamma exposure by strike (the switch in the Net GEX chip shows "Abs GEX" instead: call GEX up and put GEX down at every strike; the AG line has a hollow ring in its colour at every strike) with toggleable and colorable Key Levels, a Levels table and a Values table (what each level means on its own strike), zoom and pan on the strike axis (remembered for each ticker, the last 200 tickers, also after a reload)
- **Chart:** daily candles (1 year loaded, the 1M / 3M / 6M / 1Y buttons next to the symbol in the top left corner of the chart only change the visible part; above the chart the same Metrics and Levels panels as on the GEX tab, in the same place) with the same GEX levels as price lines. It follows the data source: candles through the local proxy when it is found, otherwise the cached `api/charts/<SYM>.json` (no request to the proxy)

### Custom levels

You can add your own named levels on the **Chart** tab and on the **GEX** tab. They are stored per symbol in `localStorage` and show on both tabs as labelled lines on the charts and as chips of the Levels panel. They are not rows of the Levels and Values tables (on purpose, to keep those tables simple)

- **How to click:** a right click with the mouse. On a MacBook trackpad it is a **two-finger click** (or a two-finger tap when tapping is on in System Settings), the browser sends the same event as for a right click. **Ctrl+click** works on macOS too. Not over the plot (on an axis, outside the chart), the browser's own menu opens as usual
- **Add:** click where you want the level. The level goes on the **nearest strike**, never between two (on the GEX tab it is the strike under the pointer, on the Chart tab the strike nearest to the clicked price). A field opens at the pointer with the default name already selected: `Buyside` when the level is above the current price, `Sellside` when below it (`Buyside 2`, `Buyside 3`... when taken, each side counted apart), `Level 1`, `Level 2`... only when it is exactly at the price. Enter or the check button saves. Esc, the crossed-out pencil button or a click away cancels and creates nothing
- **Edit:** click the same strike again (Chart tab: right click on the line). The same editor opens with its name, with save, cancel and a delete (X) button
- **Move (Chart tab):** drag a custom line with the left mouse button, it follows the strikes and the new price is saved on drop
- **Colour:** one small square left of the name. A level above the current price starts green, one below it red, one at it or with no price known a neutral colour, the shade picked at random among those the other levels do not use. Click the square to choose another (ready colours or any colour of your own), the editor stays otherwise minimal. The square on the level's chip in the Levels panel changes it later
- **Show or hide:** the same **Levels panel** (the row of chips above the chart) is on the GEX tab and on the Chart tab and shares its choices: click a chip to show or hide that level (yours come first, then the built-in levels from the lowest price to the highest), click the square on it to change its colour. The Expirations panel next to the tabs is also on all three tabs
- **Remove:** the delete button in the editor
- The editor buttons sit in a row above the field, right-aligned on Windows and Linux, left-aligned on macOS and iOS
- The "?" buttons of both tabs explain this too (in the corners of the GEX chart, next to the ticker on the Chart tab)
- Custom levels are plain prices on a strike, they take no part in the GEX math

## Data sources

Four providers, no provider menu: the app picks the source by itself (`src/proxy-discovery.ts`).

| Provider | Needs | Coverage | Greeks | Notes |
|---|---|---|---|---|
| **CACHE** | Nothing | Cached tickers in `api/options/*.json` | Cboe delayed 1st-order, model-enriched in the browser | Same-origin static JSON refreshed by GitHub Actions. Used when no local proxy is found, and as the last fallback |
| **CBOE** | Local proxy | CBOE delayed options, equities and indices | Yes (provider + client Black-Scholes higher-order) | First choice with the proxy: greeks, IV, OI, spot (`/api/cboe`) |
| **YAHOO** | Local proxy | Yahoo option chains | Client Black-Scholes from IV | Second choice. Lazy per expiration, the proxy handles crumb and cookies (`/api/options`) |
| **NASDAQ** | Local proxy | NASDAQ option chain | No IV, so no model greeks | Third choice. Full chain in one call: bid, ask, last, volume, OI (`/api/nasdaq`) |

With the proxy found each ticker tries CBOE, then YAHOO, then NASDAQ, then CACHE, and the first that knows the ticker serves it. Settings -> Data source -> **Advanced** can fix the source: **Always cache** (never even looks for the proxy) or one provider only (`CBOE only`, `YAHOO only`, `NASDAQ only`). Removed long ago: marketdata.app, DoltHub, Tradier, Alpaca, Polygon/Massive, Alpha Vantage and other gated experiments

## Local proxy and auto-discovery

The browser cannot call Cboe, Yahoo or NASDAQ directly (no CORS), so live data goes through a small Bun proxy on your own computer, `scripts/options-local-proxy.ts`. Without it the app shows the cache published with the site.

### Start the proxy

```bash
bun install -E
bun run all:proxy        # http://localhost:8787, listens on 127.0.0.1 only
bun run start            # or: the app and the proxy together (pm2)
```

`PORT=9000 bun scripts/options-local-proxy.ts` changes the port, `HOST=0.0.0.0` makes it reachable from the LAN (on purpose only: it relays your own Yahoo session and IP). `curl http://localhost:8787/health` answers `{"ok":true,...}` when it runs.

### What auto-discovery does

- The app asks `{proxy URL}/health` (default `http://localhost:8787`, 500 ms timeout). Found -> live data: each ticker tries **CBOE -> YAHOO -> NASDAQ -> cache**, the first that knows it serves it. Not found -> the cache, never an error
- **Proxy auto-discovery** (Settings -> Data source, default **off**): off, the proxy is looked for **once when the page loads**, so after you start or stop it, refresh the page. On, it is looked for every 30 s and whenever you come back to the tab, and the data switches between live and cache by itself (the open ticker is loaded again from the new source)
- The **source label** next to the ticker shows the result: `LIVE CBOE`, `LIVE YAHOO`, `LIVE NASDAQ`, or `CACHE <date of the data>` (amber when that day is not today's). Before a ticker is loaded it shows `LIVE` or `CACHE`, while the first check runs `…`
- **Settings -> Data source -> Advanced:** the manual override (**Auto**, **Always cache**, or one provider only) and the **proxy URL**. Always cache never contacts the proxy, also when it runs (useful with a cache you built yourself, below)
- The **Chart tab** follows the same result: candles through the proxy (`/api/chart`) when the source is live, otherwise the cached `api/charts/<SYM>.json`

### On GitHub Pages

The published site (https://daggerok.github.io/gex/) never contacts your computer by itself: Chrome 142+ asks every visitor for permission to access the local network as soon as a site calls `localhost`. To use your proxy from the published site:

1. Start the proxy (`bun run all:proxy`)
2. Open Settings -> Data source -> **Use my local proxy** (once, it is remembered in this browser; **Stop using my local proxy** turns it off)
3. Allow the browser's prompt to access devices on your local network (Chrome)

From then on the published site behaves like the local app. The proxy answers browsers only for pages served from `localhost` or `127.0.0.1` (any port) and from `https://daggerok.github.io` (allowlist in `scripts/proxy-cors.ts`, any other page gets 403), and answers Chrome's private network preflight (`Access-Control-Allow-Private-Network: true`) only for those. Safari blocks `http://localhost` from an https page (mixed content), so there the published site stays on the cache; use the local app (`bun run start`)

### Build the cache yourself

The cache is the `api/` folder the fetcher writes (`scripts/options-data.ts`, see [Updating the data](#updating-the-data)). Locally:

```bash
./scripts/options-data.ts                          # the default tickers (indices, their ETFs, mega caps)
TICKERS="PLTR HOOD" ./scripts/options-data.ts      # the default tickers plus these
./scripts/options-data.ts all                      # everything (long)
bun run serve                                      # the app reads your fresh api/ (choose Always cache to ignore a running proxy)
```

The files change tracked data in `api/`; do not commit them by hand (`git checkout -- api` before a commit), the workflows publish the cache

### Futures options from your TradingView account (local)

**Available on the branch `feat/tradingview-futures` ([PR #202](https://github.com/daggerok/gex/pull/202), not merged yet), after #202 is merged also on `main`.** GEX for the CME index futures options `/ES`, `/NQ`, `/YM`, `/RTY` (and the micros) from your own TradingView account with CME data:

```bash
git checkout feat/tradingview-futures && git pull
bun run tv:session     # once: imports the TradingView session cookie from Chrome into ~/.config/gex/tradingview.env (mode 600)
bun run tv:check       # must print "ok"
bun run tv:futures     # ES NQ YM RTY, keeps running and rewrites api/futures/<ROOT>.json every minute (Ctrl+C stops)
bun run start          # the app, then enter /ES (or ES1!)
```

- `bun run tv:futures --once` writes the files once and exits (`--once ES` only that root, `--micros` adds MES, MNQ, MYM, M2K). The files land in `api/futures/<ROOT>.json`, the app reads them for `/ES` and `ES1!`
- The session file lives outside the repository, in your home folder, with mode 600. Never commit it, never paste its value anywhere (chat, issue, screenshot). Logging out of TradingView in the browser ends that session: log in again and rerun `bun run tv:session`
- Planned: live updates without a reload (with auto-discovery on, re-read the futures file on every check; later the proxy pushes the updates to the page)
- The details (publishing the files, troubleshooting) are in the README of that branch

## Ticker suggestions

- Static and local suggestions come from `api/options/index.json`:
  - `files`: tickers with cached option chains
  - `names`: ticker to company, fund or index display name
  - `no_options`: valid tickers where the latest data scan found no listed options, shown as **`(no options)`**
- With the local proxy found, suggestions also come from the provider-native full-text symbol search of the proxy (`/api/search?provider=...&q=...`)
- Provider search is a discovery helper: some matches can still return no option chain when loaded, the app then shows the provider's no-data error

## Static-cache greeks

**Single source of truth for model greeks: the browser** (`src/greeks.ts`)

- `scripts/options-data.ts` writes Yahoo quotes and, when available, **Cboe delayed 1st-order** greeks (`delta`, `gamma`, `theta`, `vega`, `rho`, `greeksSource: "cboe"`)
- It does **not** compute lambda, Vanna, Vomma, Charm, Speed, Zomma, Color or a full Black-Scholes fallback, that would duplicate the UI. Adding Black-Scholes calculations to the fetcher is forbidden
- After any provider fetch (including **CACHE**), the app runs client-side Black-Scholes enrichment: fills missing 1st-order greeks when IV and spot allow, and fills higher-order greeks whenever possible
- Remaining gaps use `greeksMissingReason` (from the fetcher or the client)
- All derived math (greeks, GEX, flip, walls, max pain) lives only in `src/greeks.ts`, `src/gex.ts` and `src/vix-pricing.ts`

## Updating the data

Scripts are executable and run directly (bun shebang): `./scripts/options-data.ts` and `./scripts/options-local-proxy.ts`. The fetcher has no dependencies, Bun is enough.

```bash
./scripts/options-data.ts                      # default: only SPX, NDX, DJX, RUT, IWM, SPY, QQQ, DIA, NVDA, AAPL, MSFT, AMZN, GOOGL, TSM, GOOG, META, AVGO, LLY, MU, WMT, AMD, JPM, V, BRK-B, XOM, ASML, JNJ
./scripts/options-data.ts all                  # the default set plus the full auto-universe (everything)
TICKERS="PLTR HOOD" ./scripts/options-data.ts  # the default set plus these tickers
DEFAULT_TICKERS="AAPL MSFT" TICKERS= ./scripts/options-data.ts  # only these: DEFAULT_TICKERS replaces the default set
CONCURRENCY=3 DEFAULT_TICKERS=AAPL,MSFT,NVDA ./scripts/options-data.ts
```

- Every run covers the default set: the main indices and their ETFs (S&P 500, Nasdaq 100, Dow Jones, Russell 2000) and the mega caps, written once in `scripts/options-data.ts` (`DEFAULT_SYMBOLS`) and saved to `api/options/index.json` as `defaults`, where the app reads the hint of the empty ticker search field and the backup preset (an older index without the field: a plain "Ticker" hint, no preset). `TICKERS` adds tickers on top of it (it never replaces it, so a workflow can list the tickers being traded and they are refreshed with the default set), `DEFAULT_TICKERS` replaces the default set itself (rarely needed; blank keeps the built-in list). Pass `all` for the smart auto-universe run after the default set and `TICKERS`: missing symbols first, then the oldest cached files. Any other argument is an error
- `COMP`, `DJIA`, `INDU` and `NYA` are not in the default set: on Yahoo and Cboe `COMP` is Compass, Inc. and `DJIA` the Global X Dow 30 Covered Call ETF, `INDU` and `NYA` have no listed options. The Dow is covered by `DJX` and `DIA`, the Nasdaq by `NDX` and `QQQ`
- SPY, SPX, QQQ and NDX are always queued first
- Every cache file carries `date`, the trading day its data belongs to (market time, before 9:30 and on weekends it is still the previous weekday). The **final runs of the trading day** (any scheduled run from 16:30 to 23:59 New York time, `HISTORY=1` in the workflow) writes the files of the default set into the zip of that day, `api/history/<YYYY-MM>/<YYYY-MM-DD>.zip` (entries `<day>/<SYM>.json` and `<day>/manifest.json`, the last state of the day), and `api/history/index.json` lists the days and tickers. Running again with the same files changes nothing. A day whose last run did not happen has no zip (the sources only give the current chain, a missed day cannot be fetched later). The daily zips of the last 14 days are kept (`HISTORY_KEEP_DAYS`, default 14, `0` = keep all), older ones are deleted by that same run; backups made on demand rotate the same way (`HISTORY_KEEP_BACKUP_DAYS`, default 14, by the date in their id, repository variables `HISTORY_KEEP_DAYS` and `HISTORY_KEEP_BACKUP_DAYS` override, `0` keeps forever). `HISTORY` is off by default (a local run does not write archives). The zips are deployed with the site (about 2 MB a day). Holidays are not known, a holiday run keeps the weekday label
- **Backtest backups (on demand).** `bun run backtest:backup` copies the cache files into one zip, `api/history/<YYYY-MM>/<YYYY-MM-DD-HH-mm>.zip` (New York time, to the minute), and never overwrites: run it as often as you like, also for the same date, and every backup stays. With no arguments it backs up the preset of required tickers (`DEFAULT_SYMBOLS` of `scripts/options-data.ts`, the same 27 the partial refresh keeps fresh, one without a file is left out), with `all` all available data, with tickers (`bun run backtest:backup SPY NDX`, space or comma separated) only those; a ticker without a file is an error. The backup is a byte for byte copy of the files at that moment. In CI: the **Backtest backup** workflow (Actions tab, run by hand) takes `tickers` (empty = the preset of required tickers, `all` = all data) and `refresh` (fetch fresh data first, for those tickers or the preset); the hourly default refresh also makes a backup when the repository variable `BACKTEST_TICKERS` is set (`all` or a list like `SPY NDX`), off by default because a backup of everything every hour adds tens of MB per hour. A day's automatic end-of-day archive is `YYYY-MM-DD.zip`, a backup is `YYYY-MM-DD-HH-mm.zip`, they live side by side. Size: a ticker file is 0.1 to 3 MB, about 7 times less zipped
- **Backtest in the app ("As of").** One selector in the top bar, for all tabs. Grey = not a backtest: "As of today" while a live provider answers, otherwise "As of <date>" (the newest cache file, `api/latest.json`). Pick "Latest" (not a backtest) or an archived day or backup (the ones on the site from `api/history/index.json`, plus the ones held in this browser) and the amber banner "Backtest: as of ..." shows: Desk, GEX and Chart read that snapshot (chain, spot, expirations, levels computed from it, model greeks valued on that day, Chart candles cut after that day), live providers are off, a ticker that is not in the archive shows an error, **Back to live** returns. The menu also has **Import zip** (a day zip, a backup or a bundle, read in the browser, nothing is uploaded), **Create backup** (the preset of required tickers is the default, the choice of the last backup is remembered, `Current ticker`, `All available data` and chosen tickers are the other options, Enter downloads `<id>.zip`, the same file the CI backup makes plus your custom levels as `custom-levels.json`, also kept in the browser) and **Backtest data** (list of what the browser holds with size and source, download one or several as ONE zip, remove selected, everything older than a date, or all). A snapshot's custom levels replace yours and are read-only while it is open. Held days stay in IndexedDB until you remove them and work offline
- **Full screen.** The expand button on the chart card (left of the zoom buttons on the GEX tab, at the end of the SPY / Interval panel on the Chart tab) or the **F** key (not while typing in a field) shows the chart over the whole window; the same button, **F** or **Esc** brings it back. Zoom buttons, keys, intervals and the level editor work in full screen
- **Touch screens.** On the GEX and Chart tabs a long press (one finger held still for half a second) opens the custom level editor at the finger, like a right click with a mouse (a short tap or a drag does not). On the GEX tab two fingers pinch to zoom around the middle between them, and one finger drags the zoomed chart sideways (a vertical drag still scrolls the page)
- **Cleaning up the archive is deleting files.** Drop a month with `rm -r api/history/2026-08`, a single snapshot with `rm api/history/2026-08/2026-08-14-15-42.zip`, then commit and push. `index.json` follows the disk: the next run drops the snapshots that are gone (one still listed whose zip is missing is shown as unavailable in the meantime). Never edit the zips or `index.json` by hand. A ticker whose own file has not been refreshed since that day would be archived into its day again by the next run, which only happens for a ticker that stopped being updated
- `KEEP_EXPIRATIONS=1` (default off) keeps the later expirations that a ticker's file already holds: the nearest `MAX_EXPIRATIONS` dates are fetched again as usual, the rest stay, and only their Cboe greeks, open interest and volume are refreshed (their bid, ask, last and IV stay as of the last run that covered them). Without it a run keeps only the nearest `MAX_EXPIRATIONS` dates
- After the options pass every cached ticker gets `api/charts/<SYM>.json` (1 year of daily bars, about 12 KB each, `CHART_MAX_FETCHES` per run), so the Chart tab works from CACHE without a proxy
- `CONCURRENCY` is an integer >= 1 (default 1), each worker waits `REQUEST_SLEEP` after its own write. Cboe requests share one throttle (`CBOE_MIN_INTERVAL`, default 1 s) and on a 429 every worker pauses (`CBOE_BACKOFF`, `CBOE_RETRIES`), so more workers do not raise the Cboe request rate. A ticker whose Cboe retries run out fails and keeps its old file
- `SOFT_DEADLINE_SECONDS` (default 0, off) stops starting new tickers after that many seconds. `VERBOSE=1` also prints the old timestamped progress lines
- The run prints a `[ config   ]` block, one status line per ticker (`new`, `updated`, `unchanged`, `no-options`, `failed`) and a `[ done     ]` summary
- The full list of tunables (`MAX_FETCHES`, `MAX_EXPIRATIONS`, `UNIVERSE_SIZE`, `SKIP_RECHECK_DAYS` and others) is in the header comment of `scripts/options-data.ts`
- Running the fetcher changes tracked files in `api/`. For a local check discard them before committing (`git checkout -- api`), a commit should contain only the source change

## Deploy to GitHub Pages

1. Enable Pages in repo **Settings, Pages**
2. Allow Actions to commit: **Settings, Actions, General, Workflow permissions, Read and write permissions**
3. The **Update options data** workflow (every Saturday at 10:00 UTC, or by hand from the Actions tab) runs `scripts/options-data.ts` for the tickers listed in `api/All.txt`, then for the index options in `api/Indices.txt` as a separate step with a smaller budget, and commits the refreshed `api/options/*.json` back to `main`
4. The **Update partial options data** workflow runs `scripts/options-data.ts` with no arguments (only the default set; a default ticker keeps its expirations by rule: every listed date up to 42 days, the Friday weeklies up to 92 days, the monthlies and quarter-ends up to one year, no LEAPS; other tickers keep `MAX_EXPIRATIONS`; `EXPIRATION_RULE=0` turns the rule off for a quick local run) every hour on weekdays at 8:45, 9:45, ..., 16:45 New York time, plus 17:15, 18:15 and 19:15 after the close (12 runs a day, 4 tickers at a time, about 20 s of fetching). **It does not commit the hourly data**: each run builds the site from the fresh files and deploys it to GitHub Pages itself (its `deploy` job), so the repository does not grow by about 2 MB a run. Only a final run commits: any scheduled run that starts from 16:30 to 23:59 New York time writes the day's archive zip and `api/latest.json` (and a backtest backup, from the run that made it); several final runs are fine, a ticker whose data did not change keeps its zip entry, so a later one commits only what changed after the close. Any other deploy (`github-pages.yml`, a code push or the weekly full refresh) refreshes the default tickers before building, so the site never shows the older committed files. The schedule runs in New York time (`timezone: America/New_York`); a step skips a scheduled run that starts before 8:40 or after midnight. GitHub drops some scheduled runs and starts others late, the three after-close slots make sure the day gets its archive. Market holidays are not skipped. It can also be started by hand from the Actions tab
5. The **GitHub Pages** workflow builds the app with `bun run build-github-pages` and deploys `dist/`

## Companion infrastructure

Optional files outside the core app source:

- `scripts/options-data.ts`: the fetcher (see [Updating the data](#updating-the-data)). Builds and refreshes `api/options/*.json`, attaches Cboe delayed **1st-order** greeks only (model greeks are UI-only), maintains `api/options/index.json` with `{ files, count, names, no_options, defaults }` and writes `api/charts/<SYM>.json`
- `.github/workflows/update-data.yml`: weekly refresh (Saturday 10:00 UTC) of all tickers of `api/All.txt` and `api/Indices.txt`, also manual
- `.github/workflows/update-partial-data.yml`: hourly refresh of the default set on weekdays during market hours
- `scripts/options-local-proxy.ts`: local **Bun** proxy (`bun run all:proxy`, see [Local proxy and auto-discovery](#local-proxy-and-auto-discovery)) serving:
  - `/health`: what the app's auto-discovery asks
  - `/api/options`: Yahoo optionChain with crumb and cookie handling
  - `/api/chart`: Yahoo daily candles for the Chart tab
  - `/api/nasdaq`: NASDAQ option-chain relay
  - `/api/cboe`: CBOE delayed-options relay
  - `/api/search?provider=yahoo|nasdaq|cboe&q=...`: provider-native suggestions

## Development

Stack: React 19, TypeScript, Tailwind CSS v4, Recharts, lightweight-charts (Chart tab), Parcel 2, Bun, GitHub Pages.

```bash
bun i -E            # install dependencies
bun run start       # app together with the local proxy (pm2 under the hood)
bun run stop ; bun run start ; sleep 3 ; bun run ps ; bun run logs   # restart cycle (logs keeps following, Ctrl+C)
```

### Tests

- **Unit tests:** `bun test` runs every `src/*.test.ts`
- **Browser (e2e) tests:** `bun run test:e2e` runs `src/*.e2e.ts` in headless Chromium through Playwright (needs `bunx playwright install chromium` once; `bun run test:e2e proxy-auto` runs only the checks whose name contains that text). `src/e2e-site.ts` builds the app into a temp folder and serves it with the SPY and QQQ data; `noProxy(page)` makes the default proxy port fail (the app then uses the cache), `startFakeProxy()` stands in for the local proxy
- `src/layout.e2e.ts` guards the page layout at three window sizes: no page scroll on any tab (only the Desk and Board tables, the GEX sidebar and the Cursor list scroll inside), the footer pressed to the bottom, no empty space above it, one footer design on all tabs. Its error message lists what is wrong, what was expected and measured, and which files to look at
- Naming: unit tests are `*.test.ts`, e2e are `*.e2e.ts`, never the other way, so `bun test` does not run browsers
- CI (`.github/workflows/ci.yaml`, pull requests only) runs the unit tests, the e2e tests, `bun build` of the fetcher and both builds. `main` is built and deployed by `github-pages.yml`

### Pre-PR checks

1. Unit tests pass: `bun test`
2. Browser tests pass: `bun run test:e2e`
3. The project builds: `bun run build`
4. The fetcher bundles: `bun build --target=bun scripts/options-data.ts --outfile=/dev/null`
5. No secrets, no leftover debug logs, no changed files in `api/` that you did not mean to commit

Every UI string needs an `en` and a `ru` entry in `src/i18n.tsx`. Never commit `dist/`, `node_modules/` or `.parcel-cache/`.

## Project structure

```text
src/
  index.html                  # Parcel entry shell
  index.css                   # Tailwind v4, theme tokens, scrollbar and table-desk CSS
  main.tsx                    # App shell: state (incl. active tab), effects, render
  types.ts                    # domain and settings types
  i18n.tsx                    # en and ru dictionaries, I18nProvider, useI18n()
  utils.ts                    # debug logger, formatting and parsing helpers, friendlyError
  proxy-discovery.ts          # auto data source: proxy /health probe, CBOE -> YAHOO -> NASDAQ -> CACHE, source label
  greeks.ts                   # client-side Black-Scholes model greeks (single source of truth)
  gex.ts                      # GEX profile and key levels (pure functions)
  vix-pricing.ts              # Black-76 pricing for futures-priced symbols (VIX, VXN)
  use-gex-levels.ts           # levels computed once, shared by the GEX and Chart tabs
  custom-levels.ts            # custom chart levels: names, storage, platform helper
  use-custom-levels.ts        # shared store of the custom levels (Chart edits, GEX shows)
  gex-colors.ts               # level colors, the only place for them
  theme.ts                    # theme controller hook and palette accent classes
  settings-store.ts           # persisted settings and the IndexedDB query cache
  providers/                  # CACHE, CBOE, NASDAQ, YAHOO providers, registry, loaders, chart data
  components/                 # TopBar, TabSwitcher, SettingsPanel, ChainTable, ToolbarRow, Metrics and Levels panels, Tip, switches, icons
  views/                      # DeskView, BoardView, GexView, ChartView
  *.test.ts                   # unit tests
  history-zip.ts              # zip format of the daily archives (read in the app, built by the fetcher)
  *.e2e.ts, e2e-site.ts       # browser tests and their site helper
api/
  options/                    # one option-chain cache file per ticker, plus index.json
  charts/                     # one file of 1 year of daily bars per ticker
  history/                    # index.json plus one folder per month, in it one zip per earlier day (last state of the default tickers)
  All.txt, Indices.txt        # ticker lists of the update workflow
scripts/
  options-data.ts             # the fetcher: Yahoo and Cboe -> api/options and api/charts
  history-archive.ts          # writes the day zip api/history/<month>/<day>.zip (last run of the day), prunes old days, keeps index.json in step with the disk
  backtest-backup.ts          # makes an on-demand backup zip (all data or chosen tickers)
  # src/backtest/: snapshot format, zip reading and writing in the browser, controller (the logic of the As of feature), store (IndexedDB)
  options-local-proxy.ts      # local Bun proxy: health, Yahoo, chart, NASDAQ, CBOE, search
  proxy-cors.ts               # the proxy's CORS allowlist and private network preflight answer
.github/workflows/
  ci.yaml                     # pull request checks
  update-data.yml             # data refresh of all tickers (weekly, also manual)
  update-partial-data.yml     # hourly refresh of the default set (+ optional backtest backup)
  backtest-backup.yml         # backtest backup by hand
  github-pages.yml            # Pages deployment
  dependency-updates.yml, npm-check-updates.yml
package.json                  # Bun and Parcel scripts
```

## Privacy and keys

- Browser settings and tokens are stored in the browser only
- No application backend exists unless you run or deploy the optional proxy
- On shared computers, clear keys and settings from the app settings or the browser storage
- The published site never contacts your computer unless you click **Use my local proxy**; the proxy listens on `127.0.0.1` only and answers browsers only for the local app and the published site

## Troubleshooting

- **Nothing loads on open:** expected on the first visit. Type a ticker and press Enter
- **The label says CACHE although the proxy runs:** with Proxy auto-discovery off the proxy is looked for only when the page loads, refresh the page (or turn auto-discovery on). Check `curl http://localhost:8787/health`, the proxy URL in Settings -> Advanced, and that the override there is **Auto**. On the published site click **Use my local proxy** first
- **403 "origin not allowed" from the proxy:** the page is not served from `localhost` / `127.0.0.1` or `https://daggerok.github.io` (allowlist in `scripts/proxy-cors.ts`)
- **`Unexpected token '<'`:** a proxy or server returned HTML instead of JSON. Check the proxy URL in Settings -> Advanced
- **CACHE says not cached:** the ticker is absent from `api/options/*.json`. Start the local proxy, or run the fetcher for it (`TICKERS=XYZ ./scripts/options-data.ts`)
- **`(no options)` suggestion:** the ticker is valid in the local manifest, but the latest data scan found no listed options
- **Port 8787 in use:** `PORT=9000 bun scripts/options-local-proxy.ts` and set `http://localhost:9000` in Settings -> Advanced
- **Chart tab empty for a ticker:** no proxy found and no `api/charts/<SYM>.json` yet (the fetcher writes it after the options pass)
