import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './i18n';
import { defaultProviderId, PROVIDERS, PROXY_PRESETS } from './providers';
import type { ChainResult, ColorThemeId, Settings } from './types';
import { dbg } from './utils';

// ============================================================================
// PERSISTENT QUERY CACHE (localStorage, size-aware LRU eviction)
// ============================================================================

/**
 * Every successful query is stored in localStorage so it survives reloads and
 * lets us serve from cache without spending another request. Because
 * localStorage is small (~5 MB) and can throw QuotaExceededError, we track the
 * approximate byte size and, BEFORE writing, evict the LEAST-RECENTLY-USED
 * (oldest `ts`) records until the new entry fits under CACHE_MAX_BYTES. If a
 * write still throws quota, we evict-and-retry until it succeeds or the cache
 * is empty. (Per the requirement: when storage would be exceeded, drop the
 * oldest records first, then store.)
 */
export const CACHE_PREFIX = 'gex.cache.'; // one localStorage key per entry
export const CACHE_INDEX_KEY = 'gex.cache.index.v1'; // {key: {ts,size}} map
export const CACHE_MAX_BYTES = 4_000_000; // stay well under the ~5 MB localStorage cap

/**
 * Tiny pub/sub so the Settings → Cache stats update LIVE (no manual refresh)
 * whenever anything writes/clears the cache. React components subscribe with
 * useCacheVersion(); every mutation calls notifyCacheChanged().
 */
export const cacheListeners = new Set<() => void>();
export function notifyCacheChanged(): void { cacheListeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }
export function subscribeCache(fn: () => void): () => void { cacheListeners.add(fn); return () => cacheListeners.delete(fn); }

export interface CacheMeta { ts: number; size: number; }
export type CacheIndex = Record<string, CacheMeta>;

export function cacheLoadIndex(): CacheIndex {
    try { return JSON.parse(localStorage.getItem(CACHE_INDEX_KEY) || '{}'); }
    catch { return {}; }
}
export function cacheSaveIndex(ix: CacheIndex): void {
    try { localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(ix)); } catch { /* ignore */ }
}
export function cacheTotalBytes(ix: CacheIndex): number {
    let n = 0;
    for (const k in ix) n += ix[k].size;
    return n;
}
/** Remove a single cache entry (both its data key and its index record). */
export function cacheDrop(ix: CacheIndex, key: string): void {
    try { localStorage.removeItem(CACHE_PREFIX + key); } catch { /* ignore */ }
    delete ix[key];
}
/** Evict oldest-first until total + `incoming` fits under CACHE_MAX_BYTES. */
export function cacheEvictToFit(ix: CacheIndex, incoming: number): void {
    if (incoming > CACHE_MAX_BYTES) return; // a single huge entry: caller handles
    const byOldest = Object.keys(ix).sort((a, b) => ix[a].ts - ix[b].ts);
    let i = 0;
    while (cacheTotalBytes(ix) + incoming > CACHE_MAX_BYTES && i < byOldest.length) {
        dbg('cache evict (size)', byOldest[i]);
        cacheDrop(ix, byOldest[i]);
        i++;
    }
}
/** Read a cached JSON value by key (updates its LRU timestamp on hit). */
export function cacheGet<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (raw == null) return null;
        const ix = cacheLoadIndex();
        if (ix[key]) { ix[key].ts = Date.now(); cacheSaveIndex(ix); } // touch LRU
        return JSON.parse(raw) as T;
    } catch { return null; }
}
/**
 * Write a cached JSON value. Evicts oldest entries first if needed, and retries
 * on QuotaExceededError by dropping more oldest entries until it fits.
 */
