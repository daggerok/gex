import type { ProviderContext, TickerSuggestion } from '../types';
import { looksLikeTicker, normalizeTickerSymbol } from './cache';

/**
 * Query the companion proxy's unified suggestion endpoint. The local Bun proxy
 * and Cloudflare Worker both expose /api/search?provider=<id>&q=<text>, returning
 * normalized `{ suggestions: TickerSuggestion[] }`. If the proxy is unavailable,
 * callers fall back to data/options/index.json via suggestTickers().
 */
export async function proxyTickerSuggestions(providerId: 'yahoo' | 'nasdaq' | 'cboe', query: string, ctx: ProviderContext): Promise<TickerSuggestion[]> {
    const q = query.trim();
    if (!q) return [];
    const base = (ctx.proxyBase || '').replace(/\/$/, '');
    if (!base) throw new Error('Proxy base URL is not configured for provider-native ticker search.');
    const url = `${base}/api/search?provider=${encodeURIComponent(providerId)}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctx.signal });
    if (!res.ok) throw new Error(`Ticker search proxy failed (HTTP ${res.status}).`);
    const json: any = await res.json().catch(() => null);
    const rows = Array.isArray(json?.suggestions) ? json.suggestions : [];
    return rows.map((r: any) => ({
        symbol: normalizeTickerSymbol(r.symbol),
        name: r.name ? String(r.name) : undefined,
        exchange: r.exchange ? String(r.exchange) : undefined,
        source: r.source ? String(r.source) : providerId.toUpperCase(),
        hasOptions: r.hasOptions !== false,
    })).filter((s: TickerSuggestion) => s.symbol && looksLikeTicker(s.symbol));
}
