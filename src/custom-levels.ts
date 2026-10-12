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

/** Reddish colours: a level ABOVE the current price (premium) starts with one of these. */
export const PREMIUM_COLORS = ['#fb7185', '#f43f5e', '#fda4af'] as const;
/** Greenish colours: a level BELOW the current price (discount) starts with one of these. */
export const DISCOUNT_COLORS = ['#34d399', '#10b981', '#6ee7b7'] as const;
/** Neutral colours: a level at the current price, or when the price is not known. */
export const NEUTRAL_COLORS = ['#38bdf8', '#f97316', '#c084fc', '#94a3b8'] as const;

/** Colours offered for a custom level (none of them is a GEX level colour): premium, discount, neutral. */
export const LEVEL_PALETTE = [...PREMIUM_COLORS, ...DISCOUNT_COLORS, ...NEUTRAL_COLORS] as const;

export const isHexColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

/** The colour of a custom level: its own, or the first palette colour for a level saved before colours existed. */
export const levelColorOf = (level: Pick<CustomLevel, 'color'>): string => (isHexColor(level.color) ? level.color : LEVEL_PALETTE[0]);

/**
 * A colour to propose for a new level, by where it sits against the current price (`spot`): above it reddish (premium),
 * below it greenish (discount), at it or with no price known a neutral one. It is chosen at random among the colours of that
 * kind no existing level uses yet; when all are taken, any of that kind. `random` is injectable for tests. The owner can
 * change the colour like the name.
 */
export function proposeLevelColor(
    existing: ReadonlyArray<Pick<CustomLevel, 'color'>>,
    price: number,
    spot: number | null | undefined,
    random: () => number = Math.random,
): string {
    const kind: readonly string[] = spot == null || !Number.isFinite(spot) || price === spot ? NEUTRAL_COLORS : price > spot ? PREMIUM_COLORS : DISCOUNT_COLORS;
    const used = new Set(existing.map((l) => (isHexColor(l.color) ? l.color.toLowerCase() : '')));
    const free = kind.filter((c) => !used.has(c));
    const pool = free.length ? free : kind;
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

/**
 * Default name of a NEW level by where it sits against the current price: above it `Buyside`, below it `Sellside` (the
 * liquidity resting there), then `Buyside 2`, `Buyside 3`... when the plain name is taken (smallest free, case-insensitive). At
 * the price, or without a usable price, it falls back to `nextLevelName` (`Level 1`...). `names` are the words for the UI language.
 */
export function defaultLevelName(
    levels: ReadonlyArray<Pick<CustomLevel, 'name'>>,
    price: number,
    spot: number | null | undefined,
    names: { above: string; below: string; plain: string },
): string {
    if (typeof spot !== 'number' || !Number.isFinite(spot) || !Number.isFinite(price) || price === spot) return nextLevelName(levels, names.plain);
    const base = price > spot ? names.above : names.below;
    const used = new Set(levels.map((l) => l.name.trim().toLowerCase()));
    if (!used.has(base.toLowerCase())) return base;
    let n = 2;
    while (used.has(`${base} ${n}`.toLowerCase())) n++;
    return `${base} ${n}`;
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

/** `{ version: 1, levels: { SPY: [...] } }`, the content of `custom-levels.json` in a backup: only tickers that have levels. */
export function customLevelsFileText(levels: Readonly<Record<string, readonly CustomLevel[]>>, tickers: readonly string[]): string | null {
    const out: Record<string, CustomLevel[]> = {};
    for (const t of [...tickers].sort()) if (levels[t]?.length) out[t] = levels[t].map((l) => ({ ...l }));
    return Object.keys(out).length ? JSON.stringify({ version: 1, levels: out }) + '\n' : null;
}

/** Reads the text of `custom-levels.json`; a damaged file or a wrong version gives no levels, and bad entries are dropped. */
export function parseCustomLevelsFile(text: string | null): Record<string, CustomLevel[]> {
    const out: Record<string, CustomLevel[]> = {};
    if (!text) return out;
    try {
        const j = JSON.parse(text) as { version?: unknown; levels?: unknown };
        if (j?.version !== 1 || !j.levels || typeof j.levels !== 'object') return out;
        for (const [symbol, list] of Object.entries(j.levels as Record<string, unknown>)) {
            const levels = parseCustomLevels(JSON.stringify(list));
            if (levels.length) out[symbol] = levels;
        }
    } catch {
        // damaged file: no levels
    }
    return out;
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
