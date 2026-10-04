import type { DataProvider, ProviderContext, Settings, TickerSuggestion } from '../types';
import { dbg, isAbortError } from '../utils';
import { dedupeTickerSuggestions, staticProvider, staticTickerSuggestions } from './cache';
import { cboeProvider } from './cboe';
import { nasdaqProvider } from './nasdaq';
import { yahooProvider } from './yahoo';

/**
 * Provider registry — only four sources, fixed dropdown order everywhere:
 *   CACHE  = same-origin static data/options/*.json (no proxy)
 *   CBOE   = delayed options via proxy /api/cboe
 *   NASDAQ = full chain via proxy /api/nasdaq
 *   YAHOO  = option chain via proxy /api/options (lazy)
 *
 * Order never changes: CACHE, CBOE, NASDAQ, YAHOO.
 * Host only picks the DEFAULT selection:
 *   - localhost / LAN              -> CBOE (proxy expected)
 *   - GitHub Pages / hosted static -> CACHE (no proxy required)
 */
export const PROVIDERS: DataProvider[] = [
    staticProvider,  // CACHE
    cboeProvider,    // CBOE
    nasdaqProvider,  // NASDAQ
    yahooProvider,   // YAHOO
];

/** Live proxy providers only (no CACHE). Used when CACHE/LIVE toggle is LIVE. */
export const LIVE_PROVIDERS: DataProvider[] = PROVIDERS.filter((p) => p.id !== 'static');

/**
 * Are we running locally (localhost / 127.* / 0.0.0.0 / *.local / private LAN)?
 * Local -> default CBOE; hosted (e.g. GitHub Pages) -> default CACHE.
 */
export function isLocalHost(): boolean {
    try {
        const h = window.location.hostname;
        return (
            h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local') ||
            /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(h)
        );
    } catch { return false; }
}

/** Default provider id for this host — not the same as dropdown order. */
export function defaultProviderId(): string {
    return isLocalHost() ? 'cboe' : 'static';
}

/** Curated public CORS proxies for CBOE. "{url}" = encoded target URL. */
export const PROXY_PRESETS: { label: string; template: string }[] = [
    { label: 'AllOrigins (raw)', template: 'https://api.allorigins.win/raw?url={url}' },
    { label: 'Corsproxy.io', template: 'https://corsproxy.io/?url={url}' },
    { label: 'Codetabs', template: 'https://api.codetabs.com/v1/proxy/?quest={url}' },
    { label: 'Your Worker (/raw?url=)', template: '{worker}/raw?url={url}' },
    { label: 'None (direct — will fail unless host allows CORS)', template: '{url}' },
];

/**
 * Provider-native suggestion request with local-index fallback. If a provider has
 * no dedicated search/list endpoint, or its proxy is unavailable, the UI still
 * suggests tickers from data/options/index.json and labels `no_options` entries.
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
 * Resolves the {worker} placeholder in the CBOE proxy template using workerUrl.
 */
export function ctxFor(settings: Settings, provider: DataProvider, signal?: AbortSignal): ProviderContext {
    const template = settings.proxyTemplate.replace('{worker}', (settings.workerUrl || '').replace(/\/$/, ''));
    return {
        proxyTemplate: template,
        proxyBase: settings.proxyBase,
        token: settings.tokens[provider.id] || '',
        secret: settings.secrets[provider.id] || '',
        signal,
    };
}
