/// <reference lib="esnext" />
import type { OptionQuote } from './types';

// ============================================================================
// OPEN INTEREST DATES of TradingView data (owner decision G10, 2026-10-26)
// ============================================================================
//
// TradingView keeps each contract's open interest of the LAST day it got one (`oi.time`): on the CME futures options
// about 9% of the ES OI (13% NQ, 30% RTY) is dated before the newest day of the chain. The owner chose to keep those
// values in every level and to show them: the Desk prints such an OI cell pale with a tooltip naming its day, the source
// label's tooltip counts them. Only quotes that carry `oiDate` (the futures files and the live mode) are affected; the
// same rule is ready for the TradingView hybrid of stocks.

/** The newest `oiDate` of `quotes`, null when none carries one. */
export function latestOiDate(quotes: readonly OptionQuote[]): string | null {
    let latest: string | null = null;
    for (const q of quotes) if (q.oiDate && (!latest || q.oiDate > latest)) latest = q.oiDate;
    return latest;
}

/** `oiStale` on every quote whose `oiDate` is older than the newest of the chain (new objects only where it changes). */
export function markStaleOi(quotes: OptionQuote[]): OptionQuote[] {
    const latest = latestOiDate(quotes);
    if (!latest) return quotes;
    return quotes.map((q) => {
        const stale = q.oiDate != null && q.oiDate < latest;
        return stale === Boolean(q.oiStale) ? q : { ...q, oiStale: stale };
    });
}

export interface StaleOiSummary {
    /** the newest OI day */
    latest: string;
    /** contracts with an older OI day */
    contracts: number;
    /** their OI */
    oi: number;
    /** the OI of every contract with a value */
    total: number;
    /** oi / total, 0..1 */
    share: number;
}

/** How much of the open interest of `quotes` is older than the newest day; null without dates or without old values. */
export function staleOiSummary(quotes: readonly OptionQuote[]): StaleOiSummary | null {
    const latest = latestOiDate(quotes);
    if (!latest) return null;
    let contracts = 0;
    let oi = 0;
    let total = 0;
    for (const q of quotes) {
        const v = q.openInterest;
        if (v == null || !Number.isFinite(v)) continue;
        total += v;
        if (q.oiDate != null && q.oiDate < latest) {
            contracts++;
            oi += v;
        }
    }
    if (!contracts) return null;
    return { latest, contracts, oi, total, share: total > 0 ? oi / total : 0 };
}
