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
        if (hasHigherOrderGreeks(qs[i]) || qs[i].greeksSource === 'black-scholes' || qs[i].greeksSource === 'black-76') return true;
    }
    // If every sampled row has no IV and no first-order, enrichment cannot help
    // (e.g. NASDAQ) — treat as "done" so we don't re-walk on every cache hit.
    let canModel = false;
    for (let i = 0; i < qs.length && i < 24; i++) {
        if (num(qs[i].iv) != null || hasFirstOrderGreeks(qs[i])) { canModel = true; break; }
    }
    return !canModel;
}

/**
 * Get a bulk result from memory, then persistent cache; re-enrich stale cache.
 * `vixFuturesPricing` (default false) is forwarded to enrichChainResult for
 * any re-enrich this performs — see enrichQuotesWithModelGreeks's doc comment
 * in src/greeks.ts for why default-false is behavior-preserving.
 */
export async function getBulk(providerId: string, symbol: string, vixFuturesPricing: boolean = false): Promise<ChainResult | null> {
    const k = bulkKey(providerId, symbol);
    const mem = bulkCache.get(k);
    if (mem) {
        if (chainLooksEnriched(mem)) return mem;
        const fixed = enrichChainResult(mem, vixFuturesPricing);
        bulkCache.set(k, fixed);
        await cacheSet(k, fixed);
        return fixed;
    }
    const disk = await cacheGet<ChainResult>(k);
    if (disk) {
        const fixed = chainLooksEnriched(disk) ? disk : enrichChainResult(disk, vixFuturesPricing);
        bulkCache.set(k, fixed);
        if (fixed !== disk) await cacheSet(k, fixed);
        return fixed;
    }
    return null;
}
/** Store a bulk result (always model-enriched) in memory + persistent cache. */
export async function putBulk(providerId: string, result: ChainResult, vixFuturesPricing: boolean = false): Promise<void> {
    const enriched = enrichChainResult(result, vixFuturesPricing);
    const k = bulkKey(providerId, enriched.symbol);
    bulkCache.set(k, enriched);
    await cacheSet(k, enriched);
}
/** Cache key for a single lazy expiration. */
export const lazyKey = (providerId: string, symbol: string, exp: string) =>
    `${providerId}:${symbol.toUpperCase()}:${exp}`;

/** Load chain metadata (expirations + spot) for the active provider. */
export async function loadMeta(provider: DataProvider, symbol: string, ctx: ProviderContext, vixFuturesPricing: boolean = false): Promise<ChainMeta> {
    if (provider.mode === 'bulk') {
        if (!provider.fetchAll) throw new Error('Provider misconfigured (bulk without fetchAll).');
        const result = await provider.fetchAll(symbol, ctx);
        await putBulk(provider.id, result, vixFuturesPricing);
        const cached = (await getBulk(provider.id, result.symbol, vixFuturesPricing)) ?? enrichChainResult(result, vixFuturesPricing);
        return { symbol: cached.symbol, underlyingPrice: cached.underlyingPrice, expirations: cached.expirations, greeks: cached.greeks };
    }
    if (!provider.fetchMeta) throw new Error('Provider misconfigured (lazy without fetchMeta).');
    const meta = await provider.fetchMeta(symbol, ctx);
    // Persist meta so expirations survive reloads (cheap; keyed with ":meta").
    await cacheSet(lazyKey(provider.id, meta.symbol, 'meta'), meta);
    return meta;
}

/** Load the quotes for one expiration for the active provider (cached + enriched). */
export async function loadExpiration(provider: DataProvider, symbol: string, expiration: string, ctx: ProviderContext, vixFuturesPricing: boolean = false): Promise<OptionQuote[]> {
    if (provider.mode === 'bulk') {
        const cached = await getBulk(provider.id, symbol, vixFuturesPricing);
        const result = cached ?? (provider.fetchAll ? await provider.fetchAll(symbol, ctx) : null);
        if (result && !cached) await putBulk(provider.id, result, vixFuturesPricing);
        const final = (await getBulk(provider.id, symbol, vixFuturesPricing)) ?? (result ? enrichChainResult(result, vixFuturesPricing) : null);
        return (final?.quotes ?? []).filter((q) => q.expiration === expiration);
    }
    if (!provider.fetchExpiration) throw new Error('Provider misconfigured (lazy without fetchExpiration).');
    // Serve a lazy expiration from the persistent cache when available.
    const key = lazyKey(provider.id, symbol, expiration);
    const hit = await cacheGet<OptionQuote[]>(key);
    if (hit) {
        dbg('cache hit (lazy)', key);
        // Re-enrich legacy cache entries that predate client-side BS/Black-76.
        if (hit.some((q) => hasHigherOrderGreeks(q) || q.greeksSource === 'black-scholes' || q.greeksSource === 'black-76')) return hit;
        const meta = await cacheGet<ChainMeta>(lazyKey(provider.id, symbol, 'meta'));
        const enriched = enrichQuotesWithModelGreeks(hit, meta?.underlyingPrice ?? null, symbol, vixFuturesPricing);
        if (enriched !== hit) await cacheSet(key, enriched);
        return enriched;
    }
    const quotes = await provider.fetchExpiration(symbol, expiration, ctx);
    const meta = await cacheGet<ChainMeta>(lazyKey(provider.id, symbol, 'meta'));
    const enriched = enrichQuotesWithModelGreeks(quotes, meta?.underlyingPrice ?? null, symbol, vixFuturesPricing);
    await cacheSet(key, enriched);
    return enriched;
}
