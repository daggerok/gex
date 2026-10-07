import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './i18n';
import { defaultProviderId, PROVIDERS, PROXY_PRESETS } from './providers';
import type { ChainResult, ColorThemeId, Settings } from './types';
import { dbg } from './utils';

// ============================================================================
// PERSISTENT QUERY CACHE (IndexedDB, size-aware LRU eviction)
// ============================================================================

/**
 * Every successful query is stored in IndexedDB so it survives reloads and
 * lets us serve from cache without spending another request.
 *
 * This used to be a localStorage-backed cache capped at ~4 MB total — tiny
 * enough that a single large index chain (SPX can be 1.3–5.4 MB) could by
 * itself approach or blow the whole budget, causing aggressive eviction for
 * exactly the tickers where persistence matters most. IndexedDB's practical
 * quota is far larger (hundreds of MB to several GB depending on browser), so
 * we keep a much bigger — but still soft — cap and the same LRU eviction
 * policy, adapted to be async-safe.
 *
 * Schema: one object store (`entries`, keyPath `key`) holding records of
 * `{ key, value, ts, size }` — `value` is the cached payload (same shape as
 * before: ChainResult for bulk, OptionQuote[]/ChainMeta for lazy), `ts` is the
 * LRU timestamp, `size` is a rough byte estimate used for eviction/quota math.
 * A secondary index on `ts` exists for potential future use; in practice we
 * maintain an in-memory mirror of `{key: {ts,size}}` (hydrated once per
 * session from a cursor sweep, then kept in sync on every write/delete) so
 * repeated eviction/stats checks don't require rescanning the whole store.
 *
 * Because IndexedDB can still throw QuotaExceededError (real browser quota,
 * not just our soft cap), writes evict-and-retry on quota errors exactly like
 * before, and any other write failure is swallowed — a failed cache WRITE
 * must never prevent the user from seeing data they just fetched, only from
 * it being persisted for next time.
 */
const CACHE_DB_NAME = 'gex-cache-db';
const CACHE_DB_VERSION = 1;
const CACHE_STORE_NAME = 'entries';

// ~200 MB soft cap. Reasoning: real-world IndexedDB quotas are typically a
// generous share of free disk space in Chromium/Firefox (often hundreds of MB
// to multiple GB), while Safari has historically been more conservative — but
// even Safari's documented per-origin limits are comfortably above 200 MB on
// any machine with meaningful free disk space. 200 MB is ~50x the old 4 MB
// localStorage cap: it holds dozens of SPX-sized (~5.4 MB) chains plus a large
// number of equity chains without coming close to realistic browser quota
// errors, while still bounding unbounded growth with an LRU policy.
export const CACHE_MAX_BYTES = 200_000_000;

// Old localStorage-based cache keys (pre-IndexedDB-migration). We don't
// migrate their contents — this is a disposable performance cache, anything
// missing just gets re-fetched from the provider, same as a cold cache today
// — but we do remove the stale keys on first load so they don't linger as
// dead weight in localStorage.
const LEGACY_CACHE_PREFIX = 'gex.cache.';
const LEGACY_CACHE_INDEX_KEY = 'gex.cache.index.v1';

function clearLegacyLocalStorageCache(): void {
    try {
        localStorage.removeItem(LEGACY_CACHE_INDEX_KEY);
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith(LEGACY_CACHE_PREFIX)) localStorage.removeItem(k);
        }
    } catch { /* ignore — no localStorage (SSR/tests) or access denied */ }
}
clearLegacyLocalStorageCache(); // one-time sweep, runs once per module load (page load)

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
interface CacheRecord { key: string; value: unknown; ts: number; size: number; }

// ---- IndexedDB plumbing (native API, Promise-wrapped by hand) -------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openCacheDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable in this environment')); return; }
        let req: IDBOpenDBRequest;
        try { req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION); }
        catch (err) { reject(err as Error); return; }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
                const store = db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });
                store.createIndex('by-ts', 'ts', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
        req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
    });
    // Don't cache a failed open forever — let a later call retry (e.g. transient failure).
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
}

function idbGet(db: IDBDatabase, key: string): Promise<CacheRecord | undefined> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
        const req = tx.objectStore(CACHE_STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result as CacheRecord | undefined);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
    });
}

async function idbPut(rec: CacheRecord): Promise<void> {
    const db = await openCacheDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
        tx.objectStore(CACHE_STORE_NAME).put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB put aborted'));
    });
}

async function idbDelete(key: string): Promise<void> {
    try {
        const db = await openCacheDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
            tx.objectStore(CACHE_STORE_NAME).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
        });
    } catch { /* ignore */ }
}

async function idbClear(): Promise<void> {
    try {
        const db = await openCacheDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
            tx.objectStore(CACHE_STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'));
        });
    } catch { /* ignore */ }
}

function isQuotaError(err: unknown): boolean {
    return (err instanceof DOMException && err.name === 'QuotaExceededError')
        || (!!err && typeof err === 'object' && (err as { name?: string }).name === 'QuotaExceededError');
}

