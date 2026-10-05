import type { GexLevels, GexPoint, OptionQuote } from './types';

// ---------------------------------------------------------------------------
// Gamma exposure (GEX) math - SINGLE SOURCE OF TRUTH for GEX-derived levels
// ---------------------------------------------------------------------------
// Spec: .plans/gex-implementation-plan.txt section 7. Pure functions, zero
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
// Per-quote reference price (Phase 3 of .plans/gex-vix-futures-pricing-
// research.txt, section 9): for almost every symbol one shared `spot` is the
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
 * to qualify as the "second wall" (callWall2 / putWall2).
 * ORIGINAL, UNSOURCED heuristic: no public standard for a "second wall" exists.
 * It only makes the behavior deterministic and documented. Treat it as a
 * tunable constant, not an established rule - at a fixed 2% it behaves very
 * differently on $1 strike spacing than on $2.50/$5 spacing (plan section 17
 * item 6).
 */
export const SECOND_WALL_MIN_DISTANCE_PCT = 0.02;

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
            point = { strike: q.strike, callGex: 0, putGex: 0, netGex: 0, callOi: 0, putOi: 0, callVolume: 0, putVolume: 0 };
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
    for (const point of profile) point.netGex = point.callGex + point.putGex;
    return profile;
}

export interface GammaFlipCrossings {
    /** Last negative -> positive netGex transition (ascending by strike). Null if none. */
    pos: number | null;
    /** Last positive -> negative netGex transition (ascending by strike). Null if none. */
    neg: number | null;
}

/**
 * Gamma flip / "zero gamma level" (section 7.3, REDEFINED - see history
 * below): the strike(s) where the net GEX PROFILE ITSELF - the same
 * per-strike bars the chart draws - crosses from negative to positive or
 * vice versa. This is the standard public definition (e.g.
 * https://www.insiderfinance.io/resources/the-ultimate-guide-to-gamma-exposure-gex)
 * and matches the visual red/green flip on the rendered chart.
 *
 * ANCHORED TO REAL BARS, NEVER INTERPOLATED: each of `pos`/`neg` is always
 * the strike of an actual element of `profile` - one of the real bars the
 * chart draws - never a fractional value computed between two flanking
 * strikes. Concretely: `pos` is the strike of the POSITIVE bar that
 * immediately follows the last negative -> positive transition, and `neg`
 * is the strike of the NEGATIVE bar that immediately follows the last
 * positive -> negative transition. (An earlier version of this function
 * linearly interpolated a fractional strike between the two flanking bars -
 * e.g. it returned 7716.41 for a real SPX chain where the crossing is
 * between the 7715 (negative) and 7720 (positive) bars. That was wrong:
 * 7716.41 is not a real strike anyone trades or sees on the chart. The
 * correct value is the real bar, 7720, exactly as plotted.)
 *
 * HISTORY: an earlier version of this function computed a CUMULATIVE sum of
 * netGex walking up from the lowest strike and returned where THAT crossed
 * zero. That is a different quantity (closer to an integral of the profile)
 * and does not match the standard definition or the visual chart flip -
 * confirmed wrong against real cached data (SPX chain: old algorithm
 * returned ~7828, deep inside the positive region past the call wall, while
 * the profile's own sign literally flips at ~7716, right where the chart
 * visibly turns from red to green). This function now scans the profile
 * directly instead.
 *
 * Two directions, tracked separately (`GammaFlipCrossings`): a real chain
 * can have more than one sign change (e.g. a small isolated anomalous
 * strike or two sandwiched inside what's otherwise a clean transition, or a
 * wide/noisy "All expirations" selection with deep-ITM strikes far from
 * spot) - per the user's own definition: "gamma flip is the place where
 * last negative transferred to positive and vice versa - last positive
 * transferred to negative". So `findGammaFlipCrossings` walks the profile
 * once and keeps the LAST (highest-strike) transition in EACH direction
 * separately:
 *   - `pos`: the last negative -> positive transition anywhere in the chain
 *   - `neg`: the last positive -> negative transition anywhere in the chain
 * Either is `null` if that direction never occurs. A future UI change will
 * show both as "Gamma Flip +" / "Gamma Flip -" when both are non-null.
 *
 * `findGammaFlip` collapses the two into the single legacy value every
 * existing caller (GexLevels.gammaFlip, src/views/GexView.tsx) expects.
 * See its own doc comment for the current (totalNetGex-sign) collapse rule.
 *
 * Exact-zero rule (documented decision): a strike with netGex === 0 is
 * never interpolated against - it already reads zero, so if it sits between
 * a negative and a positive nonzero strike, IT is the crossing point itself
 * (its own strike - it's already a real bar in the profile, same as every
 * other case here). When a RUN of consecutive exact-zero strikes bridges a
 * sign change, the strike closest to the far side of the run (the one
 * immediately adjacent to the new nonzero point) is used as that crossing's
 * representative strike - any strike in the run reads exactly 0, so this is
 * just a deterministic, documented pick among otherwise-equivalent real
 * bars. A zero strike that does NOT bridge a sign change - flanked by the
 * same sign on both sides, or with no nonzero neighbor on one side at all -
 * is NOT a crossing. This is what keeps CBOE's "leading zero exposure" (far
 * OTM strikes reporting exact gamma 0) from being misread as a crossing at
 * the edge of the chain, exactly like the old cumulative algorithm's
 * leading-zero handling, but now applied symmetrically to both edges and to
 * zero runs anywhere in the profile, not just a leading run.
 *
 * Both `pos` and `neg` are null when the profile has no sign change at all
 * in that direction (including a uniformly one-sided or empty/all-zero
 * profile). Never extrapolates outside the strike range. Expects a profile
 * sorted ascending by strike (as computeGexProfile returns).
 *
 * `spot` is kept as a parameter (matching findCallPutWalls' house pattern of
 * taking spot explicitly, and computeGexLevels already has it on hand to
 * pass through) even though the "last crossing per direction" rule above
 * does not use it - it is intentionally unused by this function's current
 * selection logic, not a leftover from an earlier nearest-to-spot attempt.
 */
