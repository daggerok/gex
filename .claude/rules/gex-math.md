---
paths:
  - src/gex.ts
  - src/gex.test.ts
  - src/use-gex-levels.ts
  - src/types.ts
  - src/greeks.ts
  - src/vix-pricing.ts
  - src/views/GexView.tsx
  - src/views/ChartView.tsx
  - src/gex-colors.ts
---

# GEX math - rules loaded when touching these files

Full derivations and sources: `.claude/docs/gex-levels.md`. History of changes: `.claude/docs/decisions.md`

- `src/gex.ts` is pure: no React, no DOM
- GEX per contract is `gamma * OI * 100 * spot^2 * 0.01`, calls positive, puts negative (`gexCall` / `gexPut`). Quotes with null gamma are excluded, not treated as 0
- Gamma Flip is the hypothetical-spot Black-Scholes recompute (`findGammaFlipHypotheticalSpot`), not a cumulative sum or a sign change of the per-strike profile. Do not reintroduce those, they measure a different quantity
- The IV floor `GAMMA_FLIP_MIN_IV = 0.05` exists because CBOE ships failed-solve placeholder IVs (down to 1e-5). Removing it brings back spurious second crossings. Only a minimum is needed, large IVs just shrink gamma
- Call Wall and Put Wall are the max and min `netGex` strikes. Resistance 2 must be ABOVE the call wall and Support 2 BELOW the put wall, each at least a minimum distance away. The distance is an original, unsourced heuristic: 2% of spot by default (`SECOND_WALL_MIN_DISTANCE_PCT`), overridable per symbol in `SECOND_WALL_DISTANCE_BY_SYMBOL` as `{ pct }` or `{ usd }`. Keep the unsourced disclosure in the doc comment and in the UI tooltips
- Ties on `netGex` resolve to the lowest strike
- Futures-priced symbols (VIX, VXN) use per-quote `forward` (Black-76). `q.forward ?? spot` is the single switch. Gamma flip sweep excludes quotes that carry a `forward`
- Resistance 1.5 / Support 1.5 and the dual Gamma Flip +/- display were built and then removed on purpose. Do not bring them back unasked
- Tests use small hand-built fixtures with hand-derived expectations. Add a test for every changed rule
