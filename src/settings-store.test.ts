import { describe, expect, test } from 'bun:test';
import {
    bulkKey,
    cacheStats,
    cacheGet,
    cacheSet,
    cacheTotalBytes,
    CACHE_MAX_BYTES,
    clearCacheData,
    fmtBytes,
    pickEvictionKeys,
    type CacheIndex,
} from './settings-store';

// ----------------------------------------------------------------------------
// NOTE ON TEST-ENVIRONMENT COVERAGE
//
// Bun's test runner (`bun test`, no browser/DOM shim configured in this repo)
// does not provide a global `indexedDB`, `localStorage`, or `window` — all
// three are `undefined` under `bun test` (verified directly: `typeof
// indexedDB === 'undefined'`). That means a real IndexedDB round trip (open a
// database, put a record, read it back, evict, hit a quota error, …) cannot
// be exercised here; there is no polyfill like `fake-indexeddb` installed
// (and this task deliberately avoids adding new npm dependencies for the
// cache itself — adding one just for tests felt like it'd be working against
// that same spirit, so this suite instead covers everything that CAN be unit
// tested without a real IndexedDB, and the real round trip was verified live
// against an actual browser instead — see the PR description).
//
// What IS tested here:
//  - The pure LRU eviction-ordering math (`pickEvictionKeys`), which is the
//    crux of the cache's correctness and is fully deterministic/synchronous.
//  - `fmtBytes` / `cacheTotalBytes` / `bulkKey` — pure helpers.
//  - That `cacheGet`/`cacheSet`/`cacheStats`/`clearCacheData` resolve safely
//    (never throw, never hang) when IndexedDB is unavailable, which is
//    exactly the "fail safely" contract this module promises for a browser
//    that can't open the database for any reason.
// ----------------------------------------------------------------------------

describe('pickEvictionKeys (pure LRU eviction ordering)', () => {
    test('evicts nothing when the incoming entry already fits', () => {
        const ix: CacheIndex = { a: { ts: 1, size: 100 }, b: { ts: 2, size: 100 } };
        expect(pickEvictionKeys(ix, 50, 1000)).toEqual([]);
    });

    test('evicts oldest-first until the incoming entry fits', () => {
        const ix: CacheIndex = {
            oldest: { ts: 1, size: 400 },
            middle: { ts: 2, size: 400 },
            newest: { ts: 3, size: 400 },
        };
        // total = 1200, cap = 1000, incoming = 300 → need total <= 700:
        // evict oldest (400) -> total 800 (still > 700), evict middle (400) -> total 400 (fits)
        const evicted = pickEvictionKeys(ix, 300, 1000);
        expect(evicted).toEqual(['oldest', 'middle']);
    });

    test('evicts multiple oldest entries if one is not enough', () => {
        const ix: CacheIndex = {
            a: { ts: 1, size: 500 },
            b: { ts: 2, size: 500 },
            c: { ts: 3, size: 500 },
        };
        // total = 1500, cap = 1000, incoming = 600 → need total <= 400:
        // evict a (500) -> 1000, evict b (500) -> 500, evict c (500) -> 0 (fits)
        const evicted = pickEvictionKeys(ix, 600, 1000);
        expect(evicted).toEqual(['a', 'b', 'c']);
    });

    test('a single entry larger than the cap evicts nothing (caller handles via quota retry)', () => {
        const ix: CacheIndex = { a: { ts: 1, size: 10 } };
        expect(pickEvictionKeys(ix, 2000, 1000)).toEqual([]);
    });

    test('empty index evicts nothing', () => {
        expect(pickEvictionKeys({}, 50, 1000)).toEqual([]);
    });

    test('defaults to CACHE_MAX_BYTES when no cap is given', () => {
        const ix: CacheIndex = { a: { ts: 1, size: CACHE_MAX_BYTES } };
        // incoming on top of an already-full cache must evict the one entry
        expect(pickEvictionKeys(ix, 1)).toEqual(['a']);
    });
});

describe('cacheTotalBytes', () => {
    test('sums sizes across all keys', () => {
        const ix: CacheIndex = { a: { ts: 1, size: 10 }, b: { ts: 2, size: 20 } };
        expect(cacheTotalBytes(ix)).toBe(30);
    });
    test('is 0 for an empty index', () => {
        expect(cacheTotalBytes({})).toBe(0);
    });
});

describe('fmtBytes', () => {
    test('formats bytes, KB, and MB', () => {
        expect(fmtBytes(500)).toBe('500 B');
        expect(fmtBytes(2048)).toBe('2.0 KB');
        expect(fmtBytes(5_242_880)).toBe('5.00 MB');
    });
});

describe('bulkKey', () => {
    test('uppercases the symbol and namespaces by provider', () => {
        expect(bulkKey('cache', 'spy')).toBe('cache:SPY');
        expect(bulkKey('cboe', 'SPX')).toBe('cboe:SPX');
    });
});

describe('cache functions fail safely when IndexedDB is unavailable', () => {
    // In this test environment `indexedDB` is undefined, so every function
    // below exercises the "IndexedDB unavailable" fallback path rather than a
    // real round trip — see the note at the top of this file.
    test('cacheGet resolves to null instead of throwing', async () => {
        await expect(cacheGet('some-key')).resolves.toBeNull();
    });

    test('cacheSet resolves (does not throw / hang) even though nothing can persist', async () => {
        await expect(cacheSet('some-key', { a: 1 })).resolves.toBeUndefined();
    });

    test('cacheStats resolves to an empty-cache snapshot', async () => {
        const stats = await cacheStats();
        expect(stats.entries).toBe(0);
        expect(stats.bytes).toBe(0);
        expect(stats.maxBytes).toBe(CACHE_MAX_BYTES);
        expect(stats.oldest).toBeNull();
        expect(stats.newest).toBeNull();
    });

    test('clearCacheData resolves without throwing', async () => {
        await expect(clearCacheData()).resolves.toBeUndefined();
    });
});
