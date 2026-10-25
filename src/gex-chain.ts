/// <reference lib="esnext" />
import { useEffect, useMemo, useState } from 'react';
import { getBulk } from './providers/loader';
import type { ChainMeta, DataProvider, OptionQuote } from './types';
import { dbg } from './utils';

// ============================================================================
// The quotes the GEX, Board and Chart tabs read, per expiration (moved out of main.tsx, review GEX-H1 / GEX-H10).
// Bulk providers (CACHE, CBOE, NASDAQ) hold every expiration of the ticker in the bulk cache, so those tabs can offer all
// of them; lazy YAHOO only has what was loaded into `expData`. Results are tagged with the provider, symbol and VIX
// pricing they belong to, and a result of another ticker is never handed out: right after a ticker switch the tabs get
// no quotes (levels null for a frame) instead of the previous ticker's quotes under the new symbol.
// ============================================================================

export type QuotesByExp = Record<string, OptionQuote[]>;

/** Shared empty value: a stable identity, so memoized levels do not recompute on every render. */
export const EMPTY_QUOTES_BY_EXP: QuotesByExp = Object.freeze({}) as QuotesByExp;

/** Which chain a bulk result belongs to: provider, symbol and the VIX futures pricing flag (it changes the greeks). */
export function gexChainKey(providerId: string, symbol: string, vixFuturesPricing: boolean): string {
    return `${providerId}|${symbol}|${vixFuturesPricing ? 1 : 0}`;
}

/** Quotes grouped by expiration, in their original order. */
export function groupByExpiration(quotes: readonly OptionQuote[]): QuotesByExp {
    const byExp: QuotesByExp = {};
    for (const q of quotes) (byExp[q.expiration] ??= []).push(q);
    return byExp;
}

/** A bulk chain read for one key; `byExp` null = the bulk cache had nothing (or failed) for it. */
export interface BulkChain {
    key: string;
    byExp: QuotesByExp | null;
}

/**
 * The quotes the tabs read now. Bulk mode: the bulk chain when it belongs to `key`, nothing while the right one is still
 * being read, and the loaded `expData` when the bulk cache has nothing for it. Lazy mode (and that fallback): `expData` only
 * when it was loaded for the current symbol (`chainSymbol`), else nothing.
 */
export function pickGexQuotesByExp(args: {
    mode: DataProvider['mode'];
    key: string | null;
    bulk: BulkChain | null;
    expData: QuotesByExp;
    chainSymbol: string;
    symbol: string | null;
}): QuotesByExp {
    const { mode, key, bulk, expData, chainSymbol, symbol } = args;
    if (!key || !symbol) return EMPTY_QUOTES_BY_EXP;
    if (mode === 'bulk') {
        if (!bulk || bulk.key !== key) return EMPTY_QUOTES_BY_EXP; // still reading the new ticker's chain
        if (bulk.byExp) return bulk.byExp;
    }
    return chainSymbol === symbol ? expData : EMPTY_QUOTES_BY_EXP;
}

/**
 * The hook behind `pickGexQuotesByExp`. The bulk chain is read when the provider, the ticker (a new `meta`, also a
 * re-fetch of the same one) or the VIX pricing changes, NOT on every expiration click: the bulk does not change with the
 * selection, regrouping it per click ran `computeGexLevels` twice (GEX-H10). A failed read falls back to `expData`.
 */
export function useGexQuotesByExp(
    meta: ChainMeta | null,
    provider: DataProvider,
    vixFuturesPricing: boolean,
    expData: QuotesByExp,
    chainSymbol: string,
): QuotesByExp {
    const symbol = meta?.symbol ?? null;
    const key = symbol ? gexChainKey(provider.id, symbol, vixFuturesPricing) : null;
    const [bulk, setBulk] = useState<BulkChain | null>(null);
    useEffect(() => {
        if (!meta || !key || provider.mode !== 'bulk') return;
        let cancelled = false;
        getBulk(provider.id, meta.symbol, vixFuturesPricing)
            .then((chain) => {
                if (!cancelled) setBulk({ key, byExp: chain ? groupByExpiration(chain.quotes) : null });
            })
            .catch((e: unknown) => {
                dbg('getBulk error', e);
                if (!cancelled) setBulk({ key, byExp: null });
            });
        return () => { cancelled = true; };
    }, [meta, key, provider, vixFuturesPricing]);
    return useMemo(
        () => pickGexQuotesByExp({ mode: provider.mode, key, bulk, expData, chainSymbol, symbol }),
        [provider.mode, key, bulk, expData, chainSymbol, symbol],
    );
}
