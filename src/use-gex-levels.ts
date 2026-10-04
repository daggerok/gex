// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { useMemo } from 'react';
import { computeGexLevels } from './gex';
import type { GexLevels, OptionQuote } from './types';
import { estimateSpot } from './utils';

// ---------------------------------------------------------------------------
// Shared GEX levels (plan sections 7.7 / 8.2): the ONE place the app calls
// computeGexLevels(). App runs this hook once and passes the result to both
// the GEX tab (Key Levels card, wall reference lines) and the Chart tab
// (price lines), so the two tabs always show the same numbers. Neither view
// recomputes levels itself (rule R1).
// ---------------------------------------------------------------------------

export interface GexSlice {
    /** Quotes of the selected expirations (the slice the levels describe). */
    quotes: OptionQuote[];
    /** App spot, else a put-call-parity estimate from the nearest selected expiration. */
    spot: number | null;
    spotIsEstimated: boolean;
    /** null when there is no spot or no quotes to analyze. */
    levels: GexLevels | null;
}

export function useGexLevels(
    appSpot: number | null,
    appSpotIsEstimated: boolean,
    quotesByExp: Record<string, OptionQuote[]>,
    selectedExps: string[],
): GexSlice {
    // Quotes of the selected expirations only (caller decides the slice, 7.2).
    const quotes = useMemo(
        () => selectedExps.flatMap((exp) => quotesByExp[exp] ?? []),
        [selectedExps, quotesByExp],
    );

    // Spot: App's value, else a parity estimate from the nearest selected expiration.
    const nearestSelected = [...selectedExps].sort()[0];
    const spot = useMemo(() => {
        if (appSpot != null) return appSpot;
        return nearestSelected && quotesByExp[nearestSelected] ? estimateSpot(quotesByExp[nearestSelected], nearestSelected) : null;
    }, [appSpot, nearestSelected, quotesByExp]);
    const spotIsEstimated = appSpot == null ? spot != null : appSpotIsEstimated;

    const levels = useMemo(
        () => (spot != null && quotes.length ? computeGexLevels(quotes, spot) : null),
        [quotes, spot],
    );

    return { quotes, spot, spotIsEstimated, levels };
}
