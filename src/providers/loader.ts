import { enrichChainResult, enrichQuotesWithModelGreeks, hasFirstOrderGreeks, hasHigherOrderGreeks } from '../greeks';
import { bulkCache, bulkKey, cacheGet, cacheSet } from '../settings-store';
import type { ChainMeta, ChainResult, DataProvider, OptionQuote, ProviderContext } from '../types';
import { dbg, num } from '../utils';

// ============================================================================
// PROVIDER DISPATCH (bulk/lazy loading over the cache in settings-store.ts)
// ============================================================================


/** True when a bulk ChainResult already has model/higher-order greeks on quotes. */
export function chainLooksEnriched(result: ChainResult): boolean {
    const qs = result.quotes;
    if (!qs.length) return true;
    // Sample a few rows — static cache & post-enrichment results fill higher-order.
    for (let i = 0; i < qs.length && i < 12; i++) {
        if (hasHigherOrderGreeks(qs[i]) || qs[i].greeksSource === 'black-scholes') return true;
    }
    // If every sampled row has no IV and no first-order, enrichment cannot help
    // (e.g. NASDAQ) — treat as "done" so we don't re-walk on every cache hit.
    let canModel = false;
    for (let i = 0; i < qs.length && i < 24; i++) {
        if (num(qs[i].iv) != null || hasFirstOrderGreeks(qs[i])) { canModel = true; break; }
    }
    return !canModel;
}

/** Get a bulk result from memory, then persistent cache; re-enrich stale cache. */
export function getBulk(providerId: string, symbol: string): ChainResult | null {
    const k = bulkKey(providerId, symbol);
    const mem = bulkCache.get(k);
    if (mem) {
        if (chainLooksEnriched(mem)) return mem;
        const fixed = enrichChainResult(mem);
        bulkCache.set(k, fixed);
        cacheSet(k, fixed);
        return fixed;
    }
    const disk = cacheGet<ChainResult>(k);
    if (disk) {
        const fixed = chainLooksEnriched(disk) ? disk : enrichChainResult(disk);
        bulkCache.set(k, fixed);
        if (fixed !== disk) cacheSet(k, fixed);
        return fixed;
    }
    return null;
}
/** Store a bulk result (always model-enriched) in memory + persistent cache. */
export function putBulk(providerId: string, result: ChainResult): void {
    const enriched = enrichChainResult(result);
    const k = bulkKey(providerId, enriched.symbol);
    bulkCache.set(k, enriched);
    cacheSet(k, enriched);
}
/** Cache key for a single lazy expiration. */
export const lazyKey = (providerId: string, symbol: string, exp: string) =>
    `${providerId}:${symbol.toUpperCase()}:${exp}`;

/** Load chain metadata (expirations + spot) for the active provider. */
export async function loadMeta(provider: DataProvider, symbol: string, ctx: ProviderContext): Promise<ChainMeta> {
    if (provider.mode === 'bulk') {
        if (!provider.fetchAll) throw new Error('Provider misconfigured (bulk without fetchAll).');
        const result = await provider.fetchAll(symbol, ctx);
        putBulk(provider.id, result);
        const cached = getBulk(provider.id, result.symbol) ?? enrichChainResult(result);
        return { symbol: cached.symbol, underlyingPrice: cached.underlyingPrice, expirations: cached.expirations, greeks: cached.greeks };
    }
    if (!provider.fetchMeta) throw new Error('Provider misconfigured (lazy without fetchMeta).');
    const meta = await provider.fetchMeta(symbol, ctx);
    // Persist meta so expirations survive reloads (cheap; keyed with ":meta").
    cacheSet(lazyKey(provider.id, meta.symbol, 'meta'), meta);
    return meta;
}

/** Load the quotes for one expiration for the active provider (cached + enriched). */
export async function loadExpiration(provider: DataProvider, symbol: string, expiration: string, ctx: ProviderContext): Promise<OptionQuote[]> {
    if (provider.mode === 'bulk') {
        const cached = getBulk(provider.id, symbol);
        const result = cached ?? (provider.fetchAll ? await provider.fetchAll(symbol, ctx) : null);
        if (result && !cached) putBulk(provider.id, result);
        const final = getBulk(provider.id, symbol) ?? (result ? enrichChainResult(result) : null);
        return (final?.quotes ?? []).filter((q) => q.expiration === expiration);
    }
    if (!provider.fetchExpiration) throw new Error('Provider misconfigured (lazy without fetchExpiration).');
    // Serve a lazy expiration from the persistent cache when available.
    const key = lazyKey(provider.id, symbol, expiration);
    const hit = cacheGet<OptionQuote[]>(key);
    if (hit) {
        dbg('cache hit (lazy)', key);
        // Re-enrich legacy cache entries that predate client-side BS.
        if (hit.some((q) => hasHigherOrderGreeks(q) || q.greeksSource === 'black-scholes')) return hit;
        const meta = cacheGet<ChainMeta>(lazyKey(provider.id, symbol, 'meta'));
        const enriched = enrichQuotesWithModelGreeks(hit, meta?.underlyingPrice ?? null, symbol);
        if (enriched !== hit) cacheSet(key, enriched);
        return enriched;
    }
    const quotes = await provider.fetchExpiration(symbol, expiration, ctx);
    const meta = cacheGet<ChainMeta>(lazyKey(provider.id, symbol, 'meta'));
    const enriched = enrichQuotesWithModelGreeks(quotes, meta?.underlyingPrice ?? null, symbol);
    cacheSet(key, enriched);
    return enriched;
}
