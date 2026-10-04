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
// ---------------------------------------------------------------------------

export interface GexSlice {
    /** Quotes of the selected expirations (the slice the levels describe). */
    quotes: OptionQuote[];
    /** App spot, else a put-call-parity estimate from the nearest selected expiration. */
    spot: number | null;
    spotIsEstimated: boolean;
    /** null when there is no spot or no quotes to analyze, OR `symbol` is a
     *  futures-priced volatility index (isFuturesPriced below) - this app's
     *  spot-based GEX math (src/gex.ts scales by spot^2) does not apply to
     *  those, so levels are suppressed rather than shown wrong. */
    levels: GexLevels | null;
    /** True when `symbol` is a futures-priced volatility index (VIX, VXN):
     *  the GEX and Chart tabs should show a "not supported" message instead
     *  of numbers, even though quotes/spot may both be present. */
    isFuturesPriced: boolean;
}

export function useGexLevels(
    appSpot: number | null,
    appSpotIsEstimated: boolean,
    quotesByExp: Record<string, OptionQuote[]>,
    selectedExps: string[],
    symbol: string | null | undefined,
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

    const isFuturesPriced = isFuturesPricedSymbol(symbol);
    const levels = useMemo(
        () => (!isFuturesPriced && spot != null && quotes.length ? computeGexLevels(quotes, spot) : null),
        [quotes, spot, isFuturesPriced],
    );

    return { quotes, spot, spotIsEstimated, levels, isFuturesPriced };
}