export function cacheSet(key: string, value: unknown): void {
    let payload: string;
    try { payload = JSON.stringify(value); } catch { return; }
    const size = payload.length + key.length + 32; // rough byte estimate
    const ix = cacheLoadIndex();
    // Replacing an existing key frees its old size first.
    if (ix[key]) cacheDrop(ix, key);
    cacheEvictToFit(ix, size);

    for (let attempt = 0; attempt < 50; attempt++) {
        try {
            localStorage.setItem(CACHE_PREFIX + key, payload);
            ix[key] = { ts: Date.now(), size };
            cacheSaveIndex(ix);
            notifyCacheChanged(); // live-update stats
            return;
        } catch {
            // Quota still exceeded — drop the oldest remaining entry and retry.
            const oldest = Object.keys(ix).sort((a, b) => ix[a].ts - ix[b].ts)[0];
            if (!oldest) { dbg('cache: cannot fit even after full eviction'); notifyCacheChanged(); return; }
            dbg('cache evict (quota retry)', oldest);
            cacheDrop(ix, oldest);
            cacheSaveIndex(ix);
        }
    }
}

/**
 * Format a byte count as a human string (B / KB / MB).
 */
export function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Snapshot of cache usage for the Settings → Cache stats panel. */
export interface CacheStats {
    entries: number;      // number of cached query records
    bytes: number;        // approx bytes used by cached data (from the index)
    maxBytes: number;     // configured soft cap (CACHE_MAX_BYTES)
    oldest: number | null;// ts of the oldest record (ms) or null
    newest: number | null;// ts of the newest record (ms) or null
    settingsBytes: number;// approx bytes used by the settings blob
}

/** Compute current cache statistics (data entries + settings size). */
export function cacheStats(): CacheStats {
    const ix = cacheLoadIndex();
    const keys = Object.keys(ix);
    let oldest: number | null = null;
    let newest: number | null = null;
    for (const k of keys) {
        const ts = ix[k].ts;
        if (oldest == null || ts < oldest) oldest = ts;
        if (newest == null || ts > newest) newest = ts;
    }
    let settingsBytes = 0;
    try { settingsBytes = (localStorage.getItem(SETTINGS_KEY) || '').length; } catch { /* ignore */ }
    return {
        entries: keys.length,
        bytes: cacheTotalBytes(ix),
        maxBytes: CACHE_MAX_BYTES,
        oldest,
        newest,
        settingsBytes,
    };
}

/**
 * CLEAR DATA — remove only the QUERIED DATA cache (everything we downloaded when
 * fetching chains), leaving user settings intact. Also clears the in-memory
 * bulk cache so the next query re-fetches fresh.
 */
export function clearCacheData(): void {
    const ix = cacheLoadIndex();
    for (const k of Object.keys(ix)) {
        try { localStorage.removeItem(CACHE_PREFIX + k); } catch { /* ignore */ }
    }
    try { localStorage.removeItem(CACHE_INDEX_KEY); } catch { /* ignore */ }
    // Defensive sweep: drop any stray cache-prefixed keys not in the index.
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
        }
    } catch { /* ignore */ }
    bulkCache.clear();
    notifyCacheChanged(); // live-update stats
    dbg('cache: cleared DATA');
}

/**
 * CLEAR SETTINGS — remove only the persisted settings (provider/theme/keys/
 * proxy/lastTicker), leaving the queried data cache intact. The app reverts to
 * DEFAULT_SETTINGS on next load / next read.
 */
export function clearSettingsStore(): void {
    try { localStorage.removeItem(SETTINGS_KEY); } catch { /* ignore */ }
    notifyCacheChanged(); // live-update stats (settings size)
    dbg('cache: cleared SETTINGS');
}

/**
 * CLEAR ALL — wipe EVERYTHING this app stored in localStorage (data + settings +
 * any legacy/older-versioned keys under our namespace).
 */
export function clearAll(): void {
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('gex.')) localStorage.removeItem(k);
        }
    } catch { /* ignore */ }
    bulkCache.clear();
    notifyCacheChanged(); // live-update stats
    dbg('cache: cleared ALL');
}

// ============================================================================
// PROVIDER DISPATCH + CACHE
// ============================================================================

