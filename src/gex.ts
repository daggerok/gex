/// <reference lib="esnext" />
import { BS_DIVIDEND_YIELD, BS_RISK_FREE_RATE, impliedVolFromGamma, isFuturesPricedSymbol, normPdf, yearsToExpiration } from './greeks';
import type { GexLevels, GexPoint, IvRepair, OptionQuote, SigmaLevel, SigmaLevels, SigmaStatBasis, ZeroGexZone } from './types';

// ---------------------------------------------------------------------------
// Gamma exposure (GEX) math - SINGLE SOURCE OF TRUTH for GEX-derived levels
// ---------------------------------------------------------------------------
// Spec: agentic-workspace docs/repos/gex/spec-gex-app.md section 7. Pure functions, zero
// React/DOM dependencies. Never duplicate any of this in scripts/options-data.ts
// or in the proxy scripts (architecture rule R1).
//
// Convention: the "SpotGamma-style" public convention - calls contribute
// positive gamma exposure, puts negative, weighted by raw open interest (NOT a
// customer buy/sell-classified position). It is the most common convention in
// public GEX write-ups and open-source implementations, but it is a MODEL
// APPROXIMATION, not a measured fact about real dealer positioning (trade
// direction is not public data). It was not reverse-engineered against any
// commercial GEX product, so expect numbers in the same ballpark as other
// public GEX tools, not an exact match (plan section 17 item 3).
//
// Per-quote reference price (Phase 3 of agentic-workspace docs/repos/gex/spec-vix-futures.md,
// section 9): for almost every symbol one shared `spot` is the
// right reference price for every quote in the chain. VIX/VXN (futures-priced
// - see FUTURES_PRICED_SYMBOLS in src/greeks.ts) are the exception: each
// expiration is priced off its OWN forward (src/vix-pricing.ts's
// enrichFuturesPricedQuotes sets OptionQuote.forward per quote when
// settings.vixFuturesPricing is on and Black-76 enrichment succeeds).
// computeGexProfile below uses `q.forward` in place of the shared `spot`
// parameter whenever a quote carries one - the formula itself (gexCall/
// gexPut) is unchanged, only which reference price gets passed in per quote.
// A quote without `forward` (every non-futures-priced quote, and any
// futures-priced quote whose own enrichment couldn't resolve a forward) falls
// back to `spot` exactly as before - this is a no-op for the SPX-family path:
// `forward` is never set there, so `q.forward ?? spot` always resolves to
// `spot` for them, byte-for-byte identical to the pre-Phase-3 behavior.

/** Shares per standard equity/index option contract. */
export const CONTRACT_MULTIPLIER = 100;

/**
 * Minimum distance from the primary wall, as a fraction of spot, for a strike
 * to qualify as the "second wall" (netGexPlus / netGexMinus).
 * ORIGINAL, UNSOURCED heuristic: no public standard for a "second wall" exists.
 * It only makes the behavior deterministic and documented. Treat it as a
 * tunable constant, not an established rule - at a fixed 3% (2% before 2026-10-07) it behaves very
 * differently on $1 strike spacing than on $2.50/$5 spacing (plan section 17
 * item 6).
 */
export const NET_GEX_PLUS_MINUS_MIN_DISTANCE_PCT = 0.03;

/**
 * Minimum distance between the primary wall and its second wall, either as a
 * fraction of spot (`pct`, 0.004 = 0.4%) or as an absolute price (`usd`).
 */
export type NetGexPlusMinusDistance = { pct: number } | { usd: number };

/**
 * Per-symbol override of the second-wall distance. Symbols not listed here
 * use NET_GEX_PLUS_MINUS_MIN_DISTANCE_PCT. Keys are upper-case root symbols. A fixed
 * percentage is far too wide for SPY ($1 strikes, ~$23 at 3% of spot 775) - the second
 * wall then lands on a negligible strike far from the real cluster - so SPY
 * uses a flat $3. Add a row here to tune another symbol, nothing else needs
 * to change.
 */
export const NET_GEX_PLUS_MINUS_DISTANCE_BY_SYMBOL: Readonly<Record<string, NetGexPlusMinusDistance>> = {
    SPY: { usd: 3 },
};

/** Resolved minimum second-wall distance in price units for `symbol` at `spot`. `bySymbol` is the override table (tests pass their own). */
export function netGexPlusMinusMinDistance(symbol: string | null | undefined, spot: number, bySymbol: Readonly<Record<string, NetGexPlusMinusDistance>> = NET_GEX_PLUS_MINUS_DISTANCE_BY_SYMBOL): number {
    const rule = symbol ? bySymbol[symbol.toUpperCase()] : undefined;
    if (rule && 'usd' in rule) return rule.usd;
    return (rule ? rule.pct : NET_GEX_PLUS_MINUS_MIN_DISTANCE_PCT) * spot;
}

/** GEX of a call position: gamma * OI * multiplier * spot^2 * 0.01 (section 7.1). */
export function gexCall(gamma: number, openInterest: number, spot: number): number {
    return gamma * openInterest * CONTRACT_MULTIPLIER * spot * spot * 0.01;
}

/** GEX of a put position: same formula as a call, negated (section 7.1). */
export function gexPut(gamma: number, openInterest: number, spot: number): number {
    return -gexCall(gamma, openInterest, spot);
}

