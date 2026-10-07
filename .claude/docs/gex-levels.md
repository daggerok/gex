# How every GEX level is calculated, and what backs it

Code: `src/gex.ts` (pure functions), called once through `src/use-gex-levels.ts`. Types: `GexPoint`, `GexLevels` in `src/types.ts`

## Source status at a glance

| Level | Sourced? |
|---|---|
| GEX per contract, sign convention | Public convention (SpotGamma-style), a model approximation |
| Call Wall, Put Wall | Max / min per-strike netGex, standard definition |
| Resistance 2, Support 2 | NO - original heuristic (direction rule plus distance threshold), no public standard exists |
| Gamma Flip | Yes - SpotGamma "Zero Gamma" docs and ZeroGEX, quoted below |
| Absolute Gamma | Yes - SpotGamma support docs, quoted below |
| Max Pain | Standard, uncontested formula |
| Put/Call ratio | Plain ratio of sums |

## GEX per contract and per strike

```
gexCall(gamma, OI, spot) = gamma * OI * 100 * spot^2 * 0.01
gexPut(...)              = -gexCall(...)
callGex(strike) = sum gexCall over calls at that strike (across selected expirations)
putGex(strike)  = sum gexPut  over puts at that strike
netGex          = callGex + putGex
absGamma        = callGex - putGex      (= |callGex| + |putGex|)
```

- Convention: calls contribute positive gamma exposure, puts negative, weighted by raw open interest. It is not a buy/sell-classified customer position, because trade direction is not public data
- Plan section 7 intro names the sources for this convention: spotgamma.com's own explanation, the open-source repo FlashAlpha-lab/gex-explained, and an independent calculator at flashalpha.com, all describing the same convention
- Plan section 17 item 3: it was not reverse-engineered against any commercial product, so expect the same ballpark as other public tools, not an exact match
- Quotes with null gamma are excluded. NASDAQ has no greeks, so those quotes get Black-Scholes greeks from `enrichQuoteWithModelGreeks` first
- Per-quote reference price is `q.forward ?? spot`, `forward` is only set for VIX/VXN (see `architecture.md`)

## Call Wall and Put Wall (Resistance 1 / Support 1)

- `callWall` = strike with the maximum `netGex` among strikes where `netGex > 0`, null if none
- `putWall` = strike with the minimum (most negative) `netGex` among strikes where `netGex < 0`, null if none
- Ties resolve to the lowest strike

## Resistance 2 and Support 2 (UNSOURCED)

`findCallPutWalls(profile, spot, minDistance)` in `src/gex.ts`:

- `callWall2` = among strikes with `netGex > 0` that are ABOVE `callWall` by at least `minDistance`, the one with the highest `netGex`. Null if none qualify or `callWall` is null
- `putWall2` = among strikes with `netGex < 0` that are BELOW `putWall` by at least `minDistance`, the most negative. Null if none qualify
- `minDistance` comes from `secondWallMinDistance(symbol, spot)`: the per-symbol rule in `SECOND_WALL_DISTANCE_BY_SYMBOL` if present (`{ usd: 3 }` is a flat price, `{ pct: 0.004 }` is a fraction of spot), otherwise `SECOND_WALL_MIN_DISTANCE_PCT * spot` with `SECOND_WALL_MIN_DISTANCE_PCT = 0.02`. Symbol lookup is case-insensitive
- Current overrides: `SPY: { usd: 3 }`. SPX and everything else use the 2% default
- To tune a symbol, add one row to `SECOND_WALL_DISTANCE_BY_SYMBOL`, nothing else changes. The comparison is `>=`, so a strike exactly `minDistance` away qualifies

There are no citations. The repo says so in four places:

- Original implementation plan (now `spec-gex-app.md`, original text in git history) section 7.4: "this 2%-of-spot distance rule for 'wall 2' is an ORIGINAL, UNSOURCED heuristic (no public standard exists for a 'second wall')"
- same plan, section 17 item 6: "has NO public source - it does not exist as a standard concept anywhere researched. It is this plan's own invented tie-break rule so the behavior is at least deterministic and documented"
- `src/gex.ts` doc comment on the constant (the per-symbol mapping is just as unsourced, it only lets the user tune the heuristic): "ORIGINAL, UNSOURCED heuristic: no public standard for a 'second wall' exists"
- UI tooltips `gex.level.tooltip.resistance2` / `support2` in `src/i18n.tsx`: "this app's own heuristic, not an industry standard - treat it as a rough secondary marker, not a precise level"

