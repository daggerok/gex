# Using gex

How to run the app the four ways, what each tab shows and how its controls work. Back to the [README](../README.md)

## Contents

- [Four ways to use it](#four-ways-to-use-it)
- [Where the data comes from](#where-the-data-comes-from)
- [Typical tasks](#typical-tasks)
- [Tabs](#tabs)
- [Metrics and Levels panels](#metrics-and-levels-panels)
- [Custom levels](#custom-levels)
- [Backtest (As of)](#backtest-as-of)
- [Full screen and touch](#full-screen-and-touch)

## Four ways to use it

### 1. The published site (cached data)

1. Open https://daggerok.github.io/gex/
2. Type a ticker (or a company name and pick a suggestion), press Enter
3. The data is the cache published with the site: the 27 default tickers (indices, their ETFs, mega caps) are refreshed every hour on weekdays, about 3,000 other tickers once a week (each within about 6 weeks). The source label says `CACHE <date>`, amber when that day is not today

Nothing is installed, nothing leaves your browser

### 2. Local with the proxy (live data)

```bash
git clone https://github.com/daggerok/gex.git && cd gex
bun install -E
bun run all              # app http://localhost:1234 + proxy http://localhost:8787, Ctrl+C stops both
```

Open http://localhost:1234: the app finds the proxy by itself and loads each ticker live from CBOE, else YAHOO, else NASDAQ, else the cache. The label says `LIVE CBOE` (or the provider that answered). `bun run start` does the same in the background under pm2

To use your proxy from the published site instead: start it (`bun run proxy`), turn on **Auto** in the top bar (on the published site that is the consent to contact your computer, remembered in this browser) and allow the browser's prompt for local network access (Chrome). When the proxy does not answer, Settings and the `CACHE` tooltip say: your local proxy did not answer, or Chrome blocked this site from reaching your computer; start `bun run proxy`, and in the address bar's site settings allow Local network access. Safari blocks `http://localhost` from an https page, there the published site stays on the cache

### 3. Local with your own cache

```bash
bun install -E
./scripts/options-data.ts                         # the 27 default tickers
TICKERS="PLTR HOOD" ./scripts/options-data.ts     # plus your tickers
bun run app                                       # the app reads your fresh api/
```

Without a running proxy the app uses this cache by itself; with one, choose Settings -> Data source -> Advanced -> **Always cache**. More options in [Automations: the data fetcher](automations.md#the-data-fetcher-scriptsoptions-datats)

### 4. Local with your TradingView account (futures /ES, /NQ, /YM, /RTY, live)

- Gives GEX, levels and the Board for the CME index futures options `/ES`, `/NQ`, `/YM`, `/RTY` (and the micros) from your own TradingView account with CME data, refreshed while it runs
- Needs the local proxy running on your computer and a TradingView session imported once from Chrome into `~/.config/gex/tradingview.env` (mode 600, outside the repository, never committed or shared)
- `bun run all` (or `bun run proxy`) runs the TradingView live mode: the page shows `LIVE TV hh:mm:ss` and updates in place every second or two; without the proxy `/ES` reads its file. Full guide: [README, Local proxy and TradingView live mode](../README.md#local-proxy-and-tradingview-live-mode)

## Where the data comes from

- **Auto (default):** the app asks the proxy's `/health`. Found -> per ticker CBOE, YAHOO, NASDAQ, then the cache; not found -> the cache, never an error
- **Auto** (the switch in the top bar between As of and the source label, the same setting as Settings -> Data source -> Proxy auto-discovery) is the only proxy control: on, the proxy is looked for at once, every 30 s and when you come back to the tab, live while it answers and the cache as soon as it stops, the open ticker reloads from the new source; off, the proxy is never contacted and all data comes from the cache. On by default in the app served from this machine, off on the published site. Settings shows the read-only line `Local proxy: in use (...)`, `not in use (Auto is off)` or `not found (Auto is on, checking every 30 s)` where the old **Use my local proxy** button was
- **Advanced:** fix the source (**Always cache**, which works like Auto off and is kept only as an advanced override, or one provider only, which applies while Auto is on) and change the proxy URL
- The Chart tab follows the same result: candles through the proxy when live, else the cached `api/charts/<SYM>.json`
- The source label next to the ticker: `LIVE <provider>`, `CACHE <date>` or `ARCHIVE <day>` (an As of day is open). On `CACHE` its tooltip says why live is off: Always cache is set, Auto is off, Chrome blocked local network access, the proxy did not answer or Chrome may have blocked it (published site, network error), or the proxy did not answer on the last check

All settings and what the browser remembers: [Configuration](configuration.md)

## Typical tasks

- **Load a ticker:** type it, or a company name and pick from the suggestions (the cache's names, plus the providers' own search when the proxy is found; `(no options)` marks a valid ticker without listed options), press Enter or the search button. Enter always fetches the ticker again from the source; the expirations and spot load, the nearest expiration is selected
- **Pick expirations:** click the chips in the Expirations panel next to the tabs, each loads by itself; **All** selects every one (then the button says **None**), **Reset** goes back to the nearest one. The arrows on the faded edges scroll the chip row. Each chip shows its share of the open interest; all tabs use the same selection. A switch to another ticker keeps the same dates where it can
- **Read the levels:** GEX tab: the Levels table in the sidebar lists every shown level with its strike, the Values table beside it (open it with its button) shows each metric at that strike; hover a level chip for what it means. Chart tab: the same levels as price lines on the candles. Board: the level strikes are marked in the table
- **Add a custom level:** right click (two-finger click on a trackpad, Ctrl+click on macOS, long press on a touch screen) on the GEX or Chart plot, type a name, Enter. Details below
- **Switch to live:** start `bun run proxy` with **Auto** on in the top bar (on the published site turning it on also allows the site to contact your computer); the label goes live within 30 s or when you come back to the tab
- **Settings menu holds everything of the top bar** (owner 2026-10-26, useful on a phone where some top bar items are hidden): theme and language at the top, then Data source (Auto first, the source label as a read-only line), then Backtest (As of), then the Desk columns and the rest
- **See how old the data is:** the source label (`CACHE 2026-10-23`), the Desk toolbar (`as of <date time> ET`) and an amber age badge in the Expirations panel when the data is from an earlier day
- **Keep the published data fresh (owner):** the hourly data slots run on your Mac. Once: `bun run data:setup`. Then now and then `bun run data:status` (last run per job, next run, last data commit) and `bun run data:logs -n 200` when something says failed; details in [Automations](automations.md#local-data-runner-bun-run-data)
- **Reset the look:** **Reset** in the Metrics panel (metrics, their colours, the Net GEX / Abs GEX switch) and in the Levels panel (level selection, colours, the Zero GEX and Sigma switches)

## Tabs

- **Desk:** the classic Calls | Strike | Puts chain with bid, mid, ask, IV, volume, OI and greeks (columns per side in Settings -> Desk columns), one section per selected expiration with sticky headers, collapse and expand all or one section, the ATM row in the Spot colour and centered after a load or an expand, a strip of scroll marks right of the scrollbar (each expiration bar, the ATM row, the peak and runner-up rows; click a mark to bring its row to the middle)
- **Board:** one row per strike of the selected expirations: Net GEX, Abs GEX, notional delta, OI and volume (total, call, put), P/C ratios and each strike's share of the Abs GEX ([definitions](levels.md#board-columns)). A blue dot marks each column's peak and its runner-up; a peak row is tinted by its Net GEX sign (a runner-up only its cell); the ATM row has the Spot colour and opens in the middle. The Metrics chips choose the columns, the Levels chips mark their strikes. The scroll marks strip shows only the tinted rows and the ATM row
- **GEX:** gamma exposure by strike (Net GEX bars, or with the switch in the Net GEX chip call GEX up and put GEX down), the AG line with a ring at every strike, the other metrics as lines, the levels as vertical lines with labels. The sidebar: totals (Total Net GEX and its regime, total AG, OI, volume, P/C), the Cursor card (values under the pointer), the Levels and Values tables. Zoom and pan on the strike axis (buttons, wheel, drag, keys; remembered per ticker)
- **Chart:** daily candles (bull and bear in the Net GEX (+) and (-) colours) with the same levels as price lines; Sigma lines start right of the last candle. Range buttons 1M, 3M, 6M (default), 1Y and All only change the visible part (1 year is loaded; All asks the proxy for 10 years); the crosshair snaps to the open, high, low or close when the pointer is close to one

## Metrics and Levels panels

The same two chip rows sit above every tab and share their state. On the Desk the Levels panel is greyed out (levels are not shown there, its choices still apply on the other tabs) and the Metrics chips choose which Board columns give the peaks and runner-ups of the Desk scroll marks

- **Metrics:** Net GEX (with the Net GEX / Abs GEX switch and the (+) and (-) colour squares), AG, call and put OI, call and put volume, P/C by OI and by volume. Click a chip to show or hide it (at least one stays on), click its colour square to change the colour. Default: Net GEX and AG, remembered in the browser
- **Levels:** your custom levels first (by price), then the built-in levels from the lowest price to the highest. Click a chip to show or hide it, the square changes its colour. The Zero GEX chip has a line / area switch, the Sigma chip a % / σ switch. Max AG has a chip only while the AG metric is on. The level selection, the colours and the two switches are remembered in the browser; Reset brings the defaults back

What each level means: [How the numbers are computed](levels.md#levels)

## Custom levels

Your own named levels on the GEX and Chart tabs, stored per symbol in the browser, shown on both tabs as labelled lines and as chips of the Levels panel (not as rows of the Levels and Values tables, on purpose). They are plain prices on a strike and take no part in the GEX math

- **Add:** right click in the plot (MacBook trackpad: two-finger click, or tap with tapping on; Ctrl+click on macOS; touch: hold one finger still for half a second). The level goes on the nearest strike. A field opens at the pointer with a default name selected: `Buyside` above the current price, `Sellside` below it (`Buyside 2`, ... when taken), `Level 1`, `Level 2` ... exactly at it. Enter or the check button saves; Esc, the crossed-out pencil or a click away cancels
- **Edit:** click the same strike again (Chart tab: right click the line): the editor opens with save, cancel and delete (X)
- **Move (Chart tab):** drag the line with the left button, it snaps to strikes and saves on drop
- **Colour:** the square left of the name; a new level starts green above the price, red below, neutral at it, a shade the other levels do not use. The square on its chip changes it later
- **Show or hide:** its chip in the Levels panel
- The editor buttons are right-aligned on Windows and Linux, left-aligned on macOS and iOS. The "?" buttons on both tabs repeat this help

## Backtest (As of)

One selector in the top bar for every tab

- Grey = not a backtest: "As of today" while a live provider answers, otherwise "As of <date>" (the newest cache day, `api/latest.json`). So a grey "As of 2026-10-23" means the page found no live source (see the source label's tooltip for why), not that a past day is selected
- Pick an archived day or a backup (those on the site from `api/history/index.json`, plus those held in this browser): an amber "Backtest: as of ..." banner shows, and every tab reads that snapshot (chain, spot, expirations, levels, model greeks valued at that time, Chart candles cut after that day). Live providers are off, also with the local proxy running; a ticker that is not in the snapshot shows an error. The source label says `ARCHIVE <day>`; a click on it or **Back to latest** in the banner returns. The selection is not remembered: every page load starts at today
- **Import zip:** a day zip, a backup or a bundle, read in the browser, nothing is uploaded
- **Create backup:** the default tickers (default), the current ticker, all available data or chosen tickers; Enter downloads `<id>.zip`, the same format the CI backup makes plus your custom levels (`custom-levels.json`), and keeps it in the browser. The last choice is remembered
- **Backtest data:** what the browser holds with size and source; download one or several as one zip, remove selected, everything older than a date, or all. Held snapshots stay in IndexedDB and work offline
- A snapshot's custom levels replace yours and are read-only while it is open
- How the archive is made: [Automations: archive and backups](automations.md#archive-and-backups-apihistory)

## Full screen and touch

- **Full screen:** the expand button on the chart card (left of the zoom buttons on the GEX tab, at the end of the range panel on the Chart tab) or the **F** key (not while typing) shows the chart over the whole window; the same button, **F** or **Esc** brings it back. Zoom, keys, ranges and the level editor work there too
- **Touch:** on the GEX and Chart tabs a long press opens the custom level editor; on the GEX tab two fingers pinch to zoom around their middle and one finger drags the zoomed chart sideways (a vertical drag still scrolls the page)
