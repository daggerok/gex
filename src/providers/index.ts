/// <reference lib="esnext" />
import type { DataProvider, ProviderContext, Settings, TickerSuggestion } from '../types';
import { dbg, isAbortError } from '../utils';
import { dedupeTickerSuggestions, futuresFile, staticProvider, staticTickerSuggestions } from './cache';
import { cboeProvider } from './cboe';
import { nasdaqProvider } from './nasdaq';
import { yahooProvider } from './yahoo';

/**
 * Provider registry: exactly four sources (R2), listed in this order wherever they are listed:
 *   CACHE  = same-origin static api/options/*.json (no proxy)
 *   CBOE   = delayed options via proxy /api/cboe
 *   NASDAQ = full chain via proxy /api/nasdaq
 *   YAHOO  = option chain via proxy /api/options (lazy)
 *
 * There is no provider menu: the source is picked automatically (src/proxy-discovery.ts). Proxy found -> per ticker
 * CBOE, then YAHOO, then NASDAQ, then CACHE (AUTO_LIVE_ORDER); no proxy -> CACHE. The advanced settings may fix the
 * source to CACHE or one live provider.
 */
export const PROVIDERS: DataProvider[] = [
    staticProvider,  // CACHE
    cboeProvider,    // CBOE
    nasdaqProvider,  // NASDAQ
    yahooProvider,   // YAHOO
];

/** The provider of an id; CACHE for an unknown one. */
export function providerById(id: string): DataProvider {
    return PROVIDERS.find((p) => p.id === id) ?? staticProvider;
}

/** True for a futures ticker (`/ES`, `ES1!`, the micros): its options come from api/futures/<ROOT>.json (cache.ts futuresFile). */
export function isFuturesTicker(symbol: string | null | undefined): boolean {
    return Boolean(symbol && futuresFile(symbol.trim().toUpperCase()));
}

/**
 * The provider that serves `symbol` (futures PR, owner 2026-10-25: "futures tickers auto-route to the local cache provider,
 * no manual switch"): a futures ticker (`/ES`, `ES1!`, cache.ts futuresFile) is read by the CACHE provider from the
 * LOCAL-ONLY api/futures/<ROOT>.json that `bun run tv:futures` writes, whatever provider is selected; every other ticker
 * keeps the selected one. The list and order of PROVIDERS are unchanged (R2). On a host without the file (the public site)
 * the CACHE provider answers with the clear "run bun run tv:futures" message instead of a live provider's confusing error.
 */
export function providerForSymbol(selected: DataProvider, symbol: string | null | undefined): DataProvider {
    return isFuturesTicker(symbol) ? staticProvider : selected;
}

/** Curated public CORS proxies for CBOE. "{url}" = encoded target URL. */
export const PROXY_PRESETS: { label: string; template: string }[] = [
    { label: 'AllOrigins (raw)', template: 'https://api.allorigins.win/raw?url={url}' },
    { label: 'Corsproxy.io', template: 'https://corsproxy.io/?url={url}' },
    { label: 'Codetabs', template: 'https://api.codetabs.com/v1/proxy/?quest={url}' },
    { label: 'None (direct — will fail unless host allows CORS)', template: '{url}' },
];

/**
 * Provider-native suggestion request with local-index fallback. If a provider has
 * no dedicated search/list endpoint, or its proxy is unavailable, the UI still
 * suggests tickers from api/options/index.json and labels `no_options` entries.
 */
export async function suggestTickers(provider: DataProvider, query: string, ctx: ProviderContext, limit = 24): Promise<TickerSuggestion[]> {
    if (provider.suggestTickers) {
        try {
            const suggestions = await provider.suggestTickers(query, ctx);
            if (suggestions.length > 0) return dedupeTickerSuggestions(suggestions, limit);
        } catch (e: unknown) {
            if (isAbortError(e)) throw e;
            dbg('provider suggestions failed; falling back to local index', { provider: provider.id, error: String(e) });
        }
    }
    return staticTickerSuggestions(query, ctx, limit);
}

/**
 * Build the ProviderContext for a provider from settings.
 */
export function ctxFor(settings: Settings, provider: DataProvider, signal?: AbortSignal): ProviderContext {
    return {
        proxyTemplate: settings.proxyTemplate,
        proxyBase: settings.proxyBase,
        token: settings.tokens[provider.id] || '',
        secret: settings.secrets[provider.id] || '',
        signal,
    };
}