Known weakness: a fixed 2% behaves very differently on $1 strike spacing (SPY) than on $2.50 or $5 spacing (small caps), which is why the per-symbol mapping exists. The default is still meant to be tuned once seen on real chains

`spot` for the distance rule: the true spot, except for VIX/VXN where `useGexLevels` passes the nearest selected expiration's forward (strikes live in futures-space there)

## Gamma Flip (Zero Gamma)

`findGammaFlipHypotheticalSpot(quotes, spot)` in `src/gex.ts`. Definition: the hypothetical underlying price S* at which, if every option's gamma were recomputed with Black-Scholes as if spot were S*, aggregate dollar-GEX over the whole chain is zero

Citations, as quoted in the code:

- ZeroGEX, "Gamma Flip Calculation: Before vs After": "A simple cumulative sum treating each contract's gamma as fixed is wrong more often than it looks because gamma depends on where spot is. The better approach re-prices the whole book at each candidate spot price and computes modeled net dealer gamma as if spot were there"
- SpotGamma support docs, "Zero Gamma": "To estimate Zero Gamma, SpotGamma recalculates option gamma over a range of hypothetical spot prices, aggregates the position-signed exposure at each price, and locates the modeled crossover through zero"
- ZeroGEX again: "One implementation evaluates total dealer GEX at 60 different hypothetical price levels spanning +/-20% of current spot, recalculating every option's gamma using Black-Scholes at each level"

Algorithm:

1. Keep eligible quotes: no `forward` (not futures-priced) and `iv >= GAMMA_FLIP_MIN_IV` (0.05)
2. Sweep `GAMMA_FLIP_GRID_POINTS = 60` prices evenly across `spot * (1 +/- GAMMA_FLIP_RANGE_PCT)` with `GAMMA_FLIP_RANGE_PCT = 0.20`
3. At each S recompute every quote's gamma with `blackScholesGreeks(quote, S)`, keeping the quote's own `iv`, convert with `gexCall` / `gexPut` using S as the spot, sum over all selected expirations
4. Scan the totals for sign changes. `pos` = last negative -> positive crossing, `neg` = last positive -> negative crossing. Linear interpolation between the two flanking grid points is correct here because S is a continuous price axis
5. `computeGexLevels` collapses to the single `gammaFlip`: `gammaFlipPos` if `totalNetGex > 0`, else `gammaFlipNeg`. `GexLevels` still carries `gammaFlipPos` and `gammaFlipNeg`, the UI shows only the collapsed `gammaFlip`

Known simplifications: the sweep uses default `BS_RISK_FREE_RATE` and zero dividend yield, not the per-index yield used at enrichment (no `symbol` parameter). Minor for SPX-family. Not validated against a third party's published flip for the same moment (plan section 17 item 4), expect the same neighborhood only

Why the IV floor exists: see `decisions.md` entry "IV floor for the gamma flip sweep"

## Absolute Gamma (AG)

`absGamma = |callGex| + |putGex|`, total gamma mass at a strike with no call/put cancellation. Citation in the `GexPoint.absGamma` doc comment: "SpotGamma adds the absolute value of put gamma to the absolute value of call gamma" - SpotGamma support docs, "Absolute Gamma" (support.spotgamma.com). It is a chart metric with its own secondary axis, not a Key Level

## Max Pain

For each distinct strike S in the quotes:

```
payout(S) = sum over calls: callOI(K) * max(0, S - K)
          + sum over puts:  putOI(K)  * max(0, K - S)
```

`maxPain` is the S minimizing payout, ties to the lowest strike, null only for an empty chain. Uses open interest only, null OI counts as 0

## Put/Call ratio

`byOi = sum(putOi) / sum(callOi)`, `byVolume = sum(putVolume) / sum(callVolume)`, each null when the denominator is 0

## Explicitly not implemented

- HVL / Vol Trigger: proprietary heuristics from third-party tools, no public formula
- The unlabeled "AG" toggle in the original reference screenshots: meaning never confirmed (the shipped Absolute Gamma metric is a separately sourced definition, not a decode of that toggle)
