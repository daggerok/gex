# GEX app spec (the "implementation plan")

Condensed from the original implementation plan (file gex-implementation-plan.txt in the old .plans folder, 2026-09-27, deleted from the repo, recoverable from git history). It is all implemented. Section numbers are kept because code comments cite them as "plan section N". Formulas live in `gex-levels.md`, the current file layout in `architecture.md`

## 2. Product scope

Three tabs share one loaded chain (`meta`, `expData`, `selectedExps` in app state), switching tabs never refetches the chain

- Desk: the original Calls | Strike | Puts table, unchanged
- GEX: sidebar (OI Volume, GEX Analysis, Key Levels, P/C Ratio) plus a bar chart by strike
- Chart: candlesticks of the underlying with the same levels as horizontal price lines. Only this tab fetches new data (OHLC)

TopBar (ticker, provider, theme, language, settings) is rendered once above the tabs

## 4. File layout

A deliberate split of the original 5,000-line `main.tsx` into modules (Phase 0, zero behavior change, own PR). Current layout is in `architecture.md`. The pattern to repeat for any big refactor: mechanical extraction first with `bun test` and `bun run build` green, features after

## 5. Shared types

`GexPoint`, `GexLevels` and `OhlcBar` live in `src/types.ts`. `GexPoint` gained `absGamma`, `GexLevels` gained `gammaFlipPos` / `gammaFlipNeg` since the original plan. `OhlcBar.time` is unix seconds, UTC midnight for daily bars

## 6. Data sources

### 6.1 CBOE delayed options JSON

`https://cdn.cboe.com/api/global/delayed_quotes/options/{symbol}.json`. Equities as-is, cash indices with a leading underscore (`_SPX`, `_VIX`, ...). Shape: `data.current_price` (spot, `close` fallback) and `data.options[]` with `option` (OCC symbol), `bid`, `ask`, `last_trade_price`, `volume`, `open_interest`, `iv`, `delta`, `gamma`, `theta`, `vega`, `rho`. Read from three places in the repo that agree (proxy, provider, Python fetcher). Quotes already carry `openInterest` and `gamma`, so the GEX tab needs no new fetch. Unchecked edge: whether CBOE omits gamma entirely for very illiquid far-OTM contracts, the nullable parser covers it

### 6.2 CACHE files

`data/options/*.json` already hold OI and gamma from the CBOE overlay, GEX math is identical for CACHE and live CBOE because it only reads `OptionQuote[]`

### 6.3 OHLC for the Chart tab

`https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=6mo`, no crumb or cookie session needed, relayed by both proxies as `GET /api/chart?symbol=&range=&interval=`. Parse rule: zip `timestamp[i]` with `quote[0].open/high/low/close/volume[i]`, skip indices where `close` is null. Observed shapes (200, 404 for bad symbol or bare `SPX`, 400, 429 as HTML) and the daily-bar timestamp normalization are documented in the header of `src/providers/chart.ts`. Without a running proxy (hosted Pages) the tab fails with the same "needs proxy" message the live providers use. A CBOE historical-bars fallback was only ever a hypothesis

## 7. GEX math

Spec per function, formulas and sources in `gex-levels.md`:

- 7.1 per-contract GEX (null gamma excluded) - 7.2 profile per strike - 7.3 gamma flip (rewritten, see `decisions.md`) - 7.4 walls and second walls - 7.5 max pain - 7.6 put/call ratios - 7.7 `computeGexLevels` wrapper, the one function views reach through `useGexLevels`
- 7.8 not implemented: HVL / Vol Trigger (proprietary, unsourced), the unlabeled "AG" toggle from the reference screenshots

## 8. UI

### 8.1 GEX tab

- Sidebar: OI Volume card (total call and put OI), GEX Analysis card (Total Net GEX formatted like `+2.14B $/1%`, Regime label: Positive gamma if total > 0, Negative if < 0, Neutral if 0 or data missing), Key Levels card, P/C Ratio card (by OI, by volume). Stacks above the chart on narrow screens
- Level colors identical to the Chart tab: Max Net GEX and Resistance green family, Min Net GEX and Support red family, Gamma Flip purple, Max Pain amber. Source of truth is `src/gex-colors.ts`
- Expiration chips reuse the Desk component, All/None toggle. Default selection on this tab is the nearest single expiration, because GEX concentrates in near-dated options and an all-expirations default is noisy
- Metric toggles: Net GEX (default), Absolute Gamma, Call OI, Put OI, Call Volume, Put Volume. Net GEX is signed, the others unsigned
- Chart: recharts `BarChart`, x axis is strike, reference lines for spot and enabled key levels, drag to zoom, axes trimmed to the real data range (`trimZeroBoundaries`, display only)

### 8.2 Chart tab

- Range selector 1M / 3M / 6M (default) / 1Y mapped to Yahoo `range`, interval fixed at `1d`
- lightweight-charts candlesticks, one `createPriceLine` per non-null level from the shared `GexLevels` (never recomputed in the view). Keep the returned handles in a ref and `.remove()` them before redrawing, otherwise stale lines pile up
- Attribution footer (below, section 15)

## 9. Charting libraries

recharts for the categorical strike-axis bars (already a dependency), lightweight-charts only for time-series candles and price lines (new dependency, Chart tab only). Deliberately two libraries for two jobs

## 11. Testing

`gex.test.ts` uses a small hand-built `OptionQuote[]` fixture where walls, flip and max pain are derivable by arithmetic. Required cases: normal, all-same-sign gamma (flip null), single vs multiple expirations, null gamma excluded not zero. Manual smoke for the Chart tab: run the proxy and dev server (`bun run start`), open Chart for SPY, confirm candles render and every non-null level line sits near the visible price range, not off-screen or NaN

## 15. Licensing

lightweight-charts is Apache-2.0: an attribution notice plus a link to https://www.tradingview.com/ must be available on every page, implemented as an app-wide footer (`AttributionFooter`), now shown on the Chart tab with a GitHub link elsewhere

## Out of scope (decided, do not build unasked)

HVL / Vol Trigger, historical tracking of levels, intraday OHLC, a CACHE-like embedded OHLC for Pages (needs the R3 schema sign-off), watchlists, alerts, a fifth provider

## 17. Limitations and unverified items

1. The Yahoo chart endpoint URL and shape were confirmed by secondary sources, then observed live on 2026-10-04 (see `chart.ts` header). `chart.error` handling exists
2. CBOE schema is high confidence, read from the repo's own working code
3. The GEX convention is the common public one, a model approximation, not reverse-engineered against any commercial product, so numbers match other tools only in the same ballpark
4. Gamma flip was never compared with a third-party published value for the same day
5. The lightweight-charts attribution wording is a paraphrase, the literal NOTICE text was not fetched
6. The "second wall" distance rule has no public source, see `gex-levels.md`
7. `.github/workflows` were checked by filename originally, `ci.yaml` has since been read (see `architecture.md`)
8. The "ask before touching `data/options` schema or workflows" rule is carried over from the old options-desk AGENT.md as rules R3 and R4 and was never reconfirmed by the user for gex specifically, treat it as in force
9. A CBOE historical-bars fallback for OHLC was never verified