function finiteOr0(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Aggregate quotes into a per-strike GEX profile, sorted ascending by strike
 * (section 7.2). The caller decides which expirations to pass in.
 *
 * Documented choice (section 7.1): a quote with null (or non-finite) gamma is
 * excluded from the profile ENTIRELY - it contributes neither GEX nor OI/volume,
 * and a strike whose quotes all lack gamma produces no point. It is never
 * treated as gamma 0. Null openInterest / volume count as 0.
 *
 * Per-quote reference price (see the module doc comment, Phase 3): each
 * quote uses `q.forward` in place of `spot` when present and positive -
 * this is how VIX/VXN's per-expiration forward is honored. Every other
 * quote (forward null/absent) uses `spot` unchanged.
 */
export function computeGexProfile(quotes: readonly OptionQuote[], spot: number): GexPoint[] {
    const byStrike = new Map<number, GexPoint>();
    for (const q of quotes) {
        if (typeof q.gamma !== 'number' || !Number.isFinite(q.gamma)) continue;
        if (!Number.isFinite(q.strike)) continue;
        const ref = typeof q.forward === 'number' && Number.isFinite(q.forward) && q.forward > 0 ? q.forward : spot;
        let point = byStrike.get(q.strike);
        if (!point) {
            point = { strike: q.strike, callGex: 0, putGex: 0, netGex: 0, absGamma: 0, callOi: 0, putOi: 0, callVolume: 0, putVolume: 0 };
            byStrike.set(q.strike, point);
        }
        const oi = finiteOr0(q.openInterest);
        const volume = finiteOr0(q.volume);
        if (q.side === 'call') {
            point.callGex += gexCall(q.gamma, oi, ref);
            point.callOi += oi;
            point.callVolume += volume;
        } else {
            point.putGex += gexPut(q.gamma, oi, ref);
            point.putOi += oi;
            point.putVolume += volume;
        }
    }
    const profile = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
    for (const point of profile) {
        point.netGex = point.callGex + point.putGex;
        // Absolute Gamma (AG, see GexPoint.absGamma's doc comment): callGex
        // is already >= 0 and putGex already <= 0, so callGex - putGex is
        // exactly |callGex| + |putGex| without a second independent sum that
        // could drift from the values just accumulated above.
        point.absGamma = point.callGex - point.putGex;
    }
    return profile;
}

/**
 * How the GEX chart draws the Net GEX metric (owner request 2026-10-25):
 *  - `net`: one value per strike, netGex = callGex + putGex (the default, as before)
 *  - `split` ("Abs GEX"): both sides at every strike without netting, callGex up and putGex down
 *    (the "Gamma Split" view: call gamma exposure above zero, put gamma exposure below it)
 */
export type NetGexView = 'net' | 'split';

/**
 * The two stacked bar heights of the Net GEX metric at one strike, in $ of gamma exposure per 1% move.
 *  - `net`: `pos` = max(netGex, 0), `neg` = min(netGex, 0), so exactly one of them is non-zero
 *  - `split`: `pos` = callGex (>= 0 for a non-negative gamma), `neg` = putGex (<= 0, puts are negative by the
 *    gexPut convention), so `pos + neg` is still netGex and `pos - neg` is absGamma
 * The values come straight from computeGexProfile (quotes with null gamma are already excluded there).
 */
export function gexBarHalves(point: Pick<GexPoint, 'callGex' | 'putGex' | 'netGex'>, view: NetGexView): { pos: number; neg: number } {
    if (view === 'split') return { pos: point.callGex, neg: point.putGex };
    return { pos: Math.max(point.netGex, 0), neg: Math.min(point.netGex, 0) };
}

export interface GammaFlipCrossings {
    /** Last negative -> positive netGex transition (ascending by strike). Null if none. */
    pos: number | null;
    /** Last positive -> negative netGex transition (ascending by strike). Null if none. */
    neg: number | null;
}

/**
 * Number of hypothetical spot prices swept by findGammaFlipHypotheticalSpot,
 * evenly spaced across spot * (1 +/- GAMMA_FLIP_RANGE_PCT). ~60 points across
 * +/-20% matches the public methodology this function implements (see its
 * own doc comment for citations); confirmed on real "All expirations" SPX
 * data (thousands of quotes) to both (a) comfortably contain the real
 * crossing and (b) run fast enough for a browser - see the PR for the actual
 * measurement.
 */
export const GAMMA_FLIP_GRID_POINTS = 60;
/** +/- range (as a fraction of spot) the hypothetical-spot sweep covers. */
export const GAMMA_FLIP_RANGE_PCT = 0.20;

/**
 * Minimum `iv` a quote must carry to be included in the hypothetical-spot
 * sweep. DISCOVERED NECESSARY against real cached data (SPX.json), not a
 * theoretical worry: a real quote (SPXW261009C07125000, OI 15) carries
 * `iv = 0.00001` - CBOE's own feed, not computed in this app (scripts/
 * options-data.py passes `impliedVolatility` straight through) - and the
 * chain's full set of distinct sub-0.3 IVs forms an unmistakable failed-
 * bisection-solve sequence (1e-5, 0.000254, 0.000498, 0.000987, 0.001963,
 * 0.003916, 0.007822, 0.015635, 0.031260, 0.062509, 0.125009, 0.250008 - each
 * ~2x the last), i.e. CBOE's own IV solver gave up on quotes with no real
 * two-sided market (bid = ask = 0 for ~98% of the sub-0.01 group) and left
 * whatever halving-bisection midpoint it was at, not a real implied vol.
 * BS gamma is proportional to 1/(S * sigma * sqrt(T)), so an
 * near-zero sigma makes gamma (and so dollar-GEX) spike without bound as the
 * hypothetical S sweeps near that quote's own strike - that one OI-15 quote
 * alone produced a ~$19.7B swing at one grid point against a chain whose
 * normal per-quote contributions were in the hundreds of millions, flipping
 * the aggregate's sign at that single point and creating a spurious second
 * crossing. The OLD per-strike-profile algorithm never hit this failure mode
 * because it used the provider's own pre-computed real-spot gamma (0.0001
 * for that exact quote - already sane) and never recomputed anything from
 * `iv`. A large IV (the high end of the same failed-solve sequence, e.g.
 * 7.93 seen on a deep-ITM quote) does NOT cause a blowup - it only shrinks
 * gamma toward 0 - so only a MINIMUM floor is needed, not a cap. 0.05 (5%)
 * is well below any genuine SPX-family implied vol (even the 2020 crash
 * peaked under 0.9) and above the entire observed failed-solve sequence, so
 * it only excludes provably-degenerate quotes.
 *
 * Since 2026-10-25 such quotes are not simply dropped: computeGexLevels repairs their IV first (repairImpliedVols: smile,
 * other side, or the IV of the provider gamma), because on some days CBOE fails the solve on EVERY near-money strike
 * and the sweep then saw only far out-of-the-money quotes.
 */
export const GAMMA_FLIP_MIN_IV = 0.05;

/**
 * Gamma Flip / "Zero Gamma Level" (section 7.3, REWRITTEN - see history
 * below): the hypothetical underlying PRICE S* at which, if every option in
 * the chain had its gamma recomputed via Black-Scholes AS IF the spot were
 * S* (not the real current spot), the resulting aggregate dollar-GEX across
 * the whole chain would be zero. This is the real industry-standard
 * definition - confirmed against public sources, quoted directly:
 *
 *   "A simple cumulative sum treating each contract's gamma as fixed is
 *   wrong more often than it looks because gamma depends on where spot is.
 *   The better approach re-prices the whole book at each candidate spot
 *   price and computes modeled net dealer gamma as if spot were there." -
 *   ZeroGEX, "Gamma Flip Calculation: Before vs After"
 *
 *   "To estimate Zero Gamma, SpotGamma recalculates option gamma over a
 *   range of hypothetical spot prices, aggregates the position-signed
 *   exposure at each price, and locates the modeled crossover through
 *   zero." - SpotGamma support docs, "Zero Gamma"
 *
 *   "One implementation evaluates total dealer GEX at 60 different
 *   hypothetical price levels spanning +/-20% of current spot,
 *   recalculating every option's gamma using Black-Scholes at each level." -
 *   same ZeroGEX source
 *
 * HISTORY: every earlier version of this function (cumulative-sum,
 * last-crossing-on-the-real-profile, directional pos/neg split, real-bar
 * anchoring, zero-boundary trim) scanned `profile` - the per-strike netGex
 * ALREADY COMPUTED AT THE REAL SPOT - for where ITS OWN sign changes across
 * strikes. That is a fundamentally different, wrong quantity: gamma itself
 * depends on where spot is, so the real profile's sign pattern is not the
 * same thing as "where would the whole book's modeled gamma net to zero if
 * spot moved there." This function replaces all of that: it takes the RAW
 * `quotes` (not the aggregated profile) and actually re-prices every one of
 * them at each of a grid of hypothetical spot prices.
 *
 * Mechanics:
 *  1. Sweep GAMMA_FLIP_GRID_POINTS hypothetical prices S, evenly spaced
 *     across spot * (1 +/- GAMMA_FLIP_RANGE_PCT).
 *  2. At each S, recompute every eligible quote's Black-Scholes gamma AT
 *     THAT S: the gamma of blackScholesGreeks(q, S), term for term (since
 *     GEX-H9 only gamma is computed, with T read once per expiration,
 *     sweepLegs; equivalence tests in gex.test.ts compare it with the
 *     full-greeks version).
 *     The quote's own stored `iv` is used as-is; only S varies - there is
 *     no real hypothetical market quote to re-solve IV from, so IV stays
 *     fixed per quote, same convention the citations above use.
 *  3. Convert that hypothetical gamma to dollar-GEX with the SAME formula
 *     the real profile uses (gexCall/gexPut: gamma * OI * CONTRACT_MULTIPLIER
 *     * S^2 * 0.01), parameterized by the hypothetical S instead of the real
 *     spot, so totals are directly comparable to computeGexProfile's own
 *     convention. Summed across EVERY eligible quote in `quotes`, across
 *     every expiration present there - the caller (computeGexLevels /
 *     use-gex-levels.ts) decides which expirations are "selected" exactly
 *     like computeGexProfile does; there is no separate per-expiration loop
 *     here, so a multi-expiration sum falls out automatically, not as a
 *     special case (verified with a dedicated multi-expiration test).
 *  4. Scan the resulting smooth totalGEX(S) sequence (ascending by S) for
 *     sign changes, same "last crossing per direction" rule as the old
 *     per-strike algorithm (GammaFlipCrossings: `pos` = last negative ->
 *     positive transition, `neg` = last positive -> negative transition) -
 *     but UNLIKE the old per-strike version, this DOES linearly interpolate
 *     between the two flanking grid points. That is not the same mistake
 *     the old strike-interpolation approach made: a strike is discrete
 *     (interpolating between two real strikes invents a non-tradable
 *     price), but a hypothetical spot is already a continuous price axis -
 *     interpolating along it is the standard, mathematically correct way to
 *     locate where a continuous function crosses zero (matches "the zero
 *     crossing found by interpolation" in the citations above).
 *
 * As an expected side benefit (verified empirically against real "All
 * expirations" SPX data - see the PR), summing a SMOOTH aggregate across
 * the whole chain at each hypothetical price produces far fewer spurious
 * multi-crossings than the old per-strike-profile approach did, which was
 * easily perturbed by sparse-OI noise at individual strikes.
 *
 * Futures-priced quotes (VIX/VXN under Black-76, see the module doc comment
 * on computeGexProfile and src/vix-pricing.ts / src/greeks.ts's
 * FUTURES_PRICED_SYMBOLS) are EXCLUDED from the sweep entirely: a quote
 * carrying a resolved `forward` is already the per-quote marker this module
 * uses for "priced off its own futures curve, not a shared spot" (see
 * computeGexProfile's `q.forward ?? spot`), and Black-Scholes is simply the
 * wrong model to re-run for it. This rework is scoped to the ordinary
 * Black-Scholes spot-priced case only - extending it to a Black-76
 * forward-sweep is explicitly out of scope (flagged in the PR).
 *
 * Known simplification: the gamma uses blackScholesGreeks' own default
 * risk-free rate / dividend yield (BS_RISK_FREE_RATE / BS_DIVIDEND_YIELD =
 * 0), not the per-index dividend yield (src/greeks.ts's
 * INDEX_DIVIDEND_YIELDS) used when quotes were originally enriched - this
 * function (like computeGexProfile/computeGexLevels) has no `symbol`
 * parameter to look one up by. For SPX-family indices the real yield is
 * small (~1-1.5%), so this is a minor model mismatch, not a correctness bug
 * - flagged honestly rather than silently papered over.
 *
 * Both `pos` and `neg` are null when the swept totals never change sign in
 * that direction (including a uniformly one-sided profile, or when no
 * eligible quote remains). Returns `{ pos: null, neg: null }` outright for a
 * non-finite/non-positive `spot`.
 */
export function findGammaFlipHypotheticalSpot(quotes: readonly OptionQuote[], spot: number): GammaFlipCrossings {
    return crossingsByDirection(gammaFlipSweepCrossings(quotes, spot));
}

/** One zero crossing of the swept total GEX: where it is and which way the sign goes (1 = negative -> positive). */
export interface GammaFlipCrossing {
    price: number;
    direction: 1 | -1;
}

/** The last crossing of each direction (the `pos` / `neg` pair of findGammaFlipHypotheticalSpot). */
export function crossingsByDirection(crossings: readonly GammaFlipCrossing[]): GammaFlipCrossings {
    let pos: number | null = null;
    let neg: number | null = null;
    for (const c of crossings) {
        if (c.direction === 1) pos = c.price; else neg = c.price;
    }
    return { pos, neg };
}

/**
 * The Gamma Flip shown in the app (GEX-M2, owner-approved 2026-10-25): the only crossing of the sweep when there is one,
 * the one nearest to spot when there are more (equal distance: the lower price, like every other tie in gex). Null when
 * the sweep never changes sign. Replaces the old pick by the sign of the total net GEX (positive total -> `pos`, else
 * `neg`), which hid the flip whenever the one crossing had the "wrong" direction: on 2026-10-23 SPX (total -31.5B, one
 * negative -> positive crossing at 7597.78) and SPY (total -9.87B, one at 772.55) showed no Gamma Flip at all.
 */
export function nearestGammaFlip(crossings: readonly GammaFlipCrossing[], spot: number): number | null {
    let best: number | null = null;
    for (const { price } of crossings) {
        if (best === null) { best = price; continue; }
        const d = Math.abs(price - spot);
        const bestD = Math.abs(best - spot);
        if (d < bestD || (d === bestD && price < best)) best = price;
    }
    return best;
}

/**
 * Every sign change of the hypothetical-spot sweep, ascending by price (the core of findGammaFlipHypotheticalSpot, see
 * its doc comment for the method). Empty for a non-finite or non-positive spot, no eligible quote, or no sign change.
 */
export function gammaFlipSweepCrossings(quotes: readonly OptionQuote[], spot: number): GammaFlipCrossing[] {
    if (!Number.isFinite(spot) || spot <= 0) return [];
    // Exclude futures-priced quotes (VIX/VXN) - see doc comment above - and
    // quotes whose `iv` is below GAMMA_FLIP_MIN_IV (degenerate/failed-solve
    // placeholder, not a real vol - see that constant's doc comment for the
    // real-data discovery). blackScholesGreeks would otherwise happily
    // recompute an enormous, unrealistic gamma from a near-zero iv as the
    // hypothetical S sweeps near that quote's own strike.
    const eligible = quotes.filter(
        (q) => !(typeof q.forward === 'number' && Number.isFinite(q.forward) && q.forward > 0)
            && typeof q.iv === 'number' && Number.isFinite(q.iv) && q.iv >= GAMMA_FLIP_MIN_IV,
    );
    if (eligible.length === 0) return [];

    const low = spot * (1 - GAMMA_FLIP_RANGE_PCT);
    const high = spot * (1 + GAMMA_FLIP_RANGE_PCT);
    const step = (high - low) / (GAMMA_FLIP_GRID_POINTS - 1);

    // GEX-H9: everything of a quote that does not depend on S is computed once (T once per expiration), the inner loop
    // is gamma only. The arithmetic is blackScholesGreeks' own gamma, term for term in the same order, so the totals are
    // the same numbers; it was 12 greeks, a regex and a clock read per quote and grid point (100-800 ms on SPX).
    const legs = sweepLegs(eligible);

    const grid: { S: number; total: number }[] = [];
    for (let i = 0; i < GAMMA_FLIP_GRID_POINTS; i++) {
        const S = i === GAMMA_FLIP_GRID_POINTS - 1 ? high : low + step * i;
        let total = 0;
        for (const leg of legs) {
            const d1 = (Math.log(S / leg.k) + leg.drift) / leg.sigmaSqrtT;
            const gamma = leg.discQ * normPdf(d1) / (S * leg.sigma * leg.sqrtT);
            if (!Number.isFinite(gamma)) continue;
            total += leg.call ? gexCall(gamma, leg.oi, S) : gexPut(gamma, leg.oi, S);
        }
        grid.push({ S, total });
    }

    const crossings: GammaFlipCrossing[] = [];
    let prevSign: -1 | 1 | null = null;
    let prevNonZero: { S: number; total: number } | null = null;
    let pendingZeroS: number[] = [];

    for (const point of grid) {
        if (point.total === 0) {
            pendingZeroS.push(point.S);
            continue;
        }
        const sign: -1 | 1 = point.total > 0 ? 1 : -1;
        if (prevSign !== null && sign !== prevSign) {
            let crossing: number;
            if (pendingZeroS.length > 0) {
                // An exact-zero grid point bridging the sign change already
                // reads zero - it IS the crossing, no interpolation needed.
                crossing = pendingZeroS[pendingZeroS.length - 1];
            } else {
                // Linear interpolation between the two flanking (nonzero)
                // grid points for the S where the line through them is 0.
                const a = prevNonZero!;
                const b = point;
                crossing = a.S + (0 - a.total) * (b.S - a.S) / (b.total - a.total);
            }
            crossings.push({ price: crossing, direction: sign });
        }
        pendingZeroS = [];
        prevSign = sign;
        prevNonZero = point;
    }

    return crossings;
}

/** One quote of the Gamma Flip sweep with its S-independent Black-Scholes terms (gammaFlipSweepCrossings). */
interface SweepLeg {
    k: number;
    sigma: number;
    sqrtT: number;
    /** sigma * sqrtT, the d1 denominator */
    sigmaSqrtT: number;
    /** (r - q + sigma^2 / 2) * T, the d1 drift term */
    drift: number;
    /** e^(-q T) */
    discQ: number;
    oi: number;
    call: boolean;
}

/**
 * The quotes the sweep can price, in their order, with the terms of blackScholesGreeks' gamma that do not depend on S
 * (its defaults: BS_RISK_FREE_RATE, BS_DIVIDEND_YIELD). Left out like there: no open interest, a non-positive strike or
 * IV, an expired or malformed expiration (yearsToExpiration null, read once per expiration).
 */
function sweepLegs(quotes: readonly OptionQuote[]): SweepLeg[] {
    const years = new Map<string, number | null>();
    const legs: SweepLeg[] = [];
    for (const q of quotes) {
        const oi = finiteOr0(q.openInterest);
        if (oi === 0) continue;
        const k = q.strike;
        const sigma = q.iv as number;
        if (!(Number.isFinite(k) && k > 0) || !(Number.isFinite(sigma) && sigma > 0)) continue;
        let t = years.get(q.expiration);
        if (t === undefined) {
            t = yearsToExpiration(q.expiration);
            years.set(q.expiration, t);
        }
        if (t == null || t <= 0) continue;
        const sqrtT = Math.sqrt(t);
        legs.push({
            k, sigma, sqrtT,
            sigmaSqrtT: sigma * sqrtT,
            drift: (BS_RISK_FREE_RATE - BS_DIVIDEND_YIELD + 0.5 * sigma * sigma) * t,
            discQ: Math.exp(-BS_DIVIDEND_YIELD * t),
            oi,
            call: q.side === 'call',
        });
    }
    return legs;
}

export interface NetGexLevels {
    maxNetGex: number | null;
    minNetGex: number | null;
    netGexPlus: number | null;
    netGexMinus: number | null;
}

/**
 * Call/Min Net GEXs (section 7.4).
 *  - maxNetGex: strike with the maximum netGex among netGex > 0
 *  - minNetGex: strike with the minimum netGex among netGex < 0
 *  - netGexPlus: the strongest netGex > 0 strike ABOVE maxNetGex and at least
 *    `minDistance` away from it (Net GEX+ must sit above the Max Net GEX)
 *  - netGexMinus: the strongest netGex < 0 strike BELOW minNetGex and at least
 *    `minDistance` away from it (Net GEX- must sit below the Min Net GEX)
 * Ties on netGex resolve to the lowest strike (first in ascending order).
 *
 * `minDistance` is in price units; the default is NET_GEX_PLUS_MINUS_MIN_DISTANCE_PCT
 * * spot. Callers with a symbol use netGexPlusMinusMinDistance() to apply the
 * per-symbol override. The distance rule is an unsourced heuristic, see the
 * constant's comment.
 *
 * `spot` here is just "the reference price the default distance measures
 * from" - for a futures-priced symbol (VIX/VXN) there is no single spot in
 * the GEX-relevant sense once multiple expirations/forwards are in play, so
 * the caller (src/use-gex-levels.ts) passes the nearest selected
 * expiration's forward instead of the true spot index level (design
 * decision, Phase 3 of agentic-workspace docs/repos/gex/spec-vix-futures.md section
 * 9: strikes live in futures-space for these symbols, so a futures-space
 * reference price makes the distance threshold meaningful; the true spot VIX
 * index is still shown separately in the UI).
 */
export function findNetGexLevels(
    profile: readonly GexPoint[],
    spot: number,
    minDistance: number = NET_GEX_PLUS_MINUS_MIN_DISTANCE_PCT * spot,
): NetGexLevels {
    const pick = (sign: 1 | -1, beyond: number | null): number | null => {
        let best: GexPoint | null = null;
        for (const point of profile) {
            const signed = sign * point.netGex;
            if (!(signed > 0)) continue;
            // sign 1 (calls): only strikes above the wall; sign -1 (puts): only below
            if (beyond !== null && sign * (point.strike - beyond) < minDistance) continue;
            if (best === null || signed > sign * best.netGex) best = point;
        }
        return best ? best.strike : null;
    };
    const maxNetGex = pick(1, null);
    const minNetGex = pick(-1, null);
    return {
        maxNetGex,
        minNetGex,
        netGexPlus: maxNetGex === null ? null : pick(1, maxNetGex),
        netGexMinus: minNetGex === null ? null : pick(-1, minNetGex),
    };
}

/**
 * Share of one side's total |netGex| that the Gamma Range levels enclose.
 * ORIGINAL, UNSOURCED heuristic (user-chosen 75%): no public standard defines
 * such a level. Tunable constant, not an established rule.
 */
export const SUM_NET_GEX_SHARE = 0.75;

export interface SumNetGexLevels {
    sumNetGexPlus: number | null;
    sumNetGexMinus: number | null;
}

/**
 * Gamma Range (original heuristic, see SUM_NET_GEX_SHARE). Starting at the
 * center (spot) and moving right, sum the POSITIVE netGex of strikes >= spot;
 * the first strike where the running sum is >= share * (that side's total
 * positive netGex) is sumNetGexPlus. Moving left from spot over NEGATIVE
 * netGex of strikes <= spot (magnitudes) gives sumNetGexMinus the same way.
 * Only the side that is scanned counts toward its total, so a positive
 * cluster below spot never makes the high level unreachable. The profile
 * already reflects the selected expirations. Null when a side has no mass.
 */
export function findSumNetGexLevels(
    profile: readonly GexPoint[],
    spot: number,
    share: number = SUM_NET_GEX_SHARE,
): SumNetGexLevels {
    const scan = (sign: 1 | -1): number | null => {
        const side = profile
            .filter((p) => sign * p.netGex > 0 && sign * (p.strike - spot) >= 0)
            .sort((a, b) => sign * (a.strike - b.strike));
        const total = side.reduce((sum, p) => sum + sign * p.netGex, 0);
        if (!(total > 0)) return null;
        const target = share * total;
        let running = 0;
        for (const p of side) {
            running += sign * p.netGex;
            if (running >= target) return p.strike;
        }
        return side[side.length - 1].strike;
    };
    return { sumNetGexPlus: scan(1), sumNetGexMinus: scan(-1) };
}

/**
 * Max pain (section 7.5): the strike S, among the distinct strikes present,
 * minimizing total intrinsic payout to option holders:
 *   sum over calls callOi(K) * max(0, S - K) + sum over puts putOi(K) * max(0, K - S)
 * Uses open interest only (no gamma needed), so null-gamma quotes are included.
 * Null OI counts as 0. Ties resolve to the lowest strike. null only if empty.
 */
export function computeMaxPain(quotes: readonly OptionQuote[]): number | null {
    // GEX-H9: prefix sums over the strikes instead of strikes x quotes (87 ms -> under 1 ms on 30k quotes). With K sorted,
    // c / p the call / put OI per strike: payout(K_j) = K_j * sum_{i<j} c_i - sum_{i<j} c_i K_i + sum_{i>j} p_i K_i
    // - K_j * sum_{i>j} p_i. Those sums round differently from the direct sum, so every strike within a hair of the
    // minimum is re-priced exactly the old way (same quote order), and the old rule picks among them: identical results.
    const oiAt = new Map<number, { call: number; put: number }>();
    for (const q of quotes) {
        if (!Number.isFinite(q.strike)) continue;
        let at = oiAt.get(q.strike);
        if (!at) oiAt.set(q.strike, (at = { call: 0, put: 0 }));
        if (q.side === 'call') at.call += finiteOr0(q.openInterest); else at.put += finiteOr0(q.openInterest);
    }
    const strikes = Array.from(oiAt.keys()).sort((a, b) => a - b);
    const n = strikes.length;
    if (n === 0) return null;
    // suffix sums of the puts above each strike
    const putAbove = new Array<number>(n).fill(0);
    const putKAbove = new Array<number>(n).fill(0);
    for (let j = n - 2; j >= 0; j--) {
        const k = strikes[j + 1];
        const p = (oiAt.get(k) as { put: number }).put;
        putAbove[j] = putAbove[j + 1] + p;
        putKAbove[j] = putKAbove[j + 1] + p * k;
    }
    const approx = new Array<number>(n);
    let callBelow = 0;
    let callKBelow = 0;
    let min = Infinity;
    let gross = 0;
    for (let j = 0; j < n; j++) {
        const k = strikes[j];
        approx[j] = k * callBelow - callKBelow + putKAbove[j] - k * putAbove[j];
        if (approx[j] < min) min = approx[j];
        gross = Math.max(gross, Math.abs(k * callBelow) + Math.abs(callKBelow) + Math.abs(putKAbove[j]) + Math.abs(k * putAbove[j]));
        const c = (oiAt.get(k) as { call: number }).call;
        callBelow += c;
        callKBelow += c * k;
    }
    if (!Number.isFinite(min)) return null;
    const tolerance = gross * 1e-9;
    let best: number | null = null;
    let bestPayout = Infinity;
    for (let j = 0; j < n; j++) {
        if (approx[j] > min + tolerance) continue;
        const s = strikes[j];
        let payout = 0;
        for (const q of quotes) {
            const oi = finiteOr0(q.openInterest);
            payout += q.side === 'call' ? oi * Math.max(0, s - q.strike) : oi * Math.max(0, q.strike - s);
        }
        if (payout < bestPayout) {
            bestPayout = payout;
            best = s;
        }
    }
    return best;
}

/** Total Absolute Gamma: the sum of |callGex| + |putGex| over every strike of the
 *  profile (the selected expirations). No call/put cancellation, unlike the total
 *  Net GEX. */
export function sumAbsGamma(profile: readonly GexPoint[]): number {
    return profile.reduce((sum, p) => sum + p.absGamma, 0);
}

/** The profile row a level price maps to: the strike itself when the price is
 *  on a strike (exact), otherwise the nearest strike (ties go to the lower
 *  one), e.g. for Spot or a Gamma Flip that falls between strikes. Null for an
 *  empty profile. Used by the Values table to show what a level means on its
 *  strike. */
export function pointAtPrice(profile: readonly GexPoint[], price: number): { point: GexPoint; exact: boolean } | null {
    let best: GexPoint | null = null;
    for (const p of profile) {
        if (best === null || Math.abs(p.strike - price) < Math.abs(best.strike - price)) best = p;
    }
    return best ? { point: best, exact: Math.abs(best.strike - price) < 1e-6 } : null;
}

/** Put/call ratios of ONE strike: puts divided by calls, by open interest and by
 *  volume. Each is null when the call side is 0 (no meaningful ratio). Plain
 *  ratio of the strike's own sums, same definition as computePCRatio's totals. */
export function pcRatioByStrike(p: Pick<GexPoint, 'callOi' | 'putOi' | 'callVolume' | 'putVolume'>): { byOi: number | null; byVolume: number | null } {
    return {
        byOi: p.callOi > 0 ? p.putOi / p.callOi : null,
        byVolume: p.callVolume > 0 ? p.putVolume / p.callVolume : null,
    };
}

export interface OiVolumeTotals {
    callOi: number;
    putOi: number;
    callVolume: number;
    putVolume: number;
}

/**
 * Plain call/put sums of open interest and volume over ALL given quotes
 * (null-gamma quotes included, unlike computeGexProfile). Null OI / volume
 * count as 0. Feeds the GEX tab's "OI Volume" card and computePCRatio, so the
 * card totals and the P/C ratios always agree.
 */
export function computeOiVolumeTotals(quotes: readonly OptionQuote[]): OiVolumeTotals {
    const totals: OiVolumeTotals = { callOi: 0, putOi: 0, callVolume: 0, putVolume: 0 };
    for (const q of quotes) {
        if (q.side === 'call') {
            totals.callOi += finiteOr0(q.openInterest);
            totals.callVolume += finiteOr0(q.volume);
        } else {
            totals.putOi += finiteOr0(q.openInterest);
            totals.putVolume += finiteOr0(q.volume);
        }
    }
    return totals;
}

/**
 * Put/call ratios (section 7.6) by open interest and by volume. Each is null
 * when its call-side denominator is 0. Null OI / volume count as 0.
 */
export function computePCRatio(quotes: readonly OptionQuote[]): { byOi: number | null; byVolume: number | null } {
    const { callOi, putOi, callVolume, putVolume } = computeOiVolumeTotals(quotes);
    return {
        byOi: callOi === 0 ? null : putOi / callOi,
        byVolume: callVolume === 0 ? null : putVolume / callVolume,
    };
}

/**
 * Convenience wrapper (section 7.7): the single function views call. Builds the
 * profile, then gamma flip, walls, max pain and put/call ratios.
 *
 * `spot` is the reference price computeGexProfile falls back to for any quote
 * without its own `forward`, and the anchor findNetGexLevels' second-wall
 * distance rule measures from (see both functions' doc comments). For the
 * SPX-family path this is the true spot; for a futures-priced symbol whose
 * quotes carry per-expiration forwards, the caller passes a forward instead
 * (src/use-gex-levels.ts) - this function itself does not need to know which.
 */
/**
 * Trim the all-zero boundary strikes off each edge of a profile-like array,
 * independently per edge (GEX tab chart display, section 8.1 part 3 - NOT
 * part of the GEX math itself, just how much of it the chart draws). A
 * strike counts as "zero" only when every one of the given `keys` reads 0
 * there - normally whichever metrics are currently selected on the chart, so
 * toggling a metric on/off changes which fields count and can move the trim.
 *
 * Per edge: find the outermost strike (closest to either end) where at least
 * one of `keys` is non-zero, then keep exactly ONE further all-zero strike
 * beyond it as a single boundary/edge marker, and drop everything past that.
 *
 * Example (SPX, right edge): if 8175 is the first strike where every
 * selected metric reads 0 and stays 0 all the way out, 8175 is kept as the
 * last visible strike and everything past it is cut. Mirror case on the left
 * edge: if 7025 is the lowest strike with a non-zero value, the single
 * all-zero strike immediately below 7025 is kept and nothing further down.
 *
 * `points` must already be sorted ascending by strike (as computeGexProfile
 * returns). Fewer than 2 points, or no `keys`, is returned unchanged (nothing
 * meaningful to trim). A profile that is all-zero across `keys` returns an
 * empty array - the pathological/empty case the caller renders as "no data"
 * rather than a dead zero-padded chart.
 */
export function trimZeroBoundaries<T extends { strike: number }>(
    points: readonly T[],
    keys: readonly (keyof T)[],
): T[] {
    if (points.length < 2 || keys.length === 0) return [...points];
    const isZero = (p: T) => keys.every((k) => {
        const v = p[k];
        return typeof v !== 'number' || v === 0;
    });
    let firstNonZero = -1;
    for (let i = 0; i < points.length; i++) {
        if (!isZero(points[i])) { firstNonZero = i; break; }
    }
    if (firstNonZero === -1) return []; // everything zero across the selected keys
    let lastNonZero = points.length - 1;
    for (let i = points.length - 1; i >= 0; i--) {
        if (!isZero(points[i])) { lastNonZero = i; break; }
    }
    const start = Math.max(0, firstNonZero - 1);
    const end = Math.min(points.length - 1, lastNonZero + 1);
    return points.slice(start, end + 1);
}

/**
 * "Max AG": the strike with the largest absolute gamma exposure (`absGamma` of the profile: the call and the put gamma
 * exposures both taken as positive and added), that is where the most hedging per 1% move sits, whatever its direction.
 * ORIGINAL definition, a plain argmax with no published standard behind it. Ties go to the lowest strike (the same rule as
 * Max Net GEX and Min Net GEX). Null for an empty profile or when no strike has any absolute gamma. The profile already
 * reflects the selected expirations.
 */
export function findMaxAbsGamma(profile: readonly GexPoint[]): number | null {
    let best: GexPoint | null = null;
    for (const point of profile) {
        if (!(point.absGamma > 0)) continue;
        if (best === null || point.absGamma > best.absGamma || (point.absGamma === best.absGamma && point.strike < best.strike)) best = point;
    }
    return best ? best.strike : null;
}

export interface ZeroGexLevel {
    /** The first strike of the other sign (the line of the Zero GEX level). Null when there is no sign change. */
    zeroGex: number | null;
    /** The band between the last strike of the starting sign and the first strike of the other sign. Null with zeroGex. */
    zeroGexZone: ZeroGexZone | null;
}

/**
 * "Zero GEX" - the OWNER'S OWN METHOD (2026-10-25), not a published standard and NOT the Gamma Flip: Gamma Flip
 * (findGammaFlipHypotheticalSpot) re-prices the whole book at hypothetical spots, this one only reads the sign pattern of
 * the per-strike Net GEX profile at the real spot. Both are shown, side by side, as separate levels.
 *
 *  - Total Net GEX > 0: start at the Max Net GEX strike (largest positive netGex, ties to the lowest strike) and walk DOWN
 *    towards the Min Net GEX strike; every step from a positive strike to a negative one is a candidate
 *  - Total Net GEX < 0: start at the Min Net GEX strike (most negative netGex, ties to the lowest strike) and walk UP
 *    towards the Max Net GEX strike; every step from a negative strike to a positive one is a candidate
 *  - the walk ends at that opposite wall (inclusive); when the opposite wall is not in the walking direction (or there is
 *    none) it runs to the end of the chain
 *  - no noise threshold (owner: "first bar of the other sign"); a strike with netGex exactly 0 is neither sign and is
 *    walked over
 *  - one candidate: that one. Several (owner 2026-10-25): the one whose two strikes have the highest AVERAGE Absolute
 *    Gamma (absGamma, the strongest hedging zone); a tie goes to the one nearest to the starting wall (met first). SPX
 *    2026-10-23, first 5 expirations: 7710/7715 (0.50B), 7750/7755 (1.58B), 7760/7765 (0.43B) -> 7750/7755
 *
 * `zeroGex` (the LINE) is the candidate's strike of the other sign: a real strike, the one the owner's rule names, so the
 * LEFT (lower) strike of the zone with a positive total and the RIGHT (upper) one with a negative total. The ZONE (the
 * AREA) spans from it to the last strike of the starting sign met before it (the neighbouring strike, or further when
 * zero strikes sit between them). Null when the total is 0, the profile is empty, or the walk finds no sign change.
 * `profile` must be sorted ascending by strike (computeGexProfile's order).
 */
export function findZeroGex(profile: readonly GexPoint[], totalNetGex: number): ZeroGexLevel {
    const none: ZeroGexLevel = { zeroGex: null, zeroGexZone: null };
    if (!(totalNetGex > 0) && !(totalNetGex < 0)) return none;
    const sign = totalNetGex > 0 ? 1 : -1;
    // the starting wall: the largest sign * netGex; the opposite wall: the largest -sign * netGex (ties to the lowest strike)
    let start = -1;
    let opposite = -1;
    for (let i = 0; i < profile.length; i++) {
        const v = sign * profile[i].netGex;
        if (v > 0 && (start < 0 || v > sign * profile[start].netGex)) start = i;
        if (v < 0 && (opposite < 0 || v < sign * profile[opposite].netGex)) opposite = i;
    }
    if (start < 0) return none;
    const step = sign > 0 ? -1 : 1; // positive total walks down, negative total walks up
    const end = opposite >= 0 && (opposite - start) * step > 0 ? opposite : step > 0 ? profile.length - 1 : 0;
    let best: { other: number; same: number; ag: number } | null = null;
    let lastSame = start;
    let inSame = true; // the last signed strike met was of the starting sign
    for (let i = start + step; step > 0 ? i <= end : i >= end; i += step) {
        const v = sign * profile[i].netGex;
        if (v > 0) { lastSame = i; inSame = true; continue; }
        if (v < 0) {
            if (inSame) {
                const ag = (profile[i].absGamma + profile[lastSame].absGamma) / 2;
                if (best === null || ag > best.ag) best = { other: i, same: lastSame, ag };
            }
            inSame = false;
        }
    }
    if (!best) return none;
    const other = profile[best.other].strike;
    const same = profile[best.same].strike;
    return { zeroGex: other, zeroGexZone: { low: Math.min(other, same), high: Math.max(other, same) } };
}

/** Steps of the Sigma levels: 1, 2 and 3 sigma (or 1%, 2%, 3% in the % mode), above and below spot. */
export const SIGMA_STEPS = [1, 2, 3] as const;

/** One step of the % mode: 1% of spot (the owner's "1σ" of that mode, a plain distance, not a statistical sigma). */
export const SIGMA_PCT_STEP = 0.01;

/**
 * The nearest strike to `price` among `strikes` (any order); ties go to the LOWER strike, like pointAtPrice. Null when
 * there is no finite strike or the price is not finite.
 */
export function nearestStrikeTo(strikes: readonly number[], price: number): number | null {
    if (!Number.isFinite(price)) return null;
    let best: number | null = null;
    for (const k of strikes) {
        if (!Number.isFinite(k)) continue;
        if (best === null) { best = k; continue; }
        const d = Math.abs(k - price);
        const bd = Math.abs(best - price);
        if (d < bd || (d === bd && k < best)) best = k;
    }
    return best;
}

/** Distinct finite strikes of the quotes, ascending. */
function strikesOf(quotes: readonly OptionQuote[]): number[] {
    return Array.from(new Set(quotes.map((q) => q.strike).filter((k) => Number.isFinite(k)))).sort((a, b) => a - b);
}

/**
 * ATM implied volatility of ONE expiration at `spot` (used by the statistical Sigma levels):
 *  1. per strike, the mean of the call IV and the put IV (either alone when the other is missing); an IV counts only when
 *     it is finite and >= GAMMA_FLIP_MIN_IV (5%), which drops CBOE's failed-solve placeholders (see that constant)
 *  2. linear interpolation in strike between the nearest strike with an IV at or below spot and the nearest at or above it;
 *     spot outside the strikes with an IV takes the IV of the closest one
 * Null when no quote of `quotes` has a usable IV. The caller passes the quotes of a single expiration.
 */
export function atmImpliedVol(quotes: readonly OptionQuote[], spot: number): number | null {
    if (!Number.isFinite(spot)) return null;
    const byStrike = new Map<number, { sum: number; n: number }>();
    for (const q of quotes) {
        if (typeof q.iv !== 'number' || !Number.isFinite(q.iv) || q.iv < GAMMA_FLIP_MIN_IV || !Number.isFinite(q.strike)) continue;
        const e = byStrike.get(q.strike) ?? { sum: 0, n: 0 };
        e.sum += q.iv;
        e.n += 1;
        byStrike.set(q.strike, e);
    }
    const points = Array.from(byStrike.entries()).map(([k, e]) => ({ k, iv: e.sum / e.n })).sort((a, b) => a.k - b.k);
    if (points.length === 0) return null;
    let lo: { k: number; iv: number } | null = null;
    let hi: { k: number; iv: number } | null = null;
    for (const p of points) {
        if (p.k <= spot) lo = p;
        if (p.k >= spot && hi === null) hi = p;
    }
    if (lo && hi) return hi.k === lo.k ? lo.iv : lo.iv + ((spot - lo.k) * (hi.iv - lo.iv)) / (hi.k - lo.k);
    return (lo ?? hi)!.iv;
}

/** An IV the Gamma Flip sweep and the ATM IV accept: finite and at least GAMMA_FLIP_MIN_IV. */
function hasUsableIv(q: Pick<OptionQuote, 'iv'>): boolean {
    return typeof q.iv === 'number' && Number.isFinite(q.iv) && q.iv >= GAMMA_FLIP_MIN_IV;
}

/** Priced off its own futures curve (VIX, VXN): kept out of the sweep and of the IV repair. */
function isForwardPriced(q: Pick<OptionQuote, 'forward'>): boolean {
    return typeof q.forward === 'number' && Number.isFinite(q.forward) && q.forward > 0;
}

/**
 * Replaces failed-solve IVs (null or below GAMMA_FLIP_MIN_IV) so the Gamma Flip sweep and the ATM IV of the Sigma
 * levels can use those quotes (owner-approved 2026-10-25, our own repair, not a published method). Evidence: the cached
 * SPX chain of 2026-10-23 had IV 1e-5 .. 0.004 on every strike within +/-3% of spot in its first 5 expirations while the
 * CBOE gamma was sane (0.0022 at the money), so only 866 of 1955 quotes reached the sweep and the flip came from far
 * out-of-the-money noise. Per expiration, for each quote whose IV is not usable (futures-priced quotes are left alone):
 *  1. `smile`: linear interpolation in strike between the nearest strikes BELOW and ABOVE with a usable IV on the same
 *     side (no extrapolation)
 *  2. `otherSide`: the usable IV of the other side at the same strike
 *  3. `gamma`: the IV whose Black-Scholes gamma at spot equals the quote's provider gamma (greeks.ts impliedVolFromGamma),
 *     the root nearest to the expiration's ATM IV (atmImpliedVol of the usable IVs, else the gamma-implied IV of the
 *     strike nearest to spot, a single root at the money; a chain with no strike near spot can pick the wrong one of two
 *     roots out of the money, see impliedVolFromGamma)
 *  otherwise the quote stays as it is. Only the RETURNED copies change (`iv` replaced, `ivRepair` says how); the input
 * is never mutated and the provider gamma, used by every other level, is untouched. `now` is for tests.
 */
export function repairImpliedVols(quotes: readonly OptionQuote[], spot: number, now?: Date): OptionQuote[] {
    const out = quotes.slice();
    if (!Number.isFinite(spot) || spot <= 0) return out;
    const byExp = new Map<string, number[]>();
    quotes.forEach((q, i) => {
        const list = byExp.get(q.expiration);
        if (list) list.push(i); else byExp.set(q.expiration, [i]);
    });
    byExp.forEach((idx, expiration) => {
        const group = idx.map((i) => quotes[i]);
        const broken = idx.filter((i) => !hasUsableIv(quotes[i]) && !isForwardPriced(quotes[i]) && Number.isFinite(quotes[i].strike));
        if (broken.length === 0) return;
        // usable IVs of this expiration, per side, ascending by strike, and by strike for the other-side lookup
        const valid: Record<'call' | 'put', Array<{ k: number; iv: number }>> = { call: [], put: [] };
        const atStrike: Record<'call' | 'put', Map<number, number>> = { call: new Map(), put: new Map() };
        for (const q of group) {
            if (!hasUsableIv(q) || isForwardPriced(q) || !Number.isFinite(q.strike)) continue;
            valid[q.side].push({ k: q.strike, iv: q.iv as number });
            atStrike[q.side].set(q.strike, q.iv as number);
        }
        valid.call.sort((a, b) => a.k - b.k);
        valid.put.sort((a, b) => a.k - b.k);
        const years = now ? yearsToExpiration(expiration, now) : yearsToExpiration(expiration);
        let ref: number | null | undefined; // the expiration's ATM IV for the gamma inversion, found on first need
        const refVol = (): number | null => {
            if (ref !== undefined) return ref;
            ref = atmImpliedVol(group, spot);
            if (ref === null && years !== null) {
                // no usable IV at all: the gamma-implied IV at the strike nearest to spot (one root there)
                const nearest = nearestStrikeTo(group.map((q) => q.strike), spot);
                const ivs = group
                    .filter((q) => q.strike === nearest && typeof q.gamma === 'number' && q.gamma > 0)
                    .map((q) => impliedVolFromGamma(spot, q.strike, years, q.gamma as number))
                    .filter((v): v is number => v !== null);
                ref = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
            }
            return ref;
        };
        for (const i of broken) {
            const q = quotes[i];
            let iv: number | null = null;
            let how: IvRepair | null = null;
            const side = valid[q.side];
            let lo: { k: number; iv: number } | null = null;
            let hi: { k: number; iv: number } | null = null;
            for (const p of side) {
                if (p.k < q.strike) lo = p;
                else if (p.k > q.strike) { hi = p; break; }
            }
            if (lo && hi) {
                iv = lo.iv + ((q.strike - lo.k) * (hi.iv - lo.iv)) / (hi.k - lo.k);
                how = 'smile';
            } else {
                const other = atStrike[q.side === 'call' ? 'put' : 'call'].get(q.strike);
                if (other !== undefined) {
                    iv = other;
                    how = 'otherSide';
                } else if (years !== null && typeof q.gamma === 'number' && q.gamma > 0) {
                    iv = impliedVolFromGamma(spot, q.strike, years, q.gamma, refVol());
                    how = iv === null ? null : 'gamma';
                }
            }
            if (iv !== null && how !== null) out[i] = { ...q, iv, ivRepair: how };
        }
    });
    return out;
}

/** Half-width of the window around spot, as a share of spot, where the IV coverage of the Gamma Flip is measured. */
export const GAMMA_FLIP_COVERAGE_WINDOW_PCT = 0.02;

/** Minimum share of the provider |GEX| near spot the sweep must see through valid or repaired IVs to show a Gamma Flip. */
export const GAMMA_FLIP_MIN_IV_COVERAGE = 0.8;

/**
 * Share (0..1) of the provider |GEX| (provider gamma x OI x 100 x spot^2 x 0.01, calls and puts as absolute values) of
 * the quotes within GAMMA_FLIP_COVERAGE_WINDOW_PCT of spot that belongs to quotes with a usable IV, i.e. what the
 * Black-Scholes sweep of the Gamma Flip can see of the real gamma there. Pass the REPAIRED quotes. Futures-priced quotes
 * and quotes without a provider gamma or OI are left out; null when nothing is left (nothing to compare). Our own gate
 * (owner-approved 2026-10-25): below GAMMA_FLIP_MIN_IV_COVERAGE the flip would come from the few quotes the sweep sees.
 */
export function ivCoverageNearSpot(quotes: readonly OptionQuote[], spot: number): number | null {
    if (!Number.isFinite(spot) || spot <= 0) return null;
    const window = spot * GAMMA_FLIP_COVERAGE_WINDOW_PCT;
    let total = 0;
    let covered = 0;
    for (const q of quotes) {
        if (isForwardPriced(q) || !(Math.abs(q.strike - spot) <= window)) continue;
        const oi = finiteOr0(q.openInterest);
        if (oi <= 0 || typeof q.gamma !== 'number' || !Number.isFinite(q.gamma)) continue;
        const v = Math.abs(gexCall(q.gamma, oi, spot));
        total += v;
        if (hasUsableIv(q)) covered += v;
    }
    return total > 0 ? covered / total : null;
}

/**
 * Sigma levels (Chart tab and GEX chart), both modes, from the strikes of `quotes` (the selected expirations). ORIGINAL,
 * owner-requested heuristics, not published levels:
 *  - % mode: strike nearest to spot * (1 + side * n * 1%), n = 1, 2, 3. A % distance, NOT a statistical sigma
 *  - statistical mode: 1σ = spot * ATM IV * sqrt(T), T = years to the NEAREST given expiration that is not expired and
 *    has a usable ATM IV (yearsToExpiration: real time to the 16:00 New York settlement, 15-minute floor), the strike nearest to
 *    spot + side * n * 1σ. The textbook one-standard-deviation move of a lognormal price at that IV, approximated as
 *    linear in price (no drift, no skew)
 * Levels are ordered +1, +2, +3, -1, -2, -3. Null when there is no strike or no valid spot. `now` is for tests.
 */
export function computeSigmaLevels(quotes: readonly OptionQuote[], spot: number, now?: Date): SigmaLevels | null {
    if (!Number.isFinite(spot) || spot <= 0) return null;
    const strikes = strikesOf(quotes);
    if (strikes.length === 0) return null;
    const ladder = (step: number): SigmaLevel[] => {
        const out: SigmaLevel[] = [];
        for (const side of [1, -1] as const) {
            for (const n of SIGMA_STEPS) {
                const price = spot + side * n * step;
                out.push({ n, side, price, strike: nearestStrikeTo(strikes, price) as number });
            }
        }
        return out;
    };
    let statBasis: SigmaStatBasis | null = null;
    const expirations = Array.from(new Set(quotes.map((q) => q.expiration))).sort();
    for (const expiration of expirations) {
        const years = now ? yearsToExpiration(expiration, now) : yearsToExpiration(expiration);
        if (years == null) continue;
        const iv = atmImpliedVol(quotes.filter((q) => q.expiration === expiration), spot);
        if (iv == null) continue;
        statBasis = { expiration, iv, days: years * 365, move: spot * iv * Math.sqrt(years) };
        break;
    }
    return { pct: ladder(spot * SIGMA_PCT_STEP), stat: statBasis ? ladder(statBasis.move) : null, statBasis };
}

export function computeGexLevels(quotes: readonly OptionQuote[], spot: number, symbol?: string | null): GexLevels {
    const profile = computeGexProfile(quotes, spot);
    const walls = findNetGexLevels(profile, spot, netGexPlusMinusMinDistance(symbol, spot));
    const pcr = computePCRatio(quotes);
    // Gamma flip (section 7.3): hypothetical-spot Black-Scholes recompute
    // against the RAW quotes, not the real-spot profile - see
    // findGammaFlipHypotheticalSpot's doc comment for why.
    // failed-solve IVs repaired first (repairImpliedVols), for the sweep and the ATM IV of Sigma; the provider gamma of
    // every other level is untouched
    const repaired = repairImpliedVols(quotes, spot);
    // GEX-H5: no sweep at all for a futures-priced symbol (VIX, VXN). The sweep is Black-Scholes around one spot and skips
    // every quote with a `forward`, so it only ever saw the quotes of expirations whose forward did NOT resolve, with the
    // provider's spot-model IVs: a flip from those alone is wrong, and a flip from Black-76 forwards is not implemented
    const futuresPriced = isFuturesPricedSymbol(symbol);
    const crossings = futuresPriced ? [] : gammaFlipSweepCrossings(repaired, spot);
    const { pos: gammaFlipPos, neg: gammaFlipNeg } = crossingsByDirection(crossings);
    const totalNetGex = profile.reduce((sum, point) => sum + point.netGex, 0);
    // the sweep must see most of the real gamma near spot, else no flip (ivCoverageNearSpot)
    const gammaFlipIvCoverage = futuresPriced ? null : ivCoverageNearSpot(repaired, spot);
    const gammaFlipUnavailable: GexLevels['gammaFlipUnavailable'] = futuresPriced
        ? 'futuresPriced'
        : gammaFlipIvCoverage !== null && gammaFlipIvCoverage < GAMMA_FLIP_MIN_IV_COVERAGE ? 'ivCoverage' : null;
    // GEX-M2: the only crossing, or the one nearest to spot (see nearestGammaFlip)
    const gammaFlip = gammaFlipUnavailable ? null : nearestGammaFlip(crossings, spot);
    return {
        spot,
        gammaFlip,
        gammaFlipPos,
        gammaFlipNeg,
        gammaFlipIvCoverage,
        gammaFlipUnavailable,
        ...walls,
        ...findSumNetGexLevels(profile, spot),
        maxPain: computeMaxPain(quotes),
        maxAbsGamma: findMaxAbsGamma(profile),
        // Zero GEX: the owner's own per-strike sign-change method, an ADDITIONAL level next to the Gamma Flip above
        ...findZeroGex(profile, totalNetGex),
        // Sigma: strikes at +/- 1, 2, 3 % of spot and at +/- 1, 2, 3 statistical sigma (both modes, the UI picks one)
        sigma: computeSigmaLevels(repaired, spot),
        pcRatioOi: pcr.byOi,
        pcRatioVolume: pcr.byVolume,
        totalNetGex,
    };
}

// ---------------------------------------------------------------------------
// BOARD (the Board tab, owner 2026-10-25): one row per strike of the selected expirations
// ---------------------------------------------------------------------------

/** One strike of the Board. Money columns are $ (GEX per 1% move, delta notional), counts are contracts. */
export interface BoardRow {
    strike: number;
    /** Net GEX: gexCall + gexPut of every quote at this strike (calls +, puts -), quotes with a null gamma left out. */
    netGex: number;
    /** Abs GEX: |call GEX| + |put GEX| (the Absolute Gamma of the GEX tab, no netting). */
    absGex: number;
    /**
     * Notional delta, OUR OWN DEFINITION (not a published metric): the dealer delta exposure in $ under the same dealer
     * positioning gexCall / gexPut assume (long the calls, short the puts): sum of delta x OI x 100 x spot for calls minus
     * the same for puts (a put delta is negative, so both sides add up as the dealer's long delta). Quotes with a null
     * delta are left out. Futures-priced quotes use their own forward like computeGexProfile.
     */
    notionalDelta: number;
    callOi: number;
    putOi: number;
    totalOi: number;
    callVolume: number;
    putVolume: number;
    totalVolume: number;
    /** % column: this strike's Abs GEX as a share (0..1) of the Abs GEX of all strikes; 0 when that total is 0. */
    absGexShare: number;
}

/** Columns of the Board that get a peak dot. */
export type BoardColumn = 'netGex' | 'absGex' | 'notionalDelta' | 'totalOi' | 'callOi' | 'putOi' | 'totalVolume' | 'callVolume' | 'putVolume' | 'absGexShare';

export const BOARD_COLUMNS: readonly BoardColumn[] = ['netGex', 'absGex', 'notionalDelta', 'totalOi', 'callOi', 'putOi', 'totalVolume', 'callVolume', 'putVolume', 'absGexShare'];

export interface Board {
    /** ascending by strike */
    rows: BoardRow[];
    /**
     * The peak strikes of each column: the strike with the largest value (only when it is > 0). Net GEX has two, the
     * largest positive and the most negative strike (its two walls, the Max / Min Net GEX of the levels). Ties go to the
     * lowest strike, like the rest of gex.
     */
    peaks: Record<BoardColumn, number[]>;
    /** The strike nearest to spot (ties to the lower), null without rows or spot. */
    atmStrike: number | null;
}

/**
 * The Board of `quotes` (the selected expirations) at `spot` in ONE pass over the quotes plus one over the strikes
 * (pure; the 30k-quote chains stay fast, the caller memoizes). OI and volume count every quote, the money columns only
 * quotes with the greek they need (null gamma / delta left out, never read as 0).
 */
export function computeBoard(quotes: readonly OptionQuote[], spot: number): Board {
    const byStrike = new Map<number, BoardRow & { callGex: number; putGex: number }>();
    for (const q of quotes) {
        if (!Number.isFinite(q.strike)) continue;
        let row = byStrike.get(q.strike);
        if (!row) {
            row = { strike: q.strike, netGex: 0, absGex: 0, notionalDelta: 0, callOi: 0, putOi: 0, totalOi: 0, callVolume: 0, putVolume: 0, totalVolume: 0, absGexShare: 0, callGex: 0, putGex: 0 };
            byStrike.set(q.strike, row);
        }
        const oi = finiteOr0(q.openInterest);
        const volume = finiteOr0(q.volume);
        const ref = isForwardPriced(q) ? (q.forward as number) : spot;
        const hasGamma = typeof q.gamma === 'number' && Number.isFinite(q.gamma);
        const hasDelta = typeof q.delta === 'number' && Number.isFinite(q.delta);
        if (q.side === 'call') {
            row.callOi += oi;
            row.callVolume += volume;
            if (hasGamma) row.callGex += gexCall(q.gamma as number, oi, ref);
            if (hasDelta) row.notionalDelta += (q.delta as number) * oi * CONTRACT_MULTIPLIER * ref;
        } else {
            row.putOi += oi;
            row.putVolume += volume;
            if (hasGamma) row.putGex += gexPut(q.gamma as number, oi, ref);
            if (hasDelta) row.notionalDelta -= (q.delta as number) * oi * CONTRACT_MULTIPLIER * ref;
        }
    }
    const rows: BoardRow[] = [];
    let absTotal = 0;
    for (const r of Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike)) {
        const { callGex, putGex, ...row } = r;
        row.netGex = callGex + putGex;
        row.absGex = callGex - putGex;
        row.totalOi = row.callOi + row.putOi;
        row.totalVolume = row.callVolume + row.putVolume;
        absTotal += row.absGex;
        rows.push(row);
    }
    const peaks = {} as Record<BoardColumn, number[]>;
    for (const c of BOARD_COLUMNS) peaks[c] = [];
    const best = {} as Record<BoardColumn, BoardRow | null>;
    let netMin: BoardRow | null = null;
    for (const row of rows) {
        row.absGexShare = absTotal > 0 ? row.absGex / absTotal : 0;
        for (const c of BOARD_COLUMNS) {
            const b = best[c] ?? null;
            if (row[c] > 0 && (b === null || row[c] > b[c])) best[c] = row;
        }
        if (row.netGex < 0 && (netMin === null || row.netGex < netMin.netGex)) netMin = row;
    }
    for (const c of BOARD_COLUMNS) {
        const b = best[c] ?? null;
        if (b) peaks[c].push(b.strike);
    }
    if (netMin) peaks.netGex.push(netMin.strike);
    return { rows, peaks, atmStrike: Number.isFinite(spot) ? nearestStrikeTo(rows.map((r) => r.strike), spot) : null };
}

/**
 * Share (0..1) of each expiration in the total open interest of ALL the given (loaded) expirations, for the Board's
 * expiration chips. Expirations with no OI get 0; all 0 when there is no OI at all.
 */
export function expirationOiShares(quotesByExp: Readonly<Record<string, readonly OptionQuote[]>>): Record<string, number> {
    const sums: Record<string, number> = {};
    let total = 0;
    for (const exp of Object.keys(quotesByExp)) {
        let s = 0;
        for (const q of quotesByExp[exp]) s += finiteOr0(q.openInterest);
        sums[exp] = s;
        total += s;
    }
    const out: Record<string, number> = {};
    for (const exp of Object.keys(sums)) out[exp] = total > 0 ? sums[exp] / total : 0;
    return out;
}
