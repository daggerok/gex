# VIX / VXN options (futures-priced) - research and model

Condensed from the original VIX research plan (gex-vix-futures-pricing-research.txt in the old .plans folder, 2026-10-04, snapshot of the 2026-10-02 close, deleted from the repo, recoverable from git history). Implemented in `src/vix-pricing.ts` behind the `vixFuturesPricing` setting. Section numbers kept because code and tests cite them as "research plan N.M"

## 2. Verdict

Feasible with no new data source. VIX options are priced off the VX futures for each expiration, not spot VIX, and the correct per-expiration forward can be read from the option chain itself by put-call parity. Work is client-side: a Black-76 greeks function, a Black-76 IV solver (providers' VIX IV is unusable), a per-expiration forward, and a dispatch at the single enrichment entry point. CACHE, CBOE and YAHOO all work. The hard part is GEX semantics (section 9), not pricing

Before this work, CBOE served VIX with spot-based higher-order greeks and spot-scaled GEX at spot 15.31, so the status quo was misleading, not unsupported

## 5. Evidence

### 5.1 Data is available, but not spot-priced

- yfinance `^VIX` has 13 expirations (weeklies root `VIXW`, monthlies `VIX`), spot 15.31 at the snapshot
- The 20-strike Oct-21 put is deep ITM against spot (intrinsic 4.69) yet trades 3.00 x 3.10, below the spot no-arbitrage bound of about 4.64, so no volatility reproduces it. Yahoo's IV for these puts is the 0.00001 floor
- Spot-based BS prices OTM calls at about 140-150% IV where Black-76 on the future gives 87-94%, matching Cboe's own iv. Example: `VIX261021C00020000` mid 0.735, spot-BS IV 1.4523, Black-76 (F = 17.648) IV 0.9438, Cboe iv 0.9697
- Near-weekly VIX IVs of 300%+ are real, which is why the IV solver range goes to 10

### 5.2 yfinance has no VX futures

`VX=F`, `VXV26.CBF`, `^VX`, `VX1!` and others all return 404. `^VIX3M`, `^VIX9D`, `^VIX6M` are spot volatility indices over other horizons and `VIXY` is an ETF, none substitute for F

### 5.3 Cboe futures data exists but is not needed

Daily VX settlements are public at `https://www.cboe.com/us/futures/market_statistics/settlement/csv/` (optional `?dt=YYYY-MM-DD`), no auth, but not on the `cdn.cboe.com` options path (all sibling futures paths return 403) and `www.cboe.com` sends no CORS header, so it would need a new proxy route

### 5.4 Weekly settlements are placeholders

Every weekly VX contract printed the October monthly value (17.648), including Nov-04 and Nov-11 which sit between two monthlies. On 2026-09-15 weeklies likewise copied 17.032 and 18.5473. The settlement feed cannot price weekly VIX options and disagreed with the market by up to 1.17 points

### 5.5 The chain already contains the forward

Put-call parity `F = K + (C - P) / DF`. Robust estimate: strikes with both legs bid > 0, ask > 0 and spread < 0.50, the 5 smallest `|C - P|`, median of their F, `DF = exp(-0.045 T)`. Against monthly VX settlements it agrees within +-0.06 on every monthly with two-sided quotes (e.g. 2026-11-18: 18.33 vs 18.3449, 2026-12-16: 18.779 vs 18.7966, 2027-02-17: 19.95 vs 19.9486). Weeklies get sensible values where the feed does not (2026-10-07: 16.48 vs the placeholder 17.648). 2026-11-04 had no parity pairs and 2027-05-18 and 2027-06-16 also gave none. The repo's `estimateSpot` lands within 0.10 on all 13 expirations

### 5.6 What providers' IV and greeks really are

- Cboe's monthly VIX greeks are consistent with Black-76 on the matching future (e.g. `VIX261021C00020000`: B76 delta 0.3300, gamma 0.0903 vs Cboe 0.3271, 0.0922, spot-based 0.1434, 0.0650). Cboe's iv is futures-based, deep ITM contracts get iv 0.0
- Cboe's weekly greeks are wrong for near weeklies (5.4)
- Yahoo's `impliedVolatility` is spot-based (calls 1.5-2.7, ITM puts 0.00001) and unusable

### 5.7 Expiration alignment

Every monthly VIX option expiration has a VX future with the same date. Weeklies align by date only and their settlement is a placeholder (5.4). The parity rule sidesteps matching entirely

### 5.8 CACHE path

`TICKERS=VIX` produced a VIX cache file (VIX.json, scratch run, not committed) with the unmodified script (13 expirations, 1,031 quotes, 324 KB, Cboe greeks matched 1031/1031), so CACHE does not have to be live-only. It only needs a line in `data/Indices.txt`

## 6. Pricing model: Black-76

### 6.1 Why

A VIX option settles to the VIX SOQ the same morning its matching VX future settles, so at expiry it is an option on the future's final value. The future is a martingale (no carry, no dividend), standard model is Black (1976) with discount at r. Known limitation: VIX mean-reverts and has strong skew, one lognormal sigma per strike (per-contract IV) is the conventional approximation

### 6.2 Formulas

Inputs: F forward per expiration (section 7), K strike, sigma Black-76 IV, T = `yearsToExpiration` (existing +1 day rule), r = `BS_RISK_FREE_RATE` (0.045), no dividend term. Conventions match `src/greeks.ts`: theta per calendar day, vega per 1 vol point, rho per 1 percentage point of r

```
d1 = (ln(F/K) + 0.5 sigma^2 T) / (sigma sqrtT),  d2 = d1 - sigma sqrtT
D  = exp(-rT),  pdf = normPdf(d1)
call = D (F N(d1) - K N(d2)),   put = D (K N(-d2) - F N(-d1))
delta_call = D N(d1),  delta_put = D (N(d1) - 1)
gamma = D pdf / (F sigma sqrtT)
vega  = F D pdf sqrtT / 100
theta = (-(F D pdf sigma)/(2 sqrtT) + r V) / 365         (V = that option's model price)
rho   = -T V / 100                                        (differs from the generalized-BS shortcut)
lambda = delta F / optPrice
vanna = -D pdf d2 / sigma / 100
vomma = (F D pdf sqrtT) d1 d2 / sigma / 10000
charm = (r D N(d1) + D pdf d2/(2T)) / 365                 (call; put uses -r D N(-d1))
speed = -gamma (1 + d1/(sigma sqrtT)) / F
zomma = gamma (d1 d2 - 1) / sigma / 100
color = -gamma (2 r T + 1 - d1 d2) / (2T) / 365
```

Signs and scaling of charm and color follow the existing `blackScholesGreeks` convention so UI columns stay comparable

### 6.3 Test oracle

Black-76 equals generalized Black-Scholes with `S = F` and `q = r` for every greek except rho (checked: B76 call 0.774039532958309 vs BS 0.7740395329583087). `src/vix-pricing.test.ts` asserts that identity and `rho === -T * price / 100`. Production code must NOT call `blackScholesGreeks` with `q = r`, rho would be wrong and the VIX path would depend on the equity function's internals

### 6.4 IV solver

Solve only when `bid > 0` and `ask > 0` on the mid, never on stale last trades. Bounds: call `D max(F-K,0) < P < D F`, put `D max(K-F,0) < P < D K`, otherwise `greeksMissingReason = 'price_out_of_bounds'`. Bisection on sigma in [0.01, 10], monotone price so no Newton failure mode. Deep ITM contracts (Cboe iv 0.0) often fall at or below the lower bound, missing IV there is accepted

## 7. Forward selection per expiration

### 7.1 Rule

1. Keep strikes where call and put both have `bid > 0`, `ask > 0` and spread <= max(0.50, 25% of mid)
2. `Fk = K + (Cmid - Pmid) / D`
3. Median of `Fk` over the 3-5 strikes with the smallest `|Cmid - Pmid|` is F(E)
4. If step 1 finds nothing, fall back to `estimateSpot(quotes, E)` and mark the quotes low-confidence, if that also returns null leave greeks empty with `greeksMissingReason = 'missing_forward'`

Never substitute the spot index for F(E) and never use a weekly VX settlement. `estimateSpot` itself stays unchanged for its other callers (it uses last trade when a side is 0, can be stale, and trusts a single strike)

### 7.3 Optional future cross-check

Monthly VX settlements could be a reference or fallback for monthlies only, needs a new proxy route (CORS). Only worth it if the parity rule fails often in practice. Not built

## 9. GEX and Chart implications

- `gexCall` uses one spot for every expiration, but for VIX gamma is with respect to each expiration's own F (16.48 to 20.88 on the snapshot). Spot 15.31 would understate GEX by (15.31/17.67)^2 = 0.75x on the Oct monthly and 0.54x on the Jun-27 monthly
- Summing across expirations assumes a 1% spot-VIX move moves every future by 1%, which is false, futures beta falls with tenor, so cross-expiration sums are less meaningful than for SPX
- Strikes are in futures space, so walls and flip are levels of the matching future, not spot VIX. Drawing them on the spot `^VIX` chart puts them 2-5 points off

What shipped (Phase 3):

1. `computeGexProfile` uses `q.forward ?? spot` per quote, a no-op for every non-futures symbol
2. `useGexLevels` passes the nearest selected expiration's forward as the reference price (`pickReferenceForward`), the true spot index is still displayed
3. The GEX tab shows a short hint (`gex.futuresPricedHint`) that levels are per-expiration-forward, not spot. There is no separate warning for multi-expiration selection, the cross-expiration sum is accepted as is
4. The Chart tab shows a hint (`chart.levels.futuresPricedHint`) that the lines are futures-terms-based. Levels are still drawn on the spot chart, they are not hidden

Treat VIX GEX levels as more approximate than SPX ones, there is no public standard for VIX GEX and dealers hedge VIX options in VX futures

## 13. What NOT to do

Do not add VIX to `INDEX_SYMBOLS` (that would apply spot pricing and an S&P dividend yield) and do not build v1 around the VX settlement CSV (wrong for weeklies, end-of-day, needs CORS proxying)

## Out of scope

Stochastic-vol or mean-reverting VIX models, showing VX futures as their own chain, any `data/options` schema change, any Black-76 math in Python. VXN uses the same path but was never independently tested

## 15. Limitations

1. One snapshot only (2026-10-02 close, read on a Sunday, calm contango). Not tested in backwardation, re-run the 5.5 check on a stressed day before trusting the +-0.06 figure
2. Intraday behavior not observed, the Cboe futures JSON showed `last_price` 0.0 while closed
3. The official Cboe rule for settling untraded weekly VX futures was not found, the "do not use weekly settlements" conclusion rests on the empirical mismatch
4. Other free futures sources were not exhaustively searched, terms of use for scripted access to `www.cboe.com` futures pages were not reviewed
5. Day count uses the repo's +1 calendar day rule and r = 0.045. VIX options settle at the morning SOQ so true time to expiry is about half a day less, which moves 5-day weeklies noticeably. Residuals against Cboe (delta within about 0.005, gamma within about 0.002) are consistent with that but not decomposed
6. VIX GEX semantics are a judgment call (section 9)
7. Sparse weeklies: 11-04 had zero bids on most strikes and only the last-trade fallback produced a forward. How often that happens was not measured
8. On 2026-10-04 `cdn.cboe.com` answered `_VIX.json` and `_SPX.json` with HTTP 307 to `cdn-api.cboe.com`. Redirect-following clients should be fine, not re-verified through the proxies