/**
 * In-memory cache for BULK providers (fast within a session), keyed by
 * `${providerId}:${SYMBOL}`. Backed by the persistent localStorage cache above
 * so results also survive reloads.
 */
export const bulkCache = new Map<string, ChainResult>();
export const bulkKey = (providerId: string, symbol: string) => `${providerId}:${symbol.toUpperCase()}`;

// ============================================================================
// SETTINGS STORE (persisted in localStorage)
// ============================================================================

export const COLOR_THEME_IDS: ColorThemeId[] = ['fundamentals', 'gex'];
export const DEFAULT_COLOR_THEME: ColorThemeId = 'gex';

export function normalizeColorTheme(v: unknown): ColorThemeId {
    return v === 'fundamentals' ? 'fundamentals' : DEFAULT_COLOR_THEME;
}

export const SETTINGS_KEY = 'gex.settings.v5';

export const DEFAULT_SETTINGS: Settings = {
    // Host-aware default selection; dropdown order stays CACHE, CBOE, NASDAQ, YAHOO.
    providerId: defaultProviderId(),
    language: DEFAULT_LANGUAGE,
    theme: 'system',
    colorTheme: DEFAULT_COLOR_THEME,
    proxyTemplate: PROXY_PRESETS[0].template,
    proxyBase: 'http://localhost:8787',    // local Bun Yahoo proxy default
    workerUrl: '',
    tokens: {},
    secrets: {},
    deskColumns: {
        calls: { openInterest: true, volume: true, iv: true, delta: true, gamma: true, theta: true, vega: true, rho: false, lambda: false, vanna: false, vomma: false, charm: false, speed: false, zomma: false, color: false },
        puts: { openInterest: true, volume: true, iv: true, delta: true, gamma: true, theta: true, vega: true, rho: false, lambda: false, vanna: false, vomma: false, charm: false, speed: false, zomma: false, color: false },
    },
    lastTicker: 'AAPL',
    // Phase 1 of 3 (VIX Black-76 pricing, see src/vix-pricing.ts): OFF by
    // default — nothing reads this yet, so flipping it has zero effect
    // until Phase 2 wires it into the enrichment path.
    vixFuturesPricing: false,
};

/** Fresh settings object with the current host default (not a shared mutable ref). */
export function freshDefaultSettings(): Settings {
    return { ...DEFAULT_SETTINGS, providerId: defaultProviderId() };
}

/** Load settings from localStorage, merged over defaults (forward-compatible). */
export function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return freshDefaultSettings();
        const parsed = JSON.parse(raw);
        const hostDefault = defaultProviderId();
        const merged: Settings = {
            ...DEFAULT_SETTINGS,
            ...parsed,
            language: (parsed.language && LANGUAGES.includes(parsed.language) ? parsed.language : DEFAULT_LANGUAGE) as Language,
            colorTheme: normalizeColorTheme(parsed.colorTheme),
            vixFuturesPricing: parsed.vixFuturesPricing === true,
            tokens: { ...DEFAULT_SETTINGS.tokens, ...(parsed.tokens || {}) },
            secrets: { ...DEFAULT_SETTINGS.secrets, ...(parsed.secrets || {}) },
            deskColumns: {
                calls: { ...DEFAULT_SETTINGS.deskColumns.calls, ...((parsed.deskColumns as any)?.calls || {}) },
                puts: { ...DEFAULT_SETTINGS.deskColumns.puts, ...((parsed.deskColumns as any)?.puts || {}) },
            },
        };
        // Drop removed providers (marketdata, dolthub, …) → fall back to host default.
        if (!PROVIDERS.some((p) => p.id === merged.providerId)) {
            merged.providerId = hostDefault;
        }
        return merged;
    } catch {
        return freshDefaultSettings();
    }
}

/** Persist settings to localStorage (best-effort; ignores quota errors). */
export function saveSettings(s: Settings): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