// ---- In-memory LRU index (hydrated once per session from IndexedDB) -------

let cacheIndexPromise: Promise<CacheIndex> | null = null;

/** Load (and memoize) the `{key: {ts,size}}` index from IndexedDB. */
export function cacheLoadIndex(): Promise<CacheIndex> {
    if (cacheIndexPromise) return cacheIndexPromise;
    cacheIndexPromise = (async () => {
        try {
            const db = await openCacheDb();
            const ix: CacheIndex = {};
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
                const req = tx.objectStore(CACHE_STORE_NAME).openCursor();
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (cursor) {
                        const rec = cursor.value as CacheRecord;
                        ix[rec.key] = { ts: rec.ts, size: rec.size };
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                req.onerror = () => reject(req.error ?? new Error('cache index scan failed'));
            });
            return ix;
        } catch (err) {
            dbg('cache: index load failed, starting empty', err);
            return {};
        }
    })();
    return cacheIndexPromise;
}

export function cacheTotalBytes(ix: CacheIndex): number {
    let n = 0;
    for (const k in ix) n += ix[k].size;
    return n;
}

/**
 * Pure eviction-ordering logic: which keys (oldest-first) to drop so that
 * `total(ix) + incoming` fits under `maxBytes`. Kept pure/sync so it's
 * unit-testable without a real IndexedDB.
 */
export function pickEvictionKeys(ix: CacheIndex, incoming: number, maxBytes: number = CACHE_MAX_BYTES): string[] {
    if (incoming > maxBytes) return []; // a single huge entry: caller (cacheSet) handles via quota retry
    const byOldest = Object.keys(ix).sort((a, b) => ix[a].ts - ix[b].ts);
    const toEvict: string[] = [];
    let total = cacheTotalBytes(ix);
    for (const k of byOldest) {
        if (total + incoming <= maxBytes) break;
        toEvict.push(k);
        total -= ix[k].size;
    }
    return toEvict;
}

/** Remove a single cache entry (both its IndexedDB record and its index entry). */
export async function cacheDrop(ix: CacheIndex, key: string): Promise<void> {
    delete ix[key];
    await idbDelete(key);
}

/** Evict oldest-first until total + `incoming` fits under CACHE_MAX_BYTES. */
export async function cacheEvictToFit(ix: CacheIndex, incoming: number): Promise<void> {
    for (const k of pickEvictionKeys(ix, incoming, CACHE_MAX_BYTES)) {
        dbg('cache evict (size)', k);
        await cacheDrop(ix, k);
    }
}

/** Read a cached JSON-serializable value by key (updates its LRU timestamp on hit). */
export async function cacheGet<T>(key: string): Promise<T | null> {
    try {
        const db = await openCacheDb();
        const rec = await idbGet(db, key);
        if (!rec) return null;
        const ts = Date.now();
        // Touch LRU — best-effort, never blocks returning the value we already have.
        void cacheLoadIndex().then((ix) => { if (ix[key]) ix[key].ts = ts; }).catch(() => { /* ignore */ });
        void idbPut({ ...rec, ts }).catch(() => { /* ignore */ });
        return rec.value as T;
    } catch (err) {
        dbg('cache get failed', key, err);
        return null;
    }
}

/**
 * Write a cached value. Evicts oldest entries first if needed, and retries
 * on QuotaExceededError by dropping more oldest entries until it fits. Any
 * other write failure is swallowed — the in-memory bulkCache (set by the
 * caller before/alongside this) still holds the just-fetched data, so a
 * persistence failure never blocks the user from seeing it.
 */
