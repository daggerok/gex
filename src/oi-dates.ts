/// <reference lib="esnext" />
import type { OptionQuote } from './types';

// ============================================================================
// OPEN INTEREST DATES of TradingView data (owner decision G10, 2026-10-26)
// ============================================================================
//
// TradingView keeps each contract's open interest of the LAST day it changed (`oi.time`): on the CME futures options
// about 9% of the ES OI (13% NQ, 30% RTY) is dated before the newest day of the chain. A check against the CME Daily
// Bulletin of 2026-10-23 (2026-10-26, 880 ES calls, 266 of them with an older day) found every value equal: an older day
// means "no trade changed it since", not stale. So the values are used as they are and the Desk only names the day in the
// tooltip of the OI cell (G10 resolved). Only quotes that carry `oiDate` (the futures files, the live mode, the hybrid's
// TradingView fallback) are affected.

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

// ---- CME open interest cross-check (owner 2026-10-26, scripts/tv/cme-oi.ts) --------------------------------------------
// CME publishes the preliminary open interest per option PRODUCT and side once a day (free FTP file). The TradingView
// root of an option is the CME product code (E4A, EW4, ES, QN4, R4E...), so the chain's OI can be summed the same way.
// The chain only holds the watched window (strikes +/-6%, expirations through the nearest monthly) while CME counts every
// strike and every listed expiration of the product, so the share mixes the window's coverage with TradingView's lag.

/** "E4A261026C7630" -> "E4A"; "ESZ6..." style or unknown -> null. */
export function productOf(symbol: string): string | null {
    return /^([A-Z0-9]+?)\d{6}[CP][\d.]+$/.exec(symbol)?.[1] ?? null;
}

/** Open interest of `quotes` summed by "<product>|<call|put>". */
export function oiByProduct(quotes: readonly OptionQuote[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const q of quotes) {
        const p = productOf(q.symbol);
        const v = q.openInterest;
        if (!p || v == null || !Number.isFinite(v)) continue;
        const k = `${p}|${q.side}`;
        out[k] = (out[k] ?? 0) + v;
    }
    return out;
}

export interface CmeLag {
    product: string;
    side: 'call' | 'put';
    /** TradingView's sum in the chain */
    tv: number;
    /** CME's preliminary total of the product and side */
    cme: number;
    /** 1 - tv / cme: how far TradingView's window is below CME (negative: above) */
    lag: number;
}

/** Per product and side present in both, largest CME open interest first; and the lag of their totals. */
export function cmeOiLag(tv: Readonly<Record<string, number>>, cme: Readonly<Record<string, number>>): { rows: CmeLag[]; total: CmeLag | null } {
    const rows: CmeLag[] = [];
    for (const k of Object.keys(tv)) {
        const c = cme[k];
        if (!(c > 0)) continue;
        const [product, side] = k.split('|');
        rows.push({ product, side: side === 'put' ? 'put' : 'call', tv: tv[k], cme: c, lag: 1 - tv[k] / c });
    }
    rows.sort((a, b) => b.cme - a.cme || a.product.localeCompare(b.product));
    if (!rows.length) return { rows, total: null };
    const t = rows.reduce((s, r) => s + r.tv, 0);
    const c = rows.reduce((s, r) => s + r.cme, 0);
    return { rows, total: { product: 'all', side: 'call', tv: t, cme: c, lag: 1 - t / c } };
}