export function findGammaFlipCrossings(profile: readonly GexPoint[], spot: number): GammaFlipCrossings {
    void spot; // see doc comment: kept for signature consistency, unused by the "last crossing" rule
    let pos: number | null = null;
    let neg: number | null = null;
    let prevSign: -1 | 1 | null = null;
    let pendingZeroStrikes: number[] = [];

    for (const point of profile) {
        if (point.netGex === 0) {
            pendingZeroStrikes.push(point.strike);
            continue;
        }
        const sign: -1 | 1 = point.netGex > 0 ? 1 : -1;
        if (prevSign !== null && sign !== prevSign) {
            // The exact-zero strike(s) in between already read 0 and are
            // themselves real bars - the one closest to this new nonzero
            // point is the crossing's representative strike. Otherwise (no
            // zero run bridges it), the crossing IS this bar: the real,
            // actual-array-element strike immediately following the
            // transition - never a fractional value interpolated between
            // it and the previous bar.
            const crossing = pendingZeroStrikes.length > 0
                ? pendingZeroStrikes[pendingZeroStrikes.length - 1]
                : point.strike;
            if (sign === 1) pos = crossing; else neg = crossing;
        }
        // Same sign as before (or the first nonzero point seen): any zero
        // run just passed through was flat/leading noise, not a crossing.
        pendingZeroStrikes = [];
        prevSign = sign;
    }

    return { pos, neg };
}

/**
 * The single legacy gamma-flip value every existing caller (GexLevels.
 * gammaFlip, src/views/GexView.tsx) expects, collapsed from the
 * findGammaFlipCrossings pair per the user's own rule: "if we have 1 flip
 * level then we must use first positive bar if total net gex is positive
 * for selected expirations, and first negative strike if total net gex is
 * negative." Concretely: `totalNetGex > 0 ? pos : neg` - the same
 * profile.reduce((sum, p) => sum + p.netGex, 0) totalNetGex computeGexLevels
 * already computes.
 *
 * TEMPORARY PLACEHOLDER for the rare case where BOTH `pos` and `neg` are
 * non-null (a genuine two-crossing chain): this picks one side by
 * totalNetGex's sign, but which one "wins" there is not meaningfully
 * load-bearing long-term - a separate, already-planned follow-up PR
 * replaces all of GexView.tsx's consumption of this single field with the
 * `gammaFlipPos`/`gammaFlipNeg` pair directly, so the single-value collapse
 * only needs to be reasonable, not perfect, until then.
 */
