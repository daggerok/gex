import { blackScholesGreeks } from './greeks';
import type { GexLevels, GexPoint, OptionQuote } from './types';

// ---------------------------------------------------------------------------
// Gamma exposure (GEX) math - SINGLE SOURCE OF TRUTH for GEX-derived levels
// ---------------------------------------------------------------------------
// Spec: agentic-workspace docs/repos/gex/spec-gex-app.md section 7. Pure functions, zero
// React/DOM dependencies. Never duplicate any of this in scripts/options-data.py
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

/** Resolved minimum second-wall distance in price units for `symbol` at `spot`. */
export function netGexPlusMinusMinDistance(symbol: string | null | undefined, spot: number): number {
    const rule = symbol ? NET_GEX_PLUS_MINUS_DISTANCE_BY_SYMBOL[symbol.toUpperCase()] : undefined;
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
    const profile = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
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
 *     THAT S (blackScholesGreeks(q, S) - reusing the existing, already-
 *     tested function from src/greeks.ts, not a new gamma-only formula).
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
 * Known simplification: blackScholesGreeks is called with its own default
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
    if (!Number.isFinite(spot) || spot <= 0) return { pos: null, neg: null };
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
    if (eligible.length === 0) return { pos: null, neg: null };

    const low = spot * (1 - GAMMA_FLIP_RANGE_PCT);
    const high = spot * (1 + GAMMA_FLIP_RANGE_PCT);
    const step = (high - low) / (GAMMA_FLIP_GRID_POINTS - 1);

    const grid: { S: number; total: number }[] = [];
    for (let i = 0; i < GAMMA_FLIP_GRID_POINTS; i++) {
        const S = i === GAMMA_FLIP_GRID_POINTS - 1 ? high : low + step * i;
        let total = 0;
        for (const quote of eligible) {
            const oi = finiteOr0(quote.openInterest);
            if (oi === 0) continue;
            const { greeks } = blackScholesGreeks(quote, S);
            if (!greeks) continue;
            total += quote.side === 'call'
                ? gexCall(greeks.gamma, oi, S)
                : gexPut(greeks.gamma, oi, S);
        }
        grid.push({ S, total });
    }

    let pos: number | null = null;
    let neg: number | null = null;
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
            if (sign === 1) pos = crossing; else neg = crossing;
        }
        pendingZeroS = [];
        prevSign = sign;
        prevNonZero = point;
    }

    return { pos, neg };
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
    const strikes = [...new Set(quotes.map((q) => q.strike).filter((k) => Number.isFinite(k)))].sort((a, b) => a - b);
    let best: number | null = null;
    let bestPayout = Infinity;
    for (const s of strikes) {
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

export function computeGexLevels(quotes: readonly OptionQuote[], spot: number, symbol?: string | null): GexLevels {
    const profile = computeGexProfile(quotes, spot);
    const walls = findNetGexLevels(profile, spot, netGexPlusMinusMinDistance(symbol, spot));
    const pcr = computePCRatio(quotes);
    // Gamma flip (section 7.3): hypothetical-spot Black-Scholes recompute
    // against the RAW quotes, not the real-spot profile - see
    // findGammaFlipHypotheticalSpot's doc comment for why.
    const { pos: gammaFlipPos, neg: gammaFlipNeg } = findGammaFlipHypotheticalSpot(quotes, spot);
    const totalNetGex = profile.reduce((sum, point) => sum + point.netGex, 0);
    // Legacy single-field collapse - see GexLevels.gammaFlip's doc comment
    // for the full rule (totalNetGex-sign tie-break, temporary placeholder
    // when both gammaFlipPos and gammaFlipNeg are non-null).
    const gammaFlip = totalNetGex > 0 ? gammaFlipPos : gammaFlipNeg;
    return {
        spot,
        gammaFlip,
        gammaFlipPos,
        gammaFlipNeg,
        ...walls,
        ...findSumNetGexLevels(profile, spot),
        maxPain: computeMaxPain(quotes),
        pcRatioOi: pcr.byOi,
        pcRatioVolume: pcr.byVolume,
        totalNetGex,
    };
}
