// Auto refresh of a ticker served from the published cache (CACHE provider): the open page asks for its file again every
// CACHE_REFRESH_MS and swaps the new chain in place only when the file is newer. The rules are here, main.tsx only calls them.

/** How often the open page asks for the cache file again. The request is conditional (ETag), an unchanged file costs no download. */
export const CACHE_REFRESH_MS = 120_000;

/**
 * True when the file just fetched is newer than the one on screen. `updated` is the stamp the fetcher writes into every
 * cache file (ISO time). An unknown or unreadable stamp on either side never refreshes: the shown data stays.
 */
export function isNewerCacheFile(shown: string | null | undefined, fetched: string | null | undefined): boolean {
    const a = Date.parse(shown ?? '');
    const b = Date.parse(fetched ?? '');
    return !isNaN(a) && !isNaN(b) && b > a;
}
