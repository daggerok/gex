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
}

const STORAGE_PREFIX = 'gex.customLevels.v1.';

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
                ? [{ id: o.id, name: o.name, price: o.price }]
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
