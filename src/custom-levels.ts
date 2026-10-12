// ============================================================================
// CUSTOM CHART LEVELS - horizontal price lines the user adds to the Chart tab
// with a right click (Ctrl+click on macOS). Pure helpers plus a per-symbol
// localStorage store. Never touches GEX math (rule R1): these are plain
// user-named prices, not model output.
// ============================================================================

export interface CustomLevel {
    id: string;
    name: string;
    price: number;
    /** `#rrggbb`, proposed at random when the level is created and changeable like the name; absent in older saves */
    color?: string;
    /** true = the level stays in the lists but is not drawn on the charts (its toggle in the Levels panel is off) */
    hidden?: boolean;
}

/** Colours offered for a custom level, none of them is a GEX level colour. */
export const LEVEL_PALETTE = ['#38bdf8', '#fb7185', '#f97316', '#a3e635', '#2dd4bf', '#c084fc', '#e879f9', '#3b82f6', '#818cf8', '#94a3b8'] as const;

export const isHexColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

/** The colour of a custom level: its own, or the first palette colour for a level saved before colours existed. */
export const levelColorOf = (level: Pick<CustomLevel, 'color'>): string => (isHexColor(level.color) ? level.color : LEVEL_PALETTE[0]);

/**
 * A colour to propose for a new level: chosen at random among the palette colours no existing level uses yet, so a new
 * level looks different from the others; when all are taken, any of the palette. `random` is injectable for tests.
 */
export function proposeLevelColor(existing: ReadonlyArray<Pick<CustomLevel, 'color'>>, random: () => number = Math.random): string {
    const used = new Set(existing.map((l) => (isHexColor(l.color) ? l.color.toLowerCase() : '')));
    const free = LEVEL_PALETTE.filter((c) => !used.has(c));
    const pool = free.length ? free : LEVEL_PALETTE;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

const STORAGE_PREFIX = 'gex.customLevels.v1.';

/**
 * The strike nearest to a price (the lower one when the price is exactly between two), or null when there are no strikes.
 * A click on a chart picks a level on a strike, never between two.
 */
export function nearestStrike(price: number, strikes: readonly number[]): number | null {
    let best: number | null = null;
    for (const k of strikes) {
        if (!Number.isFinite(k)) continue;
        if (best === null) { best = k; continue; }
        const d = Math.abs(k - price);
        const bd = Math.abs(best - price);
        if (d < bd || (d === bd && k < best)) best = k;
    }
    return best;
}

/** Prices are stored with cent precision, a chart click gives a float like 512.3478. */
export function roundPrice(price: number): number {
    return Math.round(price * 100) / 100;
}

/**
 * Default name of the next level: `<prefix> 1`, or `<prefix> 2` when 1 is taken,
 * and so on - the smallest number whose name is free (case-insensitive), so a
 * removed `Level 1` is reused before `Level 3` is handed out.
 */
export function nextLevelName(levels: ReadonlyArray<Pick<CustomLevel, 'name'>>, prefix = 'Level'): string {
    const used = new Set(levels.map((l) => l.name.trim().toLowerCase()));
    let n = 1;
    while (used.has(`${prefix} ${n}`.toLowerCase())) n++;
    return `${prefix} ${n}`;
}

/** Keeps only well-formed entries of whatever was stored, so a damaged value never breaks the tab. */
export function parseCustomLevels(raw: string | null): CustomLevel[] {
    if (!raw) return [];
    try {
        const data: unknown = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        return data.flatMap((d: unknown) => {
            const o = d as Partial<CustomLevel> | null;
            return o && typeof o.id === 'string' && typeof o.name === 'string' && typeof o.price === 'number' && Number.isFinite(o.price)
                ? [{ id: o.id, name: o.name, price: o.price, ...(isHexColor(o.color) ? { color: o.color } : {}), ...(o.hidden === true ? { hidden: true } : {}) }]
                : [];
        });
    } catch {
        return [];
    }
}

export function loadCustomLevels(symbol: string): CustomLevel[] {
    try {
        return parseCustomLevels(localStorage.getItem(STORAGE_PREFIX + symbol));
    } catch {
        return [];
    }
}

export function saveCustomLevels(symbol: string, levels: CustomLevel[]): void {
    try {
        if (levels.length) localStorage.setItem(STORAGE_PREFIX + symbol, JSON.stringify(levels));
        else localStorage.removeItem(STORAGE_PREFIX + symbol);
    } catch {
        // storage blocked or full: the levels still work for this session
    }
}

/**
 * True on macOS and iOS/iPadOS (the editor buttons sit top left there, top right on Windows and Linux).
 * iPadOS reports itself as a Mac, so a Mac with a touch screen counts as an iPad.
 */
export function isApplePlatform(nav: { platform?: string; userAgent?: string; maxTouchPoints?: number; userAgentData?: { platform?: string } } | null = typeof navigator === 'undefined' ? null : navigator): boolean {
    if (!nav) return false;
    const platform = nav.userAgentData?.platform || nav.platform || '';
    const ua = nav.userAgent ?? '';
    if (/iPhone|iPad|iPod/i.test(platform) || /iPhone|iPad|iPod/i.test(ua)) return true;
    return /^(mac|darwin)/i.test(platform) || (platform === '' && /Macintosh|Mac OS X/i.test(ua));
}
