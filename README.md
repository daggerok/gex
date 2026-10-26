# GEX [![CI](https://github.com/daggerok/gex/actions/workflows/ci.yaml/badge.svg)](https://github.com/daggerok/gex/actions/workflows/ci.yaml)

A single-page **options board** with English and Russian interface: enter a ticker, select one or more expirations, and view the classic **Calls | Strike | Puts** chain with bid / mid / ask, IV, volume, open interest and greeks. More tabs show a per-strike **Board**, **GEX** (gamma exposure by strike with key levels) and a price **Chart** with the same levels. The app is a static React + TypeScript + Tailwind CSS v4 site built by Parcel and published on GitHub Pages (https://daggerok.github.io/gex/). Data comes live through a small local proxy when it runs on your computer, otherwise from the cache published with the site.

We use **Bun** for JavaScript and TypeScript, including the data fetcher. Always use `bun` instead of `npm`.

---

## Table of contents

- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [Documentation](#documentation)
- [How to use](#how-to-use)
- [Data sources](#data-sources)
- [Local proxy and TradingView live mode](#local-proxy-and-tradingview-live-mode)
- [Ticker suggestions](#ticker-suggestions)
- [Static-cache greeks](#static-cache-greeks)
- [Updating the data](#updating-the-data)
- [Deploy to GitHub Pages](#deploy-to-github-pages)
- [Companion infrastructure](#companion-infrastructure)
- [Automations](#automations)
- [Development](#development)
- [Project structure](#project-structure)
- [Privacy and keys](#privacy-and-keys)
- [Troubleshooting](#troubleshooting)

---

## What you get

- **Quota-friendly loading:** nothing fetches on page open except the ticker you had open last time. Type or pick a ticker and press Enter: its expirations load (the nearest one is selected); every expiration you select loads by itself
- **Automatic data source:** with the local proxy running you get live data (CBOE, else YAHOO, else NASDAQ, else the cache, per ticker), without it the cache published with the site. A label next to the ticker says which: `LIVE CBOE`, `LIVE YAHOO`, `CACHE 2026-10-23`. See [Local proxy and TradingView live mode](#local-proxy-and-tradingview-live-mode)
- **Ticker suggestions:** searchable ticker and company combobox. Local static suggestions use `api/options/index.json` names and mark known valid tickers without options as **`(no options)`**. The empty field hints at the main indices, ETFs and mega caps
- **Multiple expirations:** select one, many, or all expirations. Chains render stacked earliest to latest with sticky expiration headers
- **Desk UX:** ATM row highlight, sticky Calls / Strike / Puts headers, greeks columns enabled by default, per-side and per-column desk settings, empty cells for missing data, themed scrollbars, collapse and expand controls, and automatic centering on the current strike after load or expand
- **GEX and Chart tabs:** key levels (Max Net GEX, Min Net GEX, Net GEX+, Net GEX-, 75% Sum Net GEX+ and -, Gamma Flip, Zero GEX, Max Pain, Spot, Max AG, the strike with the largest absolute gamma, while the AG metric is on, and Sigma, off until you turn it on) computed once and drawn on both tabs, plus your own custom levels. Zero GEX is the owner's own rule (from the Max Net GEX strike walking down to the Min Net GEX strike, or from Min Net GEX walking up to Max Net GEX when the total is negative; each step into the other sign is a candidate zone, with several the one with the highest average absolute gamma of its two strikes wins; the line is the zone's strike of the other sign), a switch in its chip draws it as a line or as the band between the two strikes. Sigma marks the strikes nearest to spot +/- 1, 2, 3 %, or with the switch in its chip +/- 1, 2, 3 statistical sigma (spot x ATM IV x sqrt(days / 365) of the nearest selected expiration); grey dotted lines, on the Chart tab from the next day to the right edge
- **Themes:** light and dark (sun / moon button in the header) and two colour palettes in Settings
- **Internationalization:** English and Russian UI with a language switcher in the header and in Settings
- **Local browser state:** data source settings, theme, language, proxy URL, last ticker and expirations, active tab, desk columns, metric choices, metric and level colours, the chip switches, custom levels, chart zoom and the query cache are stored only in the browser (`localStorage` and IndexedDB), see [Configuration](docs/configuration.md#what-the-browser-remembers)

## Quick start

This project uses **Bun** for installs and scripts and **Parcel** for the React and TypeScript build.

```bash
git clone https://github.com/daggerok/gex.git
cd gex
bun install -E
bun run all          # the app (Parcel, http://localhost:1234) and the local proxy (http://localhost:8787) together, Ctrl+C stops both
```

Open http://localhost:1234. Add `?debug=true` to the URL for verbose console logging.

### Run commands

| Command | Starts | Ports |
|---------|--------|-------|
| `bun run all` | the app and the local proxy, in the foreground (Ctrl+C stops both) | 1234 and 8787 |
| `bun run app` | only the app (without the proxy it shows the cache) | 1234 |
| `bun run proxy` | only the local proxy, with the TradingView live mode for the futures (see [Local proxy and TradingView live mode](#local-proxy-and-tradingview-live-mode)) | 8787 |
| `bun run start` | the same as `all`, in the background under pm2 (`bun run ps`, `bun run logs`, `bun run restart`, `bun run stop` manage it) | 1234 and 8787 |

Ports: `APP_PORT` moves the app, `PORT` moves the proxy (`APP_PORT=3000 PORT=9000 bun run all`; a moved proxy also needs its URL in Settings -> Advanced). Each command first checks its ports (`scripts/check-ports.ts`) and starts nothing when one is taken; `all` and `start` check both before either starts. It names the port and the process holding it, and exits with 1:

```text
$ bun run all
Port 8787 (proxy) is already in use:
  pid 34804: bun ./scripts/options-local-proxy.ts
  stop that process, or start on another port: PORT=<port> bun run proxy
Nothing was started (bun run all).
error: script "all" exited with code 1
```

Data runner on your Mac (the hourly data slots, see [Automations](docs/automations.md#local-data-runner-bun-run-data)):

| Command | Does |
|---------|------|
| `bun run data:setup` | first time and repair: checks, runner worktree, launchd schedule, dry check, status |
| `bun run data:status` | schedule, next and last run per job, the state folder (absolute path), last data commit, lock, log size |
| `bun run data:logs` | follows `../gex-data-state/gex-data.log` (the folder next to `gex/`, `-n 200`: the last lines) |
| `bun run data:run <job>` | runs `partial`, `weekly`, `backup [tickers]` or `deps` now with live output (`--dry-run`: nothing fetched or committed) |
| `bun run data:pause` / `data:resume` / `data:uninstall` | stop, restart or remove the schedule |
| `bun run data:help` | the list |

Production build:

```bash
bun run build
```

GitHub Pages build, with the correct `/gex/` public URL:

```bash
bun run build-github-pages
```

## Documentation

| Page | What is in it |
|---|---|
| [docs/usage.md](docs/usage.md) | the three ways to run it (published site, local with the proxy, your own cache), typical tasks, every tab and panel, custom levels, the As of backtest, full screen and touch |
| [docs/levels.md](docs/levels.md) | how every number is computed: time to expiration, greeks, the GEX formula and dealer convention, every level (sourced or our own rule), the Gamma Flip IV repair and coverage gate, Board columns, expiration selection |
| [docs/configuration.md](docs/configuration.md) | the data source rules, the Settings panel, every `localStorage` key and IndexedDB store with its default, environment variables, workflow settings, ports |
| [docs/automations.md](docs/automations.md) | every GitHub Actions workflow (schedule, steps, what it commits or deploys, duration, what to do when it fails), the local data runner (`bun run data:*`, launchd, troubleshooting), the data fetcher and all its variables, the archive, data sizes, local run commands, tests |

## How to use

1. Type a ticker or company name, pick a suggestion if useful, press Enter (or the search button): the expirations and the spot load, the nearest expiration is selected
2. Select more expirations in the Expirations panel next to the tabs (**All** selects every one and then reads **None**, **Reset** goes back to the nearest one): each loads by itself
3. Switch between the **Desk** (the chain), **Board** (one row per strike), **GEX** (gamma exposure by strike with the levels) and **Chart** (daily candles with the same levels) tabs, they all use the same selection
4. Add your own levels with a right click (two-finger click on a trackpad) on the GEX or Chart plot

Four ways to run it: the published site (cache), local with the proxy (live), local with your own cache, and local with your TradingView account for the futures `/ES`, `/NQ`, `/YM`, `/RTY` (needs the local proxy and a TradingView session imported from Chrome, full guide in [Local proxy and TradingView live mode](#local-proxy-and-tradingview-live-mode)), see [docs/usage.md](docs/usage.md#four-ways-to-use-it)

The source label next to the ticker shows where the data came from (`LIVE CBOE`, `CACHE 2026-10-23`, amber when the cached day is old). The data source is chosen automatically, see [Local proxy and TradingView live mode](#local-proxy-and-tradingview-live-mode). Every tab, panel and control in detail: [docs/usage.md](docs/usage.md)

## Data sources

Four providers, no provider menu: the app picks the source by itself (`src/proxy-discovery.ts`).

| Provider | Needs | Coverage | Greeks | Notes |
|---|---|---|---|---|
| **CACHE** | Nothing | Cached tickers in `api/options/*.json` | Cboe delayed 1st-order, model-enriched in the browser | Same-origin static JSON refreshed by GitHub Actions. Used when no local proxy is found, and as the last fallback |
| **CBOE** | Local proxy | CBOE delayed options, equities and indices | Yes (provider + client Black-Scholes higher-order) | First choice with the proxy: greeks, IV, OI, spot (`/api/cboe`) |
| **YAHOO** | Local proxy | Yahoo option chains | Client Black-Scholes from IV | Second choice. Lazy per expiration, the proxy handles crumb and cookies (`/api/options`) |
| **NASDAQ** | Local proxy | NASDAQ option chain | No IV, so no model greeks | Third choice. Full chain in one call: bid, ask, last, volume, OI (`/api/nasdaq`) |

With the proxy found each ticker tries CBOE, then YAHOO, then NASDAQ, then CACHE, and the first that knows the ticker serves it. Settings -> Data source -> **Advanced** can fix the source: **Always cache** (never even looks for the proxy) or one provider only (`CBOE only`, `YAHOO only`, `NASDAQ only`). Removed long ago: marketdata.app, DoltHub, Tradier, Alpaca, Polygon/Massive, Alpha Vantage and other gated experiments

## Local proxy and TradingView live mode

The browser cannot call Cboe, Yahoo, NASDAQ or TradingView directly (no CORS, cookies, a websocket), so live data goes through a small Bun proxy on your own computer, `scripts/options-local-proxy.ts`. The same process runs the **TradingView live mode** for the index futures options (`/ES`, `/NQ`, `/YM`, `/RTY`). Without the proxy the app shows the cache published with the site.

### What runs where

```text
 your computer                                                                 internet
 ┌──────────────────────────────────────────────────────────┐
 │ browser: the app (http://localhost:1234 or GitHub Pages)  │
 │   options tickers ── GET /api/cboe, /api/options ...  ─┐  │
 │   /ES, /NQ ...    ── GET /api/futures/live?root=ES ──┐ │  │
 └──────────────────────────────────────────────────────┼─┼──┘
 ┌──────────────────────────────────────────────────────┼─┼──┐
 │ bun run proxy (127.0.0.1:8787, one process)          │ │  │
 │   relays ───────────────────────────────────────────────┴──┼──> Cboe, Yahoo, NASDAQ
 │   TradingView live mode (scripts/tv/live.ts)         │    │
 │     session: ~/.config/gex/tradingview.env (600)     │    │
 │              or imported from Chrome by itself       │    │
 │     1 websocket, quote sessions of <= 3,000 options ─┼────┼──> data.tradingview.com (bid, ask, OI, volume)
 │     scanner every minute ────────────────────────────┼────┼──> scanner.tradingview.com (greeks)
 │     server-sent events to the page <─────────────────┘    │
 │     api/futures/<ROOT>.json rewritten on change (15 s)     │
 └────────────────────────────────────────────────────────────┘
```

### Commands

| Command | What it does |
|---------|--------------|
| `bun run all` | the app (http://localhost:1234) and the proxy (http://localhost:8787) with the TradingView live mode, in the foreground; Ctrl+C stops both |
| `bun run proxy` | only the proxy, with the TradingView live mode (`GEX_TV=0 bun run proxy` leaves the live mode off) |
| `bun run app` | only the app (no proxy: the cache) |
| `bun run start` | the same as `all` under pm2 in the background; `bun run ps`, `bun run logs`, `bun run restart`, `bun run stop` |
| `bun run tv:session` | imports the TradingView session cookie from Chrome into `~/.config/gex/tradingview.env` (`--probe` lists the Chrome profiles, `--dry-run` writes nothing, `--prompt` asks for the value instead) |
| `bun run tv:check` | checks the session: one status line (below) |
| `bun run tv:futures --once` | writes `api/futures/<ROOT>.json` once and exits, for publishing (`--once ES` one root, `--micros` adds MES, MNQ, MYM, M2K) |
| `bun run tv:futures` | the files only, without the proxy: keeps running and rewrites them every minute (`--watch 2m`, `--refresh 10m` change the intervals) |

Ports: `APP_PORT` moves the app, `PORT` the proxy; each command checks its ports first and starts nothing when one is taken (it names the process holding it)

### First-time setup

1. `bun install -E`
2. Log in to https://www.tradingview.com in **Chrome** (the account needs CME data for realtime futures options; without it quotes are 10 minutes delayed)
3. `bun run tv:session`: reads the session cookie of the Chrome profile that used TradingView last. macOS asks once to allow access to the Keychain item "Chrome Safe Storage" (click **Always Allow**); the value is written to `~/.config/gex/tradingview.env` (mode 600) and never printed. You can skip this step: the proxy imports the session by itself when the file is missing
4. `bun run tv:check` must print `ok`
5. `bun run all`, open http://localhost:1234, enter **`/ES`** (or `ES1!`, `/NQ`, `/YM`, `/RTY`, `/MES`...). A plain `ES` stays the Eversource Energy stock. Right after the start the label says `TV starting… ES 1/4` for up to 3 minutes (the proxy subscribes about 11,800 options); it turns `LIVE TV hh:mm:ss` by itself

### The source label next to the ticker

| Label | Meaning |
|-------|---------|
| `LIVE CBOE`, `LIVE YAHOO`, `LIVE NASDAQ` | an options ticker loaded through the proxy from that provider |
| `CACHE 2026-10-23` | an options ticker from the cache published with the site, of that trading day (amber when it is not today's) |
| `CACHE 2026-10-25 21:40` | a futures ticker from its file `api/futures/<ROOT>.json`, written at that New York time (no proxy, or before the live stream sent its first snapshot) |
| `TV starting… ES 1/4` | the live mode is still subscribing after the proxy started (ES, NQ, YM, RTY one after the other; measured 1.5 to 3 minutes for all four, ES alone about 80 s): the file is shown meanwhile and the page switches to live by itself, no reload |
| `LIVE TV 10:05:07` | a futures ticker in the TradingView live mode: the time (New York) of the last update, it changes every few seconds while the market moves; the Desk header says the same (`as of 2026-10-26 10:05:07 ET · LIVE TV`) |
| `TV 15m delayed 10:05:07` | a stock or index (SPY, SPX, NVDA...) through the TradingView hybrid: OPRA option quotes 15 minutes late, greeks from TradingView's scanner, open interest from Cboe; the time of the last update (New York). Before TradingView delivers, or when it cannot, the provider's own label stays (`LIVE CBOE`) |
| `TV LOGIN` | the live mode has no valid session: log in to tradingview.com in Chrome, the proxy picks it up within 3 minutes (or run `bun run tv:session`); the last file is shown meanwhile |
| `TV PAUSED` | TradingView answered 429 or 403: no requests for 15 minutes, then 30, 60, at most 120 if it repeats; it resumes by itself |
| `TV RECONNECTING` | the websocket dropped (network, sleep): the proxy reconnects by itself (5 s, doubling to 5 min) and subscribes everything again |
| `TV ERROR` | anything else; the tooltip has the message and the proxy retries |

The tooltip of the label says the same in full sentences (English and Russian)

### What the TradingView live mode does

- **Session:** the proxy reads `~/.config/gex/tradingview.env` on every token request (so a new `tv:session` needs no restart). Missing or rejected -> it imports the session from Chrome by itself, but only once per new Chrome login (it compares a hash of the encrypted Chrome cookie, so the Keychain dialog shows at most once), and looks again every 3 minutes. The 4-hour auth token is renewed 15 minutes before it expires and sent on the open websocket
- **Data:** one websocket to TradingView, one or more quote sessions per future (at most 3,000 options each: ES about 5,600 options in 2 sessions, NQ about 4,900 in 2, YM and RTY one each), every expiration up to and including the nearest monthly, strikes within ±6% of the forward. Bid, ask, last, volume and open interest arrive as TradingView pushes them. The scanner (TradingView's own IV and greeks) is read once a minute per future
- **Greeks:** the websocket carries no IV or greeks, so the app prices every option with a two-sided quote itself, Black-76 on its expiration's put-call parity forward (`src/vix-pricing.ts` `liveFuturesGreeks`); options without a two-sided quote keep TradingView's scanner greeks, which also serve as a cross-check
- **To the page:** server-sent events: the whole chain once (a snapshot), then only the changed options every 500 ms. The page applies them in place, keeps the tab, the expirations and the scroll position, and recalculates the levels at most once a second (slower when one update is heavy: it keeps itself under 5% of a CPU core); the Chart tab fetches its candles again every minute
- **Files:** `api/futures/<ROOT>.json` (and `dist/api/futures/` when `dist/api` exists) are rewritten every 15 s when something changed, so a reload, `bun run app` or the published site after a commit show the latest state
- **Without the stream** (no proxy, an older proxy, `GEX_TV=0`): the futures ticker reads its file once per load, as before

Measured on 2026-10-25 (Sunday evening session, ES, MacBook): proxy with the live mode of 4 futures about 2% of one CPU core and 200 MB; the browser tab with one ES expiration 3.8% of a core (an update takes about 15 ms from the event to the redrawn Desk), with all 20 ES expirations 8% (about 115 ms per update, paced to every 2 s); the standalone `tv:futures` about 0.8% of a core and 125 MB

### Stocks and indices (TradingView hybrid)

With the proxy running and a TradingView session, a stock or index ticker that loaded live from CBOE (or NASDAQ) switches to a TradingView stream of its options once it delivers (under a minute for SPY, about 2 minutes for SPX), label `TV 15m delayed hh:mm:ss`:

- **What comes from where:** bid, ask, last and volume from TradingView's OPRA feed, **15 minutes delayed** without an OPRA subscription (`delayed_streaming_900`); IV and greeks from TradingView's scanner every 45 s (the websocket has none); open interest from **Cboe** (TradingView keeps each contract's OI of the last day it changed, often weeks old and 9-30% low; where Cboe has no value TradingView's is used, with its day in the tooltip of the Desk OI cell); spot = the put-call parity forward of the options, so it matches their 15-minute delay
- **Window:** expirations within 42 days, strikes within ±6% (SPX about 7,000 options in 3 quote sessions, SPY about 2,400); the window follows the price every 5 minutes
- **Limits:** on demand only (the stream starts when a page opens the ticker and stops 2 minutes after the last page leaves), at most 2 tickers at once, each its own websocket; scanner 429 / 403 back off 15 minutes and more
- **Never stored:** OPRA data is for personal use: the proxy keeps it in memory only, never writes it to `api/` or any file, nothing is committed or published
- `GET /api/tv/live?symbol=SPY` (the same events as the futures stream) and `GET /api/tv/status` (the running feeds); `GEX_TV=0` turns it off together with the futures live mode
- Measured (SPX, 7,002 options, Sunday night GTH session): browser tab 2.6% of a CPU core, about 25 ms per update

### CME open interest cross-check

CME publishes, free on its anonymous FTP, the preliminary open interest of every option **product** and side once a day (`ftp://ftp.cmegroup.com/daily_volume/daily_volume_YYYYMMDD.xlsx`, about 100 KB, posted about 03:30 Chicago time the next morning). The TradingView root of a futures option is the CME product code (`E4A`, `EW3`, `ES`, `QN4`, `R4E`...), so the proxy compares the two:

- The proxy downloads the newest file when it is missing (on start and when a page opens a futures ticker; while it is not posted yet, at most once an hour) into `api/futures/cme/` (gitignored, never published) and serves the totals at `GET /api/futures/cme-oi`; the xlsx is read with built-ins (zip + XML), no extra package
- The tooltip of the source label adds a line like `CME open interest of 2026-10-22 (preliminary, per product): the TradingView window holds 28% of it (EW3 put 10%, EW put 29%, ...)`. The window holds only the strikes within ±6% and the expirations through the monthly, while CME counts every strike and every listed expiration of the product, so the share is the window's coverage, not an error: per strike TradingView equals the CME Daily Bulletin (checked on 880 ES calls of 2026-10-23)
- Only the FTP is used: www.cmegroup.com forbids scripts in its terms and blocks non-browser clients, the proxy never contacts it

### What auto-discovery does

- The app asks `{proxy URL}/health` (default `http://localhost:8787`, 500 ms timeout). Found -> live data: each options ticker tries **CBOE -> YAHOO -> NASDAQ -> cache**, a futures ticker subscribes to the live stream. Not found -> the cache, never an error
- **Proxy auto-discovery** (the **Auto** switch in the top bar, the same switch as Settings -> Data source, default **off**): off, the proxy is looked for **once when the page loads**, so after you start or stop it, refresh the page. On, it is looked for every 30 s and whenever you come back to the tab, and the data switches between live and cache by itself
- **Settings -> Data source -> Advanced:** the manual override (**Auto**, **Always cache**, or one provider only) and the **proxy URL**. Always cache never contacts the proxy, also when it runs, and turns the live mode off in the page
- The **Chart tab** follows the same result: candles through the proxy (`/api/chart`, futures as `ES=F` from Yahoo) when the source is live, otherwise the cached `api/charts/<SYM>.json`

### On GitHub Pages

The published site (https://daggerok.github.io/gex/) never contacts your computer by itself: Chrome 142+ asks every visitor for permission to access the local network as soon as a site calls `localhost`. To use your proxy (and the live mode) from the published site:

1. Start the proxy (`bun run proxy`)
2. Turn on **Auto** in the top bar (or Settings -> Data source -> **Use my local proxy**). On the published site Auto on is the same consent: it turns Use my local proxy on too, and **Stop using my local proxy** turns Auto off. Remembered in this browser
3. Allow Chrome's prompt to access devices on your local network. If you blocked it, Settings and the `CACHE` tooltip say "Chrome blocked access to your computer": allow Local network access for the site in the address bar site settings

The proxy answers browsers only for pages served from `localhost` or `127.0.0.1` (any port) and from `https://daggerok.github.io` (allowlist in `scripts/proxy-cors.ts`, any other page gets 403), and answers Chrome's private network preflight only for those. **Safari is not supported** here (it blocks `http://localhost` from an https page): use the local app (`bun run all`)

### Publishing the futures files

The published site cannot run the live mode for visitors; it shows the futures files as of the last commit:

```bash
bun run tv:futures --once          # or let bun run all run a minute: the files are current
git add api/futures && git commit -m "chore(data): refresh futures options" && git push
```

They stay as of that commit until refreshed by hand again (CI has no session and never runs any of this)

### Status lines of tv:check and tv:futures

| Line | What to do |
|------|------------|
| `ok` | nothing |
| `no session -> run bun run tv:session` | the env file has no `TV_SESSIONID`: run `bun run tv:session` (or start the proxy, it imports by itself) |
| `session expired -> run bun run tv:session` | you logged out of TradingView (that ends the session) or it expired: log in to tradingview.com in Chrome, run `bun run tv:session` |
| `Chrome import failed: Keychain access ... failed` | you denied the Keychain dialog: run `bun run tv:session` again and allow, or `bun run tv:session --prompt` and paste the value (DevTools -> Application -> Cookies -> `https://www.tradingview.com` -> `sessionid`) |
| `no CME entitlement (OI empty)` | the account has no options data for CME futures on TradingView |
| `no realtime CME entitlement (10 min delayed)` | OI works, prices are 10 minutes late (no realtime CME subscription) |
| `rate limited` | TradingView answered 429 or 403: wait 15 minutes, do not retry in a loop |
| `Port 8787 (proxy) is already in use` | another proxy runs (maybe from another checkout): stop it, or `PORT=9000 bun run proxy` and set `http://localhost:9000` in Settings -> Advanced |

### Troubleshooting

- `/ES` says its file is missing: the live mode has not written it yet (up to 3 minutes after the proxy starts for all four futures) or the session is missing (`curl http://localhost:8787/api/futures/status`)
- The label stays `CACHE <time>` for `/ES` while the proxy runs: refresh the page (auto-discovery off looks for the proxy only on load), check `curl http://localhost:8787/api/futures/status` says `"state":"live"`; with **Always cache** the live mode is off on purpose
- Debug: `kill -USR2 <pid of bun scripts/tv/futures.ts>` drops the websocket of a standalone `tv:futures` to see the reconnect (`websocket closed`, `reconnecting in 5 s`, `subscribed N options in K quote session(s)`, `reconnected`); `TV_RENEW_EVERY_MS=180000 bun run tv:futures` renews the token every 3 minutes instead of 15 minutes before it expires; `GEX_TV_ENV=<file>` reads another env file (a copy with a wrong value shows the "session expired" message without touching the real one)
- Open interest is the exchange's daily figure and lags one or two sessions. TradingView keeps each contract's OI of the last day it changed (`oi.time`, about 9% of the ES OI is dated before the newest day): checked against the CME Daily Bulletin of 2026-10-23, every value is equal, an older day just means no trade changed it since. The Desk names that day in the tooltip of the OI cell (`OI unchanged since <date>`), the files keep it per option (`oiDate`)

### Security

- The session lives only in `~/.config/gex/tradingview.env` (mode 600) outside the repository; the proxy and the scripts never print it or the auth token (every log line goes through `redact()`), never write it anywhere else, and never send it anywhere but tradingview.com
- Never commit the env file, never paste its value into a chat, an issue or a screenshot
- Logging out of TradingView in the browser invalidates the session: log in again (the proxy imports the new one by itself)
- The proxy listens on `127.0.0.1` only (`HOST=0.0.0.0` exposes it on purpose only); the futures data is for your personal use (CME licence, TradingView terms): keep the request rate human, never in CI

### Build the cache yourself

The cache is the `api/` folder the fetcher writes (`scripts/options-data.ts`, see [Updating the data](#updating-the-data)). Locally:

```bash
./scripts/options-data.ts                          # the default tickers (indices, their ETFs, mega caps)
TICKERS="PLTR HOOD" ./scripts/options-data.ts      # the default tickers plus these
./scripts/options-data.ts all                      # everything (long)
bun run app                                        # the app reads your fresh api/ (choose Always cache to ignore a running proxy)
```

The files change tracked data in `api/`; do not commit them by hand (`git checkout -- api` before a commit), the workflows publish the cache

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
- Every cache file carries `date`, the trading day its data belongs to (market time, before 9:30 and on weekends it is still the previous weekday). The **final runs of the trading day** (any scheduled run from 16:30 to 23:59 New York time, `HISTORY=1` in the workflow) writes the files of the default set into the zip of that day, `api/history/<YYYY-MM>/<YYYY-MM-DD>.zip` (entries `<day>/<SYM>.json` and `<day>/manifest.json`, the last state of the day), and `api/history/index.json` lists the days and tickers. Running again with the same files changes nothing. A day whose last run did not happen has no zip (the sources only give the current chain, a missed day cannot be fetched later). The daily zips of the last 14 days are kept (`HISTORY_KEEP_DAYS`, default 14, `0` = keep all), older ones are deleted by that same run; backups made on demand rotate the same way (`HISTORY_KEEP_BACKUP_DAYS`, default 14, by the date in their id, repository variables `HISTORY_KEEP_DAYS` and `HISTORY_KEEP_BACKUP_DAYS` override, `0` keeps forever). `HISTORY` is off by default (a local run does not write archives). The zips are deployed with the site (about 3.4 MB a day with the 27 default tickers). Holidays are not known, a holiday run keeps the weekday label
- **Backtest backups (on demand).** `bun run backtest:backup` copies the cache files into one zip, `api/history/<YYYY-MM>/<YYYY-MM-DD-HH-mm>.zip` (New York time, to the minute), and never overwrites: run it as often as you like, also for the same date, and every backup stays. With no arguments it backs up the preset of required tickers (`DEFAULT_SYMBOLS` of `scripts/options-data.ts`, the same 27 the partial refresh keeps fresh, one without a file is left out), with `all` all available data, with tickers (`bun run backtest:backup SPY NDX`, space or comma separated) only those; a ticker without a file is an error. The backup is a byte for byte copy of the files at that moment. In CI: the **Backtest backup** workflow (Actions tab, run by hand) takes `tickers` (empty = the preset of required tickers, `all` = all data) and `refresh` (fetch fresh data first, for those tickers or the preset); the hourly default refresh also makes a backup when the repository variable `BACKTEST_TICKERS` is set (`all` or a list like `SPY NDX`), off by default because a backup of everything every hour adds tens of MB per hour. A day's automatic end-of-day archive is `YYYY-MM-DD.zip`, a backup is `YYYY-MM-DD-HH-mm.zip`, they live side by side. Size: a ticker file is 0.1 to 3 MB, about 7 times less zipped
- **Backtest in the app ("As of"):** archived days and backups open in the "As of" selector of the top bar, see [docs/usage.md](docs/usage.md#backtest-as-of)
- **Cleaning up the archive is deleting files.** Drop a month with `rm -r api/history/2026-08`, a single snapshot with `rm api/history/2026-08/2026-08-14-15-42.zip`, then commit and push. `index.json` follows the disk: the next run drops the snapshots that are gone (one still listed whose zip is missing is shown as unavailable in the meantime). Never edit the zips or `index.json` by hand. A ticker whose own file has not been refreshed since that day would be archived into its day again by the next run, which only happens for a ticker that stopped being updated
- `KEEP_EXPIRATIONS=1` (default off) keeps the later expirations that a ticker's file already holds: the nearest `MAX_EXPIRATIONS` dates are fetched again as usual, the rest stay, and only their Cboe greeks, open interest and volume are refreshed (their bid, ask, last and IV stay as of the last run that covered them). Without it a run keeps only the nearest `MAX_EXPIRATIONS` dates
- After the options pass every cached ticker gets `api/charts/<SYM>.json` (1 year of daily bars, about 11 KB each, `CHART_MAX_FETCHES` per run; the weekly `ROTATE_STALE` picks get theirs on top, so every cached ticker has candles within about 6 weeks), so the Chart tab works from CACHE without a proxy. Every run also writes the candles (only the candles) of the Yahoo futures `ES=F`, `NQ=F`, `YM=F`, `RTY=F`, `MES=F`, `MNQ=F`, `MYM=F`, `M2K=F` (`api/charts/ES=F.json`, ...)
- `CONCURRENCY` is an integer >= 1 (default 1), each worker waits `REQUEST_SLEEP` after its own write. Cboe requests share one throttle (`CBOE_MIN_INTERVAL`, default 1 s) and on a 429 every worker pauses (`CBOE_BACKOFF`, `CBOE_RETRIES`), so more workers do not raise the Cboe request rate. A ticker whose Cboe retries run out fails and keeps its old file
- `SOFT_DEADLINE_SECONDS` (default 0, off) stops starting new tickers after that many seconds. `VERBOSE=1` also prints the old timestamped progress lines
- The run prints a `[ config   ]` block, one status line per ticker (`new`, `updated`, `unchanged`, `no-options`, `failed`) and a `[ done     ]` summary
- The full list of tunables (`MAX_FETCHES`, `MAX_EXPIRATIONS`, `UNIVERSE_SIZE`, `SKIP_RECHECK_DAYS` and others) is in the header comment of `scripts/options-data.ts`
- Running the fetcher changes tracked files in `api/`. For a local check discard them before committing (`git checkout -- api`), a commit should contain only the source change

## Deploy to GitHub Pages

1. Enable Pages in repo **Settings, Pages** (source: GitHub Actions)
2. Allow Actions to commit: **Settings, Actions, General, Workflow permissions, Read and write permissions**
3. Every push to `main` deploys through `github-pages.yml`, the data workflows deploy by themselves, see [Automations](#automations)

## Companion infrastructure

Optional files outside the core app source:

- `scripts/options-data.ts`: the fetcher (see [Updating the data](#updating-the-data)). Builds and refreshes `api/options/*.json`, attaches Cboe delayed **1st-order** greeks only (model greeks are UI-only), maintains `api/options/index.json` with `{ files, count, names, no_options, defaults }` and writes `api/charts/<SYM>.json`
- `.github/workflows/*`: see [Automations](#automations)
- `scripts/options-local-proxy.ts`: local **Bun** proxy (`bun run proxy`, see [Local proxy and TradingView live mode](#local-proxy-and-tradingview-live-mode)) serving:
  - `/health`: what the app's auto-discovery asks
  - `/api/options`: Yahoo optionChain with crumb and cookie handling
  - `/api/chart`: Yahoo daily candles for the Chart tab
  - `/api/nasdaq`: NASDAQ option-chain relay
  - `/api/cboe`: CBOE delayed-options relay
  - `/api/search?provider=yahoo|nasdaq|cboe&q=...`: provider-native suggestions
  - `/api/futures/status`, `/api/futures/live?root=ES`, `/api/futures/<ROOT>.json`: the TradingView live mode (`scripts/tv/live.ts`, `GEX_TV=0` turns it off)

## Automations

All of it in detail (steps, env, failure handling, durations, data sizes): [docs/automations.md](docs/automations.md). Times are New York time

| Workflow | When | What | Commits | Deploys |
|---|---|---|---|---|
| `ci.yaml` | every pull request | unit tests, fetcher bundle, both builds, browser tests (jobs `build` and `e2e`), 2.5 to 3.5 min | nothing | no |
| `github-pages.yml` | push to `main` (not archive-only pushes), manual, started by the data and dependency workflows | refreshes the 27 default tickers, builds with `/gex/`, deploys, 1 to 2 min | nothing | yes |
| `update-partial-data.yml` | Mon-Fri 9:45 and 16:45 (the other hourly slots run on the owner's Mac, `bun run data:setup`); manual | refreshes the 27 default tickers, builds and deploys, 1 to 1.5 min | final runs (from 16:30): the day zip and `api/latest.json`; a backup when `BACKTEST_TICKERS` is set | yes |
| `update-data.yml` | Saturday 10:00; manual | the defaults plus `api/All.txt`, the 500 oldest other files (`ROTATE_STALE`), 9 to 14 min | `api/` | starts `github-pages.yml` |
| `backtest-backup.yml` | Saturday 12:00; manual | optional fresh fetch, one backup zip | the zip | no |
| `dependency-updates.yml` | manual | bumps every dependency, tests and builds, pushes to the branch | `package.json`, `bun.lock` | starts `github-pages.yml` |
| `npm-check-updates.yml` | Sunday 10:00; manual | the same bump as a check only | nothing | no |

- **Schedules are best effort:** GitHub drops many scheduled runs and starts others up to hours late, so every run from 16:30 to 23:59 counts as final. Since 2026-10-26 GitHub keeps only rare schedules and the owner's Mac runs every hourly slot (`bun run data:setup`, [local data runner](docs/automations.md#local-data-runner-bun-run-data)). Market holidays are not skipped
- **Hourly data is not committed:** each hourly run builds the site from its fresh files and deploys it; only the day's archive is committed. Every other deploy refreshes the default tickers first, so the site never goes back to older data
- **Default tickers** (27, `DEFAULT_SYMBOLS` in `scripts/options-data.ts`): SPX NDX DJX RUT IWM SPY QQQ DIA NVDA AAPL MSFT AMZN GOOGL TSM GOOG META AVGO LLY MU WMT AMD JPM V BRK-B XOM ASML JNJ. They keep every expiration up to 42 days, the weeklies up to 92 days, the monthlies and quarter-ends up to a year; other tickers their nearest `MAX_EXPIRATIONS`
- **Stale cache rotation:** the weekly run also refreshes the 500 cached tickers outside its list with the oldest data, so all of the about 3,000 files are refreshed within about 6 weeks
- **Futures candles:** every fetcher run also writes the daily candles of `ES=F NQ=F YM=F RTY=F MES=F MNQ=F MYM=F M2K=F` to `api/charts/`
- **Size:** `api/` is about 240 MB and is deployed with the site; GitHub Pages allows 1 GB per site

## Development

Stack: React 19, TypeScript, Tailwind CSS v4, Recharts, lightweight-charts (Chart tab), Parcel 2, Bun, GitHub Pages.

```bash
bun i -E            # install dependencies
bun run all         # app together with the local proxy (see Run commands)
bun run stop ; bun run start ; sleep 3 ; bun run ps ; bun run logs   # pm2 restart cycle (logs keeps following, Ctrl+C)
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
docs/                         # usage, levels, configuration, automations (linked from Documentation above)
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
  vix-pricing.ts              # Black-76 pricing for futures-priced symbols (VIX, VXN) and the live futures greeks from mids
  futures-live.ts             # TradingView live mode in the app: the proxy's stream applied in place
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
  *.e2e.ts, e2e-site.ts       # browser tests and their site helper (e2e-run.ts runs them, bun run test:e2e)
api/
  options/                    # one option-chain cache file per ticker, plus index.json
  charts/                     # one file of 1 year of daily bars per ticker
  history/                    # index.json plus one folder per month, in it one zip per earlier day (last state of the default tickers)
  futures/                    # ES.json, NQ.json, YM.json, RTY.json of the TradingView live mode or bun run tv:futures, committed by hand and published
  All.txt, Indices.txt        # ticker list of the update workflow; cash index list (kept in sync with INDEX_DIVIDEND_YIELDS)
scripts/
  options-data.ts             # the fetcher: Yahoo and Cboe -> api/options and api/charts
  history-archive.ts          # writes the day zip api/history/<month>/<day>.zip (last run of the day), prunes old days, keeps index.json in step with the disk
  backtest-backup.ts          # makes an on-demand backup zip (all data or chosen tickers)
  # src/backtest/: snapshot format, zip reading and writing in the browser, controller (the logic of the As of feature), store (IndexedDB)
  options-local-proxy.ts      # local Bun proxy: health, Yahoo, chart, NASDAQ, CBOE, search
  proxy-cors.ts               # the proxy's CORS allowlist and private network preflight answer
  check-ports.ts              # port pre-check of bun run app, proxy, all, start
  tv/                         # TradingView futures options: tv:session, tv:check, tv:futures and the proxy's live mode (live.ts); on your computer, never in CI
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
- **The label says CACHE although the proxy runs:** with Proxy auto-discovery off the proxy is looked for only when the page loads, refresh the page (or turn auto-discovery on). Check `curl http://localhost:8787/health`, the proxy URL in Settings -> Advanced, and that the override there is **Auto**. On the published site turn on **Auto** (or **Use my local proxy**) first; if Settings says Chrome blocked access, allow Local network access in the address bar site settings
- **403 "origin not allowed" from the proxy:** the page is not served from `localhost` / `127.0.0.1` or `https://daggerok.github.io` (allowlist in `scripts/proxy-cors.ts`)
- **`Unexpected token '<'`:** a proxy or server returned HTML instead of JSON. Check the proxy URL in Settings -> Advanced
- **CACHE says not cached:** the ticker is absent from `api/options/*.json`. Start the local proxy, or run the fetcher for it (`TICKERS=XYZ ./scripts/options-data.ts`)
- **`(no options)` suggestion:** the ticker is valid in the local manifest, but the latest data scan found no listed options
- **Port 1234 or 8787 in use:** the run command names the process holding it. Stop it, or move the app with `APP_PORT=3000` and the proxy with `PORT=9000` (then set `http://localhost:9000` in Settings -> Advanced)
- **Chart tab empty for a ticker:** no proxy found and no `api/charts/<SYM>.json` yet (the fetcher writes it after the options pass)