export async function cacheSet(key: string, value: unknown): Promise<void> {
    let payload: string;
    try { payload = JSON.stringify(value); } catch { return; }
    const size = payload.length + key.length + 32; // rough byte estimate
    const ix = await cacheLoadIndex();
    // Replacing an existing key frees its old size first.
    if (ix[key]) await cacheDrop(ix, key);
    await cacheEvictToFit(ix, size);

    const rec: CacheRecord = { key, value, ts: Date.now(), size };
    for (let attempt = 0; attempt < 50; attempt++) {
        try {
            await idbPut(rec);
            ix[key] = { ts: rec.ts, size };
            notifyCacheChanged(); // live-update stats
            return;
        } catch (err) {
            if (!isQuotaError(err)) {
                dbg('cache set failed (non-quota)', key, err);
                notifyCacheChanged();
                return; // fail safely — don't crash; just isn't persisted
            }
            // Quota still exceeded — drop the oldest remaining entry and retry.
            const oldest = Object.keys(ix).sort((a, b) => ix[a].ts - ix[b].ts)[0];
            if (!oldest) { dbg('cache: cannot fit even after full eviction'); notifyCacheChanged(); return; }
            dbg('cache evict (quota retry)', oldest);
            await cacheDrop(ix, oldest);
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
export async function cacheStats(): Promise<CacheStats> {
    const ix = await cacheLoadIndex();
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
export async function clearCacheData(): Promise<void> {
    await idbClear();
    try {
        const ix = await cacheLoadIndex();
        for (const k of Object.keys(ix)) delete ix[k];
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
 * CLEAR ALL — wipe EVERYTHING this app stored (localStorage settings/legacy
 * keys + the IndexedDB data cache).
 */
export async function clearAll(): Promise<void> {
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('gex.')) localStorage.removeItem(k);
        }
    } catch { /* ignore */ }
    await idbClear();
    try {
        const ix = await cacheLoadIndex();
        for (const k of Object.keys(ix)) delete ix[k];
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
 * `${providerId}:${SYMBOL}`. Backed by the persistent IndexedDB cache above
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
    // Persisted UI-state (see types.ts's Settings fields doc + main.tsx's
    // boot/restore effect). These three defaults are IDENTICAL to the
    // hardcoded initial values main.tsx used before this feature existed
    // ('desk' tab, no expirations selected, Net GEX only) — so a brand-new
    // user (no persisted blob at all) gets byte-for-byte the same first load.
    activeTab: 'desk',
    selectedExps: [],
    gexMetrics: ['netGex', 'absoluteGamma'],
};

// ---------------------------------------------------------------------------
// Valid-value lists for the two literal-union Settings fields above, used
// ONLY to sanitize a loaded blob (see loadSettings below). These intentionally
// duplicate components/TabSwitcher.tsx's `AppTab`/`APP_TABS` and
// views/GexView.tsx's `GexMetric`/`GEX_METRICS` rather than importing them:
//  - GexView.tsx is React.lazy-loaded by main.tsx specifically so recharts
//    (~500 KB) stays out of the initial bundle; a static import from this
//    eagerly-loaded module would pull GexView.tsx (and recharts) back into
//    the main bundle, defeating that code-split.
//  - Keeping this module free of component/view imports avoids a circular
//    import (TabSwitcher.tsx already imports `ColorThemeId` from types.ts).
// Keep these two arrays in sync by hand if those enums ever change.
// ---------------------------------------------------------------------------
const APP_TAB_VALUES: readonly string[] = ['desk', 'gex', 'chart'];
const GEX_METRIC_VALUES: readonly string[] = ['netGex', 'absoluteGamma', 'callOi', 'putOi', 'callVolume', 'putVolume'];

/** Sanitize a loaded `activeTab`: any value outside the known tabs (missing,
 *  wrong type, stale/removed tab name) falls back to the default ('desk'). */
export function sanitizeActiveTab(v: unknown): Settings['activeTab'] {
    return typeof v === 'string' && APP_TAB_VALUES.includes(v)
        ? (v as Settings['activeTab'])
        : DEFAULT_SETTINGS.activeTab;
}

/** Sanitize a loaded `selectedExps`: non-array -> empty (never crash); any
 *  non-string entries are dropped. An empty RESULT is left as-is (not forced
 *  back to a default) — the user can legitimately have zero expirations
 *  selected (the "None" toggle). Whether a stale-but-well-typed expiration
 *  string still exists for the restored ticker is a DATA-dependent question
 *  this function can't answer; main.tsx's restore effect intersects this
 *  against the freshly fetched expirations list once it has one. */
export function sanitizeSelectedExps(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Sanitize a loaded `gexMetrics`: non-array, or any entry naming a metric
 *  outside GEX_METRIC_VALUES (e.g. a removed/renamed metric), is dropped.
 *  Unlike selectedExps, an EMPTY result after filtering falls back to the
 *  default (['netGex']) rather than staying empty: GexView.tsx's own toggle
 *  UI never allows the user to deselect the last remaining metric (see its
 *  toggle handler — `metrics.length > 1` guards every removal), so a
 *  filtered-to-empty array is itself evidence of a corrupted/stale blob, not
 *  a legitimate state the real UI could ever produce. */
export function sanitizeGexMetrics(v: unknown): Settings['gexMetrics'] {
    if (!Array.isArray(v)) return [...DEFAULT_SETTINGS.gexMetrics];
    const filtered = v.filter((m): m is Settings['gexMetrics'][number] => typeof m === 'string' && GEX_METRIC_VALUES.includes(m));
    return filtered.length > 0 ? filtered : [...DEFAULT_SETTINGS.gexMetrics];
}

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
            activeTab: sanitizeActiveTab(parsed.activeTab),
            selectedExps: sanitizeSelectedExps(parsed.selectedExps),
            gexMetrics: sanitizeGexMetrics(parsed.gexMetrics),
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

/**
 * Whether a settings blob was ALREADY persisted before this call (i.e. this
 * is not a brand-new user's very first visit). This is the boot-time "is
 * there something to restore" check main.tsx's restore effect gates on: a
 * brand-new user's `lastTicker` is indistinguishable in VALUE from a
 * returning user's (both could legitimately be the default 'AAPL'), so the
 * only reliable signal is whether the SETTINGS_KEY record exists at all. Must
 * be read before anything in this session has a chance to write a fresh
 * record (main.tsx calls this once, synchronously, in the same lazy-init
 * pass as its first `loadSettings()` call).
 */
export function hasPersistedSettings(): boolean {
    try { return localStorage.getItem(SETTINGS_KEY) != null; } catch { return false; }
}
