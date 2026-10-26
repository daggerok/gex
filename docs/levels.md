# How the numbers are computed

What every metric and level means, how it is computed and whether it rests on a published source or is this app's own rule. Every number is a model approximation from public open interest, not measured dealer positioning. Back to the [README](../README.md)

The code is the reference: all of it lives in `src/gex.ts` and `src/greeks.ts` (pure functions with tests), and the levels are computed once per selection in `src/use-gex-levels.ts`, so the Board, GEX and Chart tabs always show the same values. The doc comment of each function says where the rule comes from; the maintainer keeps the derivations with quoted sources in a separate notes file (`gex-levels.md`)

## Contents

- [Inputs: which quotes and which spot](#inputs-which-quotes-and-which-spot)
- [Time to expiration](#time-to-expiration)
- [Greeks](#greeks)
- [GEX per strike and the dealer convention](#gex-per-strike-and-the-dealer-convention)
- [Levels](#levels)
- [Board columns](#board-columns)
- [Expiration selection](#expiration-selection)

## Inputs: which quotes and which spot

- **Quotes:** only the expirations selected in the Expirations panel, all of them pooled per strike. Expired quotes are dropped first (see below)
- **Spot:** the provider's underlying price; without one, a put-call parity estimate from the nearest selected expiration (the Spot level then says it is estimated)
- **VIX and VXN** are priced off their futures, not the spot index: the Gamma Flip is not computed for them, and real levels need the experimental Black-76 pricing (Settings -> **VIX futures-priced greeks**, `vixFuturesPricing`, off by default): each expiration is priced off its own futures forward; off, the GEX tab explains why it shows none

## Time to expiration

`yearsToExpiration` (`src/greeks.ts`, PR #180, #206, #209):

- T = (settlement moment - now) / 365 days, in real time, New York calendar
- settlement: 16:00 ET on the expiration day; the AM-settled monthlies of SPX, NDX and RUT (roots `SPX`, `NDX`, `RUT`, not `SPXW`, `NDXP`, `RUTW`) at 9:30 ET (the owner's rule: the settlement value comes from the opening prints)
- floor: 15 minutes while the option is alive, so gamma stays finite near the close
- after the settlement the option is over: a 0DTE expiration disappears from the lists at 16:00 ET, an AM-settled quote at 9:30 ET on its day; earlier dates are never shown
- in a backtest ("As of") "now" is the snapshot time: a backup at its minute, a day archive at the 16:00 close

## Greeks

- The cache and CBOE carry the provider's first-order greeks (Cboe delayed delta, gamma, theta, vega, rho). YAHOO brings IV only, NASDAQ neither
- After every load the browser fills the gaps with Black-Scholes (`enrichQuotesWithModelGreeks`): missing first-order greeks when IV and spot allow, and always the higher orders (lambda, vanna, vomma, charm, speed, zomma, color). Rate 4.5%, dividend yield per index (SPX 1.1%, NDX 0.6%, DJX 1.5%, RUT 1.1%), 0 for stocks and ETFs. Theta per calendar day, vega and rho per 1 point
- NASDAQ quotes have no IV, so they get no model greeks and add nothing to GEX

## GEX per strike and the dealer convention

```
call GEX = gamma x OI x 100 x spot^2 x 0.01      ($ of hedging per 1% move)
put GEX  = -(gamma x OI x 100 x spot^2 x 0.01)
Net GEX(strike) = call GEX + put GEX
Abs GEX / AG(strike) = |call GEX| + |put GEX|
```

- **Convention (public, SpotGamma style):** dealers are assumed long the calls and short the puts, so calls add positive and puts negative gamma exposure, weighted by raw open interest. Trade direction is not public, so this is a convention, not a measurement
- A quote with no gamma is left out entirely (never counted as 0); missing OI or volume counts as 0
- **Net GEX view vs Abs GEX view:** the switch in the Net GEX chip shows either one net bar per strike (default) or both sides unnetted, call GEX up and put GEX down
- **Total Net GEX** (GEX sidebar) is the sum over strikes; its sign is the regime shown next to it

## Levels

On by default: Max Net GEX, Min Net GEX, Gamma Flip, Zero GEX, Max Pain, Max AG (only while the AG metric is on) and Spot. Off by default: Net GEX+, Net GEX-, 75% Sum Net GEX+ and -, Sigma. Ties always go to the lower strike

| Level | Rule | Source |
|---|---|---|
| **Spot** | the spot (or its estimate) | |
| **Max Net GEX** | the strike with the largest positive Net GEX (the call wall) | standard definition |
| **Min Net GEX** | the strike with the most negative Net GEX (the put wall) | standard definition |
| **Net GEX+** | the largest positive Net GEX strike ABOVE Max Net GEX and at least 3% of spot away from it (SPY: $3) | own heuristic |
| **Net GEX-** | the most negative Net GEX strike BELOW Min Net GEX, at least the same distance away | own heuristic |
| **75% Sum Net GEX+** | walking up from spot over the strikes with positive Net GEX, the first strike where the running sum reaches 75% of that side's total | own heuristic |
| **75% Sum Net GEX-** | the same walking down over the negative strikes | own heuristic |
| **Gamma Flip** | the price where the total GEX of the whole book changes sign when the spot is moved: the book is re-priced with Black-Scholes at 60 hypothetical spots across +/-20%, every sign change is a crossing; one crossing -> that one, several -> the one nearest to spot | SpotGamma "Zero Gamma" method |
| **Zero GEX** | the owner's rule on the per-strike profile at the real spot: total Net GEX > 0 -> walk DOWN from Max Net GEX towards Min Net GEX, < 0 -> walk UP from Min Net GEX towards Max Net GEX; each step into the other sign is a candidate zone; several -> the zone with the highest average AG of its two strikes. The line is the zone's strike of the other sign; the switch in the chip draws the zone as a band | own rule, not the Gamma Flip |
| **Max Pain** | the strike where the total intrinsic payout to option holders (calls OI x max(0, S - K) plus puts OI x max(0, K - S)) is smallest; uses OI only | standard formula |
| **Max AG** | the strike with the largest Abs GEX (most hedging per 1% move in either direction) | own definition |
| **Sigma, % mode** | the strikes nearest to spot x (1 +/- 1%, 2%, 3%), labelled 1σ, 2σ, 3σ | own heuristic, a % distance, not a statistical sigma |
| **Sigma, statistical mode** | 1σ = spot x ATM IV x sqrt(T) of the nearest selected expiration that is alive and has a usable ATM IV; the strikes nearest to spot +/- 1, 2, 3 σ | textbook one-standard-deviation move; the choice of expiration and ATM IV is ours |

### Gamma Flip: IV repair and coverage gate

The Gamma Flip re-prices quotes from their IV, and Cboe sometimes delivers failed IV solves (1e-5 to 0.004) on whole near-money ranges while its gamma is fine. So before the sweep (own repair, owner-approved 2026-10-25):

1. an IV under 5% (or missing) is replaced per expiration by: linear interpolation along the smile of the same side, else the other side's IV at the same strike, else the IV whose Black-Scholes gamma equals the provider gamma
2. **coverage gate:** within +/-2% of spot, the quotes with a usable IV must carry at least 80% of the provider |GEX|; below that the Gamma Flip is not shown and its tooltip says how much was covered

The repair only feeds the Gamma Flip and the ATM IV of Sigma; every other level uses the provider gamma unchanged

### ATM IV (statistical Sigma)

Per strike the mean of the call and put IV (5% floor), linearly interpolated at spot between the nearest strikes below and above; outside the strikes the nearest strike's IV

## Board columns

One row per strike of the selected expirations (`computeBoard`):

| Column | Definition |
|---|---|
| Net GEX | call GEX + put GEX (the Net GEX / Abs GEX switch shows call and put GEX instead) |
| Abs GEX | \|call GEX\| + \|put GEX\| |
| Notional delta | own definition: dealer delta exposure in $ under the same convention, sum of delta x OI x 100 x spot over the calls minus the same over the puts |
| Total, call, put OI | contracts |
| Total, call, put volume | contracts |
| P/C ratios | put / call by OI and by volume, empty when the call side is 0 |
| % | the strike's Abs GEX as a share of the Abs GEX of all strikes |

Peaks: the largest value of each column (> 0); Net GEX has two, its largest positive and most negative strike, put GEX its most negative. Runner-ups: the same one rank down. The ATM row is the strike nearest to spot

## Expiration selection

- First load of a ticker: the nearest expiration that is not over
- Switching tickers keeps your selection where it can (`pickExpirations`): the same dates when the new ticker has them; else every date inside the old selection's range; else the nearest one
- The Expirations panel shows each loaded expiration's share of the open interest of all loaded expirations
- The cache holds, per default ticker, every expiration up to 42 days, the weeklies up to 92 days and the monthlies and quarter-ends up to a year; other tickers their nearest 12 to 50 (see [Automations](automations.md#default-tickers-and-their-expirations))
