// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { useMemo } from 'react';
import { computeGexLevels } from './gex';
import { isFuturesPricedSymbol } from './greeks';
import type { GexLevels, OptionQuote } from './types';
import { estimateSpot } from './utils';

// ---------------------------------------------------------------------------
// Shared GEX levels (plan sections 7.7 / 8.2): the ONE place the app calls
// computeGexLevels(). App runs this hook once and passes the result to both
// the GEX tab (Key Levels card, wall reference lines) and the Chart tab
// (price lines), so the two tabs always show the same numbers. Neither view
// recomputes levels itself (rule R1).
//
// Phase 3 of .claude/docs/spec-vix-futures.md (section 9): a
// futures-priced symbol (VIX/VXN, isFuturesPricedSymbol) used to ALWAYS get
// `levels: null` here, regardless of settings.vixFuturesPricing. Now it only
// stays null when real levels genuinely aren't available for it - the toggle
// is off, or it's on but none of the selected quotes resolved a `forward`
// (Black-76 enrichment failed for all of them, e.g. a sparse weekly with no
// two-sided quotes). When at least one selected quote has a `forward`, real
// levels are computed via src/gex.ts exactly like any other symbol - see
// computeGexProfile's per-quote `q.forward ?? spot` handling there.
// ---------------------------------------------------------------------------

/**
 * Section 9 design decision, pure + independently testable (see
 * use-gex-levels.test.ts): for a futures-priced symbol there is no single
 * "spot" in the GEX-relevant sense once multiple expirations (each with its
 * own forward) are in play. computeGexProfile already uses each quote's OWN
 * `forward` in place of the shared `spot` argument (src/gex.ts), so this
 * value only matters as (a) the fallback for any quote lacking a `forward`
 * and (b) the anchor for findCallPutWalls' 2%-distance rule - for those, the
 * nearest SELECTED expiration's own forward is the more meaningful reference
 * price (strikes live in futures-space for these symbols), not the true spot
 * VIX index level. Walks selected expirations nearest (lexicographically
 * smallest ISO date) first and returns the first quote's resolved, positive
 * `forward`; null if none of the selected quotes has one.
 */
export function pickReferenceForward(
    quotesByExp: Record<string, OptionQuote[]>,
    selectedExps: readonly string[],
): number | null {
    for (const exp of [...selectedExps].sort()) {
        const match = (quotesByExp[exp] ?? []).find(
            (q) => typeof q.forward === 'number' && Number.isFinite(q.forward) && q.forward > 0,
        );
        if (match) return match.forward as number;
    }
    return null;
}

export interface GexSlice {
    /** Quotes of the selected expirations (the slice the levels describe). */
    quotes: OptionQuote[];
    /** App spot, else a put-call-parity estimate from the nearest selected expiration. */
    spot: number | null;
    spotIsEstimated: boolean;
    /**
     * null when there is no spot/quotes to analyze, OR `symbol` is a
     * futures-priced volatility index (isFuturesPriced below) and real levels
     * aren't available for it - either `vixFuturesPricing` is off, or it's on
     * but none of the selected quotes carry a resolved `forward` (Black-76
     * enrichment didn't succeed for them, src/vix-pricing.ts). When it IS on
     * and at least one quote has a `forward`, this is real per-quote-forward
     * GEX (src/gex.ts section 9 / Phase 3), computed exactly like any other
     * symbol - the GEX and Chart tabs render it with no special-casing.
     */
    levels: GexLevels | null;
    /** True when `symbol` is a futures-priced volatility index (VIX, VXN).
     *  Does NOT by itself mean levels are unavailable - check `levels` for
     *  that (see its doc comment). Views use this only to label/annotate a
     *  futures-priced symbol's real levels, or to explain why `levels` is
     *  null for one. */
    isFuturesPriced: boolean;
}

export function useGexLevels(
    appSpot: number | null,
    appSpotIsEstimated: boolean,
    quotesByExp: Record<string, OptionQuote[]>,
    selectedExps: string[],
    symbol: string | null | undefined,
    vixFuturesPricing: boolean = false,
): GexSlice {
    // Quotes of the selected expirations only (caller decides the slice, 7.2).
    const quotes = useMemo(
        () => selectedExps.flatMap((exp) => quotesByExp[exp] ?? []),
        [selectedExps, quotesByExp],
    );

    // Spot: App's value, else a parity estimate from the nearest selected expiration.
    // This is the TRUE spot (VIX spot index for VIX/VXN) - still shown as-is
    // in the UI (e.g. the GEX tab's "Spot $15.31" header). It is NOT what
    // feeds the futures-priced GEX math below; see referenceForward.
    const nearestSelected = [...selectedExps].sort()[0];
    const spot = useMemo(() => {
        if (appSpot != null) return appSpot;
        return nearestSelected && quotesByExp[nearestSelected] ? estimateSpot(quotesByExp[nearestSelected], nearestSelected) : null;
    }, [appSpot, nearestSelected, quotesByExp]);
    const spotIsEstimated = appSpot == null ? spot != null : appSpotIsEstimated;

    const isFuturesPriced = isFuturesPricedSymbol(symbol);

    // See pickReferenceForward's doc comment for the design rationale.
    const referenceForward = useMemo(
        () => (isFuturesPriced ? pickReferenceForward(quotesByExp, selectedExps) : null),
        [isFuturesPriced, selectedExps, quotesByExp],
    );

    // Real levels for a futures-priced symbol require BOTH the toggle on and
    // at least one selected quote actually carrying a `forward` (meaning
    // Black-76 enrichment succeeded for it) - otherwise keep the existing
    // "not available" suppression exactly as before the toggle existed.
    const futuresPricingAvailable = vixFuturesPricing && isFuturesPriced && referenceForward != null;

    const levels = useMemo(() => {
        if (!quotes.length) return null;
        if (isFuturesPriced) return futuresPricingAvailable ? computeGexLevels(quotes, referenceForward!, symbol) : null;
        return spot != null ? computeGexLevels(quotes, spot, symbol) : null;
    }, [quotes, spot, symbol, isFuturesPriced, futuresPricingAvailable, referenceForward]);

    return { quotes, spot, spotIsEstimated, levels, isFuturesPriced };
}
