/// <reference lib="esnext" />
// ============================================================================
// CHART ZOOM STORE - the horizontal zoom and position of the GEX chart, remembered PER TICKER in the
// browser. A zoom is a strike range, meaningless for another ticker (SPX at 7000 against SPY at 700),
// so every ticker has its own entry: switching from SPY to SPX and back finds SPY as it was left.
// The first version kept ONE entry (`gex.chartZoom.v1`, a single symbol), so working on a second ticker
// threw the first one's zoom away. Pure helpers plus a small localStorage wrapper that never throws.
// ============================================================================

export type ZoomRange = [number, number];
/** symbol -> its zoomed range. A ticker at the default (full) view has no entry. */
export type ZoomMap = Record<string, ZoomRange>;

export const CHART_ZOOM_KEY_V1 = 'gex.chartZoom.v1';
export const CHART_ZOOM_KEY = 'gex.chartZoom.v2';

/** Tickers remembered at most: the oldest used are forgotten first. */
export const MAX_ZOOMED_TICKERS = 200;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const defaultStorage = (): Storage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

const isRange = (v: unknown): v is ZoomRange => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) && v[0] < v[1];

/** The map out of the saved text, keeping only well-formed entries. */
export function parseZoomMap(raw: string | null): ZoomMap {
    if (!raw) return {};
    try {
        const data: unknown = JSON.parse(raw);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
        const out: ZoomMap = {};
        for (const [symbol, range] of Object.entries(data)) if (symbol && isRange(range)) out[symbol] = range;
        return out;
    } catch {
        return {};
    }
}

/** The one entry the first version kept (`{ symbol, xZoom }`), as a map. */
export function parseLegacyZoom(raw: string | null): ZoomMap {
    if (!raw) return {};
    try {
        const data = JSON.parse(raw) as { symbol?: unknown; xZoom?: unknown } | null;
        return data && typeof data.symbol === 'string' && data.symbol && isRange(data.xZoom) ? { [data.symbol]: data.xZoom } : {};
    } catch {
        return {};
    }
}

/**
 * The map with `symbol` set to `range` (null = back to the full view, its entry is removed). The ticker just used moves
 * to the end, and past `max` entries the oldest ones are dropped. Returns a new map.
 */
export function withZoom(map: ZoomMap, symbol: string, range: ZoomRange | null, max: number = MAX_ZOOMED_TICKERS): ZoomMap {
    const out: ZoomMap = {};
    for (const [s, r] of Object.entries(map)) if (s !== symbol) out[s] = r;
    if (range && isRange(range)) out[symbol] = range;
    const keys = Object.keys(out);
    for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete out[k];
    return out;
}

/** The remembered range of a ticker, or null for the default view. */
export const zoomFor = (map: ZoomMap, symbol: string): ZoomRange | null => map[symbol] ?? null;

/** Saved zooms of every ticker. A save made by the first version (one ticker) is picked up when there is no new one yet. */
export function loadChartZooms(storage: Storage | null = defaultStorage()): ZoomMap {
    try {
        const current = storage?.getItem(CHART_ZOOM_KEY) ?? null;
        return current !== null ? parseZoomMap(current) : parseLegacyZoom(storage?.getItem(CHART_ZOOM_KEY_V1) ?? null);
    } catch {
        return {};
    }
}

export function saveChartZooms(map: ZoomMap, storage: Storage | null = defaultStorage()): void {
    try {
        storage?.setItem(CHART_ZOOM_KEY, JSON.stringify(map));
    } catch {
        // storage blocked or full: the zoom is just not remembered
    }
}

// ---- The Chart tab (candles): the visible time window per ticker and the chosen range button ----
// A window is stored as offsets from the LAST bar (`[left, right]` in bars, `left` negative), not as bar numbers, so it
// stays in place when a new day's bar arrives. Same per-ticker map and the same helpers as the GEX zoom above.

export const CHART_VIEW_KEY = 'gex.chartView.v1';
export const CHART_RANGE_KEY = 'gex.chartRange.v1';

export function loadChartViews(storage: Storage | null = defaultStorage()): ZoomMap {
    try {
        return parseZoomMap(storage?.getItem(CHART_VIEW_KEY) ?? null);
    } catch {
        return {};
    }
}

export function saveChartViews(map: ZoomMap, storage: Storage | null = defaultStorage()): void {
    try {
        storage?.setItem(CHART_VIEW_KEY, JSON.stringify(map));
    } catch {
        // storage blocked or full: the view is just not remembered
    }
}

/** The range button chosen last (`1mo`, `3mo`, `6mo`, `1y`), or the fallback when nothing valid was saved. */
export function loadChartRange<T extends string>(allowed: readonly T[], fallback: T, storage: Storage | null = defaultStorage()): T {
    try {
        const v = storage?.getItem(CHART_RANGE_KEY);
        return allowed.find((a) => a === v) ?? fallback;
    } catch {
        return fallback;
    }
}

export function saveChartRange(range: string, storage: Storage | null = defaultStorage()): void {
    try {
        storage?.setItem(CHART_RANGE_KEY, range);
    } catch {
        // not remembered
    }
}
