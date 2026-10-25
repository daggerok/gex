/// <reference lib="esnext" />
import { enrichChainResult, enrichQuotesWithModelGreeks, hasFirstOrderGreeks, hasHigherOrderGreeks, isExpired } from '../greeks';
import { bulkCache, bulkKey, cacheGet, cacheSet } from '../settings-store';
import { isAsOfProviderId } from './asof';
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
    // An archived snapshot ("As of") lives in memory only: it must never fill or evict the shared query cache
    const persist = !isAsOfProviderId(providerId);
    const mem = bulkCache.get(k);
    if (mem) {
        if (chainLooksEnriched(mem)) return mem;
        const fixed = enrichChainResult(mem, vixFuturesPricing);
        bulkCache.set(k, fixed);
        if (persist) await cacheSet(k, fixed);
        return fixed;
    }
    const disk = persist ? await cacheGet<ChainResult>(k) : null;
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
    if (!isAsOfProviderId(providerId)) await cacheSet(k, enriched);
}
/** A lazy expiration in the persistent cache, tagged with the meta fetch it belongs to (GEX-H6). */
export interface LazyEntry {
    fetchedAt: number;
    quotes: OptionQuote[];
}

/**
 * The cached quotes of a lazy expiration when they belong to the current meta fetch (`fetchedAt` of the cached meta), else
 * null: an entry of an earlier fetch, the plain array an older app version stored, or no current meta at all.
 */
export function lazyHit(entry: unknown, fetchedAt: number | null | undefined): OptionQuote[] | null {
    if (fetchedAt == null || !entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const e = entry as Partial<LazyEntry>;
    return e.fetchedAt === fetchedAt && Array.isArray(e.quotes) ? e.quotes : null;
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
        return withoutExpired({
            symbol: cached.symbol, underlyingPrice: cached.underlyingPrice, expirations: cached.expirations, greeks: cached.greeks,
            updated: cached.updated ?? null, dataDate: cached.dataDate ?? null,
        });
    }
    if (!provider.fetchMeta) throw new Error('Provider misconfigured (lazy without fetchMeta).');
    // stamped: the cached expirations of an earlier fetch no longer count (GEX-H6, see lazyHit)
    const meta: ChainMeta = { ...(await provider.fetchMeta(symbol, ctx)), fetchedAt: Date.now() };
    // Persist meta so expirations survive reloads (cheap; keyed with ":meta").
    await cacheSet(lazyKey(provider.id, meta.symbol, 'meta'), meta);
    return withoutExpired(meta);
}

/**
 * The meta without the expirations that are already over (GEX-H4): a cache file refreshed weeks ago still lists them, the
 * app picked one by default and showed its old gamma as current. "Over" is greeks.ts `isExpired` (before the New York date
 * of now, or of the valuation time in a backtest, so a snapshot of day D keeps its D expiration). `expiredDropped` counts them.
 */
export function withoutExpired(meta: ChainMeta, now?: Date): ChainMeta {
    const live = meta.expirations.filter((e) => !(now ? isExpired(e, now) : isExpired(e)));
    return live.length === meta.expirations.length ? meta : { ...meta, expirations: live, expiredDropped: meta.expirations.length - live.length };
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
    // One request per expiration at a time: the background prefetch of every expiration and the Load of the selected one
    // asked for the same date at once and fetched it twice (review, LOW)
    const key = lazyKey(provider.id, symbol, expiration);
    const running = lazyInFlight.get(key);
    if (running) return running;
    const run = loadLazyExpiration(provider, symbol, expiration, ctx, vixFuturesPricing, key)
        .finally(() => { lazyInFlight.delete(key); });
    lazyInFlight.set(key, run);
    return run;
}

/** Lazy expirations being loaded right now, by cache key (loadExpiration shares them). */
const lazyInFlight = new Map<string, Promise<OptionQuote[]>>();

async function loadLazyExpiration(provider: DataProvider, symbol: string, expiration: string, ctx: ProviderContext, vixFuturesPricing: boolean, key: string): Promise<OptionQuote[]> {
    if (!provider.fetchExpiration) throw new Error('Provider misconfigured (lazy without fetchExpiration).');
    // Serve a lazy expiration from the persistent cache only when it was fetched for the current meta (GEX-H6): the quotes
    // of an earlier session (Monday's bid, ask, IV and OI under Thursday's spot) are fetched again.
    const meta = await cacheGet<ChainMeta>(lazyKey(provider.id, symbol, 'meta'));
    const fetchedAt = meta?.fetchedAt ?? null;
    const hit = lazyHit(await cacheGet<unknown>(key), fetchedAt);
    if (hit) {
        dbg('cache hit (lazy)', key);
        // Re-enrich legacy cache entries that predate client-side BS/Black-76.
        if (hit.some((q) => hasHigherOrderGreeks(q) || q.greeksSource === 'black-scholes' || q.greeksSource === 'black-76')) return hit;
        const enriched = enrichQuotesWithModelGreeks(hit, meta?.underlyingPrice ?? null, symbol, vixFuturesPricing);
        if (enriched !== hit) await cacheSet(key, { fetchedAt, quotes: enriched });
        return enriched;
    }
    const quotes = await provider.fetchExpiration(symbol, expiration, ctx);
    const enriched = enrichQuotesWithModelGreeks(quotes, meta?.underlyingPrice ?? null, symbol, vixFuturesPricing);
    if (fetchedAt !== null) await cacheSet(key, { fetchedAt, quotes: enriched });
    return enriched;
}
