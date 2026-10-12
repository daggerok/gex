# GEX [![CI](https://github.com/daggerok/gex/actions/workflows/ci.yaml/badge.svg)](https://github.com/daggerok/gex/actions/workflows/ci.yaml)

A single-page **options board** with English and Russian interface: enter a ticker, get expirations, select one or more dates, and view the classic **Calls | Strike | Puts** chain with bid / mid / ask, IV, volume, open interest and greeks where the provider supplies them. Two more tabs show **GEX** (gamma exposure by strike with key levels) and a price **Chart** with the same levels. The app is a static React + TypeScript + Tailwind CSS v4 site built by Parcel and deployable to GitHub Pages.

We use **Bun** for JavaScript and TypeScript, including the data fetcher. Always use `bun` instead of `npm`.

---

## Table of contents

- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [How to use](#how-to-use)
- [Tabs: Desk, GEX, Chart](#tabs-desk-gex-chart)
- [Data providers](#data-providers)
- [Ticker suggestions](#ticker-suggestions)
- [Static-cache greeks](#static-cache-greeks)
- [Updating the data](#updating-the-data)
- [Deploy to GitHub Pages](#deploy-to-github-pages)
- [Proxy setup for GitHub Pages](#proxy-setup-for-github-pages)
- [Companion infrastructure](#companion-infrastructure)
- [Development](#development)
- [Project structure](#project-structure)
- [Privacy and keys](#privacy-and-keys)
- [Troubleshooting](#troubleshooting)

---

## What you get

- **Two-step, quota-friendly loading:** nothing fetches on page open. Type or search a ticker, then **Expirations**; select expiration(s), then **Load**
- **Ticker suggestions:** searchable ticker and company combobox for every provider. Local static suggestions use `api/options/index.json` names and mark known valid tickers without options as **`(no options)`**. The empty field hints at the main indices, ETFs and mega caps
- **Multiple expirations:** select one, many, or all expirations. Chains render stacked earliest to latest with sticky expiration headers
- **Desk UX:** ATM row highlight, sticky Calls / Strike / Puts headers, greeks columns enabled by default, per-side and per-column desk settings, empty cells for missing data, themed scrollbars, collapse and expand controls, and automatic centering on the current strike after load or expand
- **GEX and Chart tabs:** key levels (Max Net GEX, Min Net GEX, Net GEX+, Net GEX-, 75% Sum Net GEX+ and -, Gamma Flip, Max Pain, Spot, and Max AG, the strike with the largest absolute gamma, while the AG metric is on) computed once and drawn on both tabs, plus your own custom levels
- **Theme UX:** compact current-theme icon with an animated dropdown for the other themes
- **Internationalization:** English and Russian UI with a language switcher in the header and in Settings
- **Provider setup badges:** No setup, Free key, Needs proxy, plus onboarding when a token is required
- **Local browser state:** provider, theme, language, tokens, proxy URL, last ticker, desk columns, custom levels and the query cache are stored only in the browser (`localStorage` and IndexedDB)

## Quick start

This project uses **Bun** for installs and scripts and **Parcel** for the React and TypeScript build.

```bash
git clone https://github.com/daggerok/gex.git
cd gex
bun install -E
bun run serve
```

Open the localhost URL printed by Parcel. Add `?debug=true` to the URL for verbose console logging.

Production build:

```bash
bun run build
```

GitHub Pages build, with the correct `/gex/` public URL:

```bash
bun run build-github-pages
```

## How to use

1. Pick a provider in the top-bar **API** dropdown
2. Type a ticker or company name, pick a suggestion if useful
3. Press **Expirations** to fetch expirations and spot metadata
4. Select one or more expirations, or **All**
5. Press **Load** to render the chain

Dropdown order is always **CACHE, CBOE, NASDAQ, YAHOO**. Default selection only: `localhost` or a private LAN gives **CBOE**; GitHub Pages or any hosted static site gives **CACHE**

## Tabs: Desk, GEX, Chart

- **Desk:** the options chain described above
- **GEX:** gamma exposure by strike with toggleable and colorable Key Levels, a Levels table and a Values table (what each level means on its own strike), zoom and pan on the strike axis (remembered for each ticker, the last 200 tickers, also after a reload)
- **Chart:** daily candles (1 year loaded, the 1M / 3M / 6M / 1Y buttons next to the symbol in the top left corner of the chart only change the visible part; above the chart the same Metrics and Levels panels as on the GEX tab, in the same place) with the same GEX levels as price lines. From the CACHE provider it reads `api/charts/<SYM>.json`, so it works without a proxy

### Custom levels

You can add your own named levels on the **Chart** tab and on the **GEX** tab. They are stored per symbol in `localStorage` and show on both tabs as labelled lines on the charts and as chips of the Levels panel. They are not rows of the Levels and Values tables (on purpose, to keep those tables simple)

- **How to click:** a right click with the mouse. On a MacBook trackpad it is a **two-finger click** (or a two-finger tap when tapping is on in System Settings), the browser sends the same event as for a right click. **Ctrl+click** works on macOS too. Not over the plot (on an axis, outside the chart), the browser's own menu opens as usual
- **Add:** click where you want the level. The level goes on the **nearest strike**, never between two (on the GEX tab it is the strike under the pointer, on the Chart tab the strike nearest to the clicked price). A field opens at the pointer with the default name already selected: `Buyside` when the level is above the current price, `Sellside` when below it (`Buyside 2`, `Buyside 3`... when taken, each side counted apart), `Level 1`, `Level 2`... only when it is exactly at the price. Enter or the check button saves. Esc, the crossed-out pencil button or a click away cancels and creates nothing
- **Edit:** click the same strike again (Chart tab: right click on the line). The same editor opens with its name, with save, cancel and a delete (X) button
- **Move (Chart tab):** drag a custom line with the left mouse button, it follows the strikes and the new price is saved on drop
- **Colour:** one small square left of the name. A level above the current price starts reddish (premium), one below it greenish (discount), one at it or with no price known a neutral colour, the shade picked at random among those the other levels do not use. Click the square to choose another (ready colours or any colour of your own), the editor stays otherwise minimal. The square on the level's chip in the Levels panel changes it later
- **Show or hide:** the same **Levels panel** (the row of chips above the chart) is on the GEX tab and on the Chart tab and shares its choices: click a chip to show or hide that level (yours come first, then the built-in levels from the lowest price to the highest), click the square on it to change its colour. The Expirations panel next to the tabs is also on all three tabs
- **Remove:** the delete button in the editor
- The editor buttons sit in a row above the field, right-aligned on Windows and Linux, left-aligned on macOS and iOS
- The "?" buttons of both tabs explain this too (in the corners of the GEX chart, next to the ticker on the Chart tab)
- Custom levels are plain prices on a strike, they take no part in the GEX math

## Data providers

Only four sources. Short uppercase labels in the API dropdown.

| UI label | Setup | Coverage | Greeks | Notes |
|---|---|---|---|---|
| **CACHE** *(default on GitHub Pages)* | No setup | Cached tickers in `api/options/*.json` | CBOE and model-enriched as files refresh | Same-origin static JSON from GitHub Actions (Yahoo + CBOE delayed 1st-order greeks). Model and higher-order greeks are computed in the browser. No CORS, no keys |
| **CBOE** *(default on localhost)* | Needs proxy | CBOE delayed options | Yes (provider + client Black-Scholes higher-order) | Richest delayed feed (greeks, IV, OI, spot). Requires Proxy base URL (`/api/cboe`) |
| **NASDAQ** | Needs proxy | NASDAQ option chain | No IV, so no model greeks | Full chain in one call: bid, ask, last, volume, OI. Proxy `/api/nasdaq` |
| **YAHOO** | Needs proxy | Yahoo symbol search and option chains | Client Black-Scholes from IV | Lazy per expiration. Companion proxy handles crumb and cookies (`/api/options`) |

Removed from the live registry: marketdata.app, DoltHub, Tradier, Alpaca, Polygon/Massive, Alpha Vantage and other gated experiments

## Ticker suggestions

- Static and local suggestions come from `api/options/index.json`:
  - `files`: tickers with cached option chains
  - `names`: ticker to company, fund or index display name
  - `no_options`: valid tickers where the latest data scan found no listed options, shown as **`(no options)`**
- YAHOO, NASDAQ and CBOE suggestions use the companion proxy endpoint `/api/search?provider=...&q=...` for provider-native full-text symbol search
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
./scripts/options-data.ts                      # default: only SPX, NDX, DJX, RUT, IWM, NVDA, AAPL, MSFT, AMZN, GOOGL, TSM, META, AVGO, MU, GOOG, SPY, QQQ, DIA
./scripts/options-data.ts all                  # full auto-universe run (everything)
TICKERS="AAPL MSFT" ./scripts/options-data.ts  # only these tickers, wins over the default set and over all
TICKERS=AAPL,MSFT MAX_FETCHES=2 ./scripts/options-data.ts
CONCURRENCY=3 TICKERS=AAPL,MSFT,NVDA ./scripts/options-data.ts
```

- Without arguments the run covers only the default set: the main indices and their ETFs (S&P 500, Nasdaq 100, Dow Jones, Russell 2000) and the mega caps, exactly the tickers the empty ticker search field hints (`DEFAULT_SYMBOLS`, a unit test keeps the two lists equal). Pass `all` for the smart auto-universe run: missing symbols first, then the oldest cached files. Any other argument is an error
- SPY, SPX, QQQ and NDX are always queued first
- Every cache file carries `date`, the trading day its data belongs to (market time, before 9:30 and on weekends it is still the previous weekday). The **last run of the trading day** (New York time 16:30 or later, `HISTORY=1` in the workflow) writes the files of the default set into the zip of that day, `api/history/<YYYY-MM>/<YYYY-MM-DD>.zip` (entries `<day>/<SYM>.json` and `<day>/manifest.json`, the last state of the day), and `api/history/index.json` lists the days and tickers. Running again with the same files changes nothing. A day whose last run did not happen has no zip (the sources only give the current chain, a missed day cannot be fetched later). The daily zips of the last 14 days are kept (`HISTORY_KEEP_DAYS`, default 14, `0` = keep all), older ones are deleted by that same run; backups made on demand rotate the same way (`HISTORY_KEEP_BACKUP_DAYS`, default 14, by the date in their id, repository variables `HISTORY_KEEP_DAYS` and `HISTORY_KEEP_BACKUP_DAYS` override, `0` keeps forever). `HISTORY` is off by default (a local run does not write archives). The zips are deployed with the site (about 2 MB a day). Holidays are not known, a holiday run keeps the weekday label
- **Backtest backups (on demand).** `bun run backtest:backup` copies the cache files into one zip, `api/history/<YYYY-MM>/<YYYY-MM-DD-HH-mm>.zip` (New York time, to the minute), and never overwrites: run it as often as you like, also for the same date, and every backup stays. With no arguments it backs up the preset of required tickers (`src/default-tickers.ts`, the same 18 the partial refresh keeps fresh, one without a file is left out), with `all` all available data, with tickers (`bun run backtest:backup SPY NDX`, space or comma separated) only those; a ticker without a file is an error. The backup is a byte for byte copy of the files at that moment. In CI: the **Backtest backup** workflow (Actions tab, run by hand) takes `tickers` (empty = the preset of required tickers, `all` = all data) and `refresh` (fetch fresh data first, for those tickers or the preset); the hourly default refresh also makes a backup when the repository variable `BACKTEST_TICKERS` is set (`all` or a list like `SPY NDX`), off by default because a backup of everything every hour adds tens of MB per hour. A day's automatic end-of-day archive is `YYYY-MM-DD.zip`, a backup is `YYYY-MM-DD-HH-mm.zip`, they live side by side. Size: a ticker file is 0.1 to 3 MB, about 7 times less zipped
- **Backtest in the app ("As of").** One selector in the top bar, for all three tabs. Grey = not a backtest: "As of today" while a live provider answers, otherwise "As of <date>" (the newest cache file, `api/latest.json`). Pick "Latest" (not a backtest) or an archived day or backup (the ones on the site from `api/history/index.json`, plus the ones held in this browser) and the amber banner "Backtest: as of ..." shows: Desk, GEX and Chart read that snapshot (chain, spot, expirations, levels computed from it, model greeks valued on that day, Chart candles cut after that day), live providers are off, a ticker that is not in the archive shows an error, **Back to live** returns. The menu also has **Import zip** (a day zip, a backup or a bundle, read in the browser, nothing is uploaded), **Create backup** (the preset of required tickers is the default, the choice of the last backup is remembered, `Current ticker`, `All available data` and chosen tickers are the other options, Enter downloads `<id>.zip`, the same file the CI backup makes plus your custom levels as `custom-levels.json`, also kept in the browser) and **Backtest data** (list of what the browser holds with size and source, download one or several as ONE zip, remove selected, everything older than a date, or all). A snapshot's custom levels replace yours and are read-only while it is open. Held days stay in IndexedDB until you remove them and work offline
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
4. The **Update partial options data** workflow runs `scripts/options-data.ts` with no arguments (only the default set, with `KEEP_EXPIRATIONS=1` and `MAX_EXPIRATIONS=15`) every hour on weekdays at 9:45, 10:45, ..., 16:45 New York time (8 runs a day, 4 tickers at a time, about 20 s of fetching). **It does not commit the hourly data**: each run builds the site from the fresh files and deploys it to GitHub Pages itself (its `deploy` job), so the repository does not grow by about 2 MB a run. Only the last run of the day commits: the day's archive zip and `api/latest.json` (and a backtest backup, from the run that made it). Any other deploy (`github-pages.yml`, a code push or the weekly full refresh) refreshes the default tickers before building, so the site never shows the older committed files. GitHub cron is UTC only, so both the summer and the winter UTC hours are scheduled and a step skips the one that does not match New York time. Scheduled runs can start a few minutes late. Market holidays are not skipped. It can also be started by hand from the Actions tab
5. The **GitHub Pages** workflow builds the app with `bun run build-github-pages` and deploys `dist/`

## Proxy setup for GitHub Pages

When using GitHub Pages (or any static host), proxy-backed providers (Yahoo, NASDAQ, CBOE) require a **locally running proxy** because the browser cannot call these APIs directly (CORS).

### How it works

1. Your browser loads the app from GitHub Pages (for example `https://daggerok.github.io/gex/`)
2. When you select a proxy-backed provider, the app sends requests to the **Proxy base URL** (default `http://localhost:8787`)
3. The proxy on your machine forwards the requests to Yahoo, NASDAQ or CBOE and returns the response
4. This works because the browser can reach `localhost` even when the page is served from GitHub Pages

### Running the local proxy

```bash
git clone https://github.com/daggerok/gex.git
cd gex
bun install -E
bun ./scripts/options-local-proxy.ts
```

The proxy starts on `http://localhost:8787` by default.

### Configuring the app

1. Open the app, click the **gear icon** (Settings) in the top-right corner
2. Set the **Proxy base URL** field to `http://localhost:8787` (or your custom port)
3. Now the Yahoo, NASDAQ and CBOE providers work

### Alternative: Cloudflare Worker

For a deployable proxy without a local setup: deploy `scripts/options-cloudflare-proxy.js` to Cloudflare Workers and set the **Proxy base URL** to your Worker URL (for example `https://your-worker.your-subdomain.workers.dev`)

### Proxy troubleshooting

- **"Could not reach the proxy":** make sure the proxy is running (`bun ./scripts/options-local-proxy.ts`)
- **CORS errors:** the proxy must run on `localhost` or be deployed as a Cloudflare Worker
- **Port conflicts:** change the port in `scripts/options-local-proxy.ts` or use the `PORT` environment variable

## Companion infrastructure

Optional files outside the core app source:

- `scripts/options-data.ts`: the fetcher (see [Updating the data](#updating-the-data)). Builds and refreshes `api/options/*.json`, attaches Cboe delayed **1st-order** greeks only (model greeks are UI-only), maintains `api/options/index.json` with `{ files, count, names, no_options }` and writes `api/charts/<SYM>.json`
- `.github/workflows/update-data.yml`: weekly refresh (Saturday 10:00 UTC) of all tickers of `api/All.txt` and `api/Indices.txt`, also manual
- `.github/workflows/update-partial-data.yml`: hourly refresh of the default set on weekdays during market hours
- `scripts/options-local-proxy.ts`: local **Bun** proxy serving:
  - `/api/options`: Yahoo optionChain with crumb and cookie handling
  - `/api/nasdaq`: NASDAQ option-chain relay
  - `/api/cboe`: CBOE delayed-options relay
  - `/api/search?provider=yahoo|nasdaq|cboe&q=...`: provider-native suggestions
- `scripts/options-cloudflare-proxy.js`: deployable Worker with the same provider endpoints plus `/raw?url=...` generic CORS passthrough

## Development

Stack: React 19, TypeScript, Tailwind CSS v4, Lucide React, Recharts, lightweight-charts (Chart tab), Parcel 2, Bun, GitHub Pages.

```bash
bun i -E            # install dependencies
bun run start       # app together with the local proxy (pm2 under the hood)
bun run stop ; bun run kill ; bun run ps ; bun run start ; sleep 3 ; bun run logs   # rebuild cycle
```

### Tests

- **Unit tests:** `bun test` runs every `src/*.test.ts`
- **Browser (e2e) tests:** `bun run test:e2e` runs `src/*.e2e.ts` in headless Chromium through Playwright (needs `bunx playwright install chromium` once). `src/e2e-site.ts` builds the app into a temp folder and serves it with the SPY data
- `src/layout.e2e.ts` guards the page layout at three window sizes: no page scroll on any tab (only the Desk table, the GEX sidebar and the Cursor list scroll inside), the footer pressed to the bottom, no empty space above it, one footer design on all tabs. Its error message lists what is wrong, what was expected and measured, and which files to look at
- Naming: unit tests are `*.test.ts`, e2e are `*.e2e.ts`, never the other way, so `bun test` does not run browsers
- CI (`.github/workflows/ci.yaml`, pull requests only) runs the unit tests, the e2e tests, `bun build` of the fetcher, `node --check` of the Worker and both builds. `main` is built and deployed by `github-pages.yml`

### Pre-PR checks

1. Unit tests pass: `bun test`
2. Browser tests pass: `bun run test:e2e`
3. The project builds: `bun run build`
4. The fetcher bundles: `bun build --target=bun scripts/options-data.ts --outfile=/dev/null`
5. The Cloudflare Worker is valid: `node --check scripts/options-cloudflare-proxy.js`
6. No secrets, no leftover debug logs, no changed files in `api/` that you did not mean to commit

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
  components/                 # TopBar, TabSwitcher, SettingsPanel, ChainTable, switches, onboarding, icons
  views/                      # DeskView, GexView, ChartView
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
  options-local-proxy.ts      # local Bun proxy: Yahoo, NASDAQ, CBOE, search
  options-cloudflare-proxy.js # Cloudflare Worker proxy: Yahoo, NASDAQ, CBOE, search, raw
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
- For public deployments without a local proxy use **CACHE**; for live data run the proxy (or Worker) and pick CBOE, YAHOO or NASDAQ

## Troubleshooting

- **Nothing loads on open:** expected. Press **Expirations**, then **Load**
- **Needs proxy or CORS errors:** start `bun ./scripts/options-local-proxy.ts` locally or set a Cloudflare Worker URL in Settings, Proxy base URL
- **`Unexpected token '<'`:** a proxy or server returned HTML instead of JSON. Check the proxy URL and the provider
- **CACHE says not cached:** the ticker is absent from `api/options/*.json`. Use another provider, or run the fetcher for it (`TICKERS=XYZ ./scripts/options-data.ts`)
- **`(no options)` suggestion:** the ticker is valid in the local manifest, but the latest data scan found no listed options
- **Proxy connection refused:** make sure the proxy is running and the Proxy base URL is set correctly in Settings
- **Chart tab empty for a ticker:** it has no `api/charts/<SYM>.json` yet (the fetcher writes it after the options pass) and no proxy is set
