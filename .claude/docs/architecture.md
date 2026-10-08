# Architecture

## Layout

```
src/
  main.tsx            app shell: settings, loaded chain, selected expirations, active tab
  types.ts            OptionQuote, ChainResult, GexPoint, GexLevels, OhlcBar, ...
  i18n.tsx            en / ru dictionaries, I18nProvider
  settings-store.ts   settings + localStorage cache helpers
  greeks.ts           Black-Scholes, model-greek enrichment, per-index dividend yields,
                      FUTURES_PRICED_SYMBOLS (VIX, VXN)
  vix-pricing.ts      Black-76, implied forward, enrichment for futures-priced symbols
  gex.ts              ALL GEX math, pure (see gex-levels.md)
  use-gex-levels.ts   the one hook that calls computeGexLevels, shared by both tabs
  gex-colors.ts       one color per level, shared by GEX and Chart tabs
  providers/          cache, cboe, nasdaq, yahoo, loader, index (fixed order), chart (OHLC)
  views/              DeskView, GexView (recharts), ChartView (lightweight-charts)
  components/         TopBar, TabSwitcher, ExpirationChips, ChainTable, AttributionFooter, ...
scripts/
  options-data.py              yfinance fetch + CBOE 1st-order greeks overlay -> data/options/*.json
  options-data.ts              Bun port of the same fetcher (raw Yahoo calls, no deps), byte-identical output, see spec-ts-fetcher.md
  options-parity/              temporary py vs ts parity harness, deleted together with options-data.py
  options-local-proxy.ts       local relay (bun)
  options-cloudflare-proxy.js  hosted relay (Worker)
data/options/*.json            committed cache, about 330 tickers
```

## Data flow

1. TopBar picks ticker and provider (CACHE, CBOE, NASDAQ, YAHOO). Default is CACHE on GitHub Pages and CBOE on localhost
2. A provider returns a `ChainResult`. `enrichChainResult` fills missing greeks via Black-Scholes (and Black-76 for VIX/VXN when `vixFuturesPricing` is on)
3. The user selects expirations. The selected slice is the only input to GEX math
4. `useGexLevels(...)` runs once in the app shell and returns `{ quotes, spot, levels, ... }`. Both GexView and ChartView read it, so the tabs always show the same numbers
5. Switching tabs never refetches the chain. Only the Chart tab fetches new data (OHLC from the Yahoo chart endpoint through the proxy), so it needs a running proxy, there is no cached OHLC

If the app spot is missing, `estimateSpot` derives one from put-call parity on the nearest selected expiration, and the UI marks it as estimated

## Greeks

- 1st order: from CBOE in the fetch script, or computed in the UI
- 2nd and 3rd order and lambda: computed only client-side in `src/greeks.ts` (`HIGHER_ORDER_GREEK_KEYS`)
- The fetchers (`scripts/options-data.py` and `scripts/options-data.ts`) must never compute greeks, GEX, flip, walls or max pain (rule R1)

## Index and futures-priced symbols

- Index symbols (SPX, XSP, NDX, DJX, RUT) get a per-index dividend yield from `INDEX_DIVIDEND_YIELDS`, SPX is 0.011. Each provider spells the symbol differently, the routing table is in `spec-index-options.md` section 6
- VIX and VXN options are priced off futures, not spot. With the `vixFuturesPricing` setting on, each expiration gets its own implied forward (`impliedForward`) and Black-76 greeks, stored as `OptionQuote.forward`. GEX math uses `q.forward ?? spot` per quote. If no selected quote resolves a forward, `levels` is null and the UI explains why. Evidence, formulas and the forward rule: `spec-vix-futures.md`

## Testing

- `bun test`, tests sit next to sources (`gex.test.ts`, `greeks.test.ts`, `vix-pricing.test.ts`, `use-gex-levels.test.ts`, `providers/*.test.ts`, ...)
- GEX tests use small synthetic chains whose walls and flips can be derived by hand
- CI (`.github/workflows/ci.yaml`): `bun run test`, py_compile, `node --check` on the Worker, `bun run build`, `bun run build-github-pages`, runs on pull requests (and manual dispatch) only, main is built and deployed by `github-pages.yml`. `npm-check-updates.yml` is a separate manual workflow

## Licensing

lightweight-charts is Apache-2.0 and requires attribution plus a link to tradingview.com. The footer (`AttributionFooter`) shows it on the Chart tab and a GitHub link elsewhere. Plan section 17 item 5: the wording is a paraphrase, not the literal NOTICE text, verify before relying on it