export function findGammaFlip(profile: readonly GexPoint[], spot: number): number | null {
    const { pos, neg } = findGammaFlipCrossings(profile, spot);
    const totalNetGex = profile.reduce((sum, point) => sum + point.netGex, 0);
    return totalNetGex > 0 ? pos : neg;
}

export interface CallPutWalls {
    callWall: number | null;
    putWall: number | null;
    callWall2: number | null;
    putWall2: number | null;
}

/**
 * Call/put walls (section 7.4). The second-wall rule needs spot, so it is an
 * explicit parameter here.
 *  - callWall: strike with the maximum netGex among netGex > 0
 *  - putWall: strike with the minimum netGex among netGex < 0
 *  - callWall2 / putWall2: same, restricted to strikes at least
 *    SECOND_WALL_MIN_DISTANCE_PCT * spot away from the primary wall (an
 *    unsourced heuristic, see the constant's comment)
 * Ties on netGex resolve to the lowest strike (first in ascending order).
 *
 * `spot` here is just "the reference price the 2%-distance rule measures
 * from" - for a futures-priced symbol (VIX/VXN) there is no single spot in
 * the GEX-relevant sense once multiple expirations/forwards are in play, so
 * the caller (src/use-gex-levels.ts) passes the nearest selected
 * expiration's forward instead of the true spot index level (design
 * decision, Phase 3 of .plans/gex-vix-futures-pricing-research.txt section
 * 9: strikes live in futures-space for these symbols, so a futures-space
 * reference price makes the 2%-of-reference distance threshold meaningful;
 * the true spot VIX index is still shown separately in the UI).
 */
export function findCallPutWalls(profile: readonly GexPoint[], spot: number): CallPutWalls {
    const minDistance = SECOND_WALL_MIN_DISTANCE_PCT * spot;
    const pick = (sign: 1 | -1, awayFrom: number | null): number | null => {
        let best: GexPoint | null = null;
        for (const point of profile) {
            const signed = sign * point.netGex;
            if (!(signed > 0)) continue;
            if (awayFrom !== null && Math.abs(point.strike - awayFrom) < minDistance) continue;
            if (best === null || signed > sign * best.netGex) best = point;
        }
        return best ? best.strike : null;
    };
    const callWall = pick(1, null);
    const putWall = pick(-1, null);
    return {
        callWall,
        putWall,
        callWall2: callWall === null ? null : pick(1, callWall),
        putWall2: putWall === null ? null : pick(-1, putWall),
    };
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
 * without its own `forward`, and the anchor findCallPutWalls' second-wall
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

export function computeGexLevels(quotes: readonly OptionQuote[], spot: number): GexLevels {
    const profile = computeGexProfile(quotes, spot);
    const walls = findCallPutWalls(profile, spot);
    const pcr = computePCRatio(quotes);
    const { pos: gammaFlipPos, neg: gammaFlipNeg } = findGammaFlipCrossings(profile, spot);
    const totalNetGex = profile.reduce((sum, point) => sum + point.netGex, 0);
    // Legacy single-field collapse - see findGammaFlip's doc comment for the
    // full rule (totalNetGex-sign tie-break, temporary placeholder when both
    // gammaFlipPos and gammaFlipNeg are non-null).
    const gammaFlip = totalNetGex > 0 ? gammaFlipPos : gammaFlipNeg;
    return {
        spot,
        gammaFlip,
        gammaFlipPos,
        gammaFlipNeg,
        ...walls,
        maxPain: computeMaxPain(quotes),
        pcRatioOi: pcr.byOi,
        pcRatioVolume: pcr.byVolume,
        totalNetGex,
    };
}
