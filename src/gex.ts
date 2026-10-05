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

/**
 * Gamma flip via the "cumulative net GEX crosses zero" approach (section 7.3).
 * Returns the strike where cumulative netGex is exactly 0, or the linear
 * interpolation between the two strikes where it first changes sign. Returns
 * null if it never changes sign - never extrapolates outside the strike range.
 * Expects a profile sorted ascending by strike (as computeGexProfile returns).
 * Signature kept stable so a hypothetical-spot recompute (approach B, out of
 * scope for v1) can replace the internals later without touching callers.
 *
 * The "exactly 0" rule only applies once some exposure has accumulated: real
 * chains (CBOE) report gamma 0 for far-from-the-money strikes, so the lowest
 * strikes often have netGex exactly 0. A leading run of zero cumulative is
 * "nothing yet", not a crossing - treating it as one put the flip at the
 * lowest listed strike (e.g. 550 for SPY at spot ~770).
 */
export function findGammaFlip(profile: readonly GexPoint[]): number | null {
    let cumulative = 0;
    let accumulated = false;
    for (let i = 0; i < profile.length; i++) {
        cumulative += profile[i].netGex;
        if (cumulative === 0 && accumulated) return profile[i].strike;
        if (cumulative !== 0) accumulated = true;
        if (i + 1 >= profile.length) break;
        const next = cumulative + profile[i + 1].netGex;
        if ((cumulative < 0 && next > 0) || (cumulative > 0 && next < 0)) {
            const k0 = profile[i].strike;
            const k1 = profile[i + 1].strike;
            return k0 + (k1 - k0) * (0 - cumulative) / (next - cumulative);
        }
    }
    return null;
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
    return {
        spot,
        gammaFlip: findGammaFlip(profile),
        ...walls,
        maxPain: computeMaxPain(quotes),
        pcRatioOi: pcr.byOi,
        pcRatioVolume: pcr.byVolume,
        totalNetGex: profile.reduce((sum, point) => sum + point.netGex, 0),
    };
}
