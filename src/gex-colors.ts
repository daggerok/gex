/// <reference lib="esnext" />
// ---------------------------------------------------------------------------
// GEX level colors - shared by the GEX tab (Key Levels card + recharts
// reference lines) and the Chart tab's lightweight-charts price lines (plan sections
// 8.1 / 8.2) so both tabs use the exact same color per level.
//
// `hex` is for chart libraries that take raw colors (recharts and
// lightweight-charts). `dot` is the matching Tailwind class for
// HTML swatches; class names are spelled out literally so Tailwind's source
// scanner picks them up. Values follow the original Tab 2 design.
// ---------------------------------------------------------------------------

/**
 * `gammaFlip` is the single collapsed Gamma Flip value (GexLevels.gammaFlip),
 * used by BOTH ChartView.tsx (the Chart tab's lightweight-charts price lines)
 * AND GexView.tsx (the GEX tab's toggleable/colorable Key Levels panel) - a
 * short-lived adaptive gammaFlipPos/gammaFlipNeg dual-display mechanism in
 * GexView.tsx was removed; Gamma Flip is now one plain Key Level everywhere,
 * same as Max Net GEX/Min Net GEX/Max Pain.
 *
 * Resistance 1.5 / Support 1.5 (`maxNetGex1_5`/`minNetGex1_5`) existed briefly
 * between the primary wall and the distance-filtered `netGexPlus`/`netGexMinus`
 * (one shade lighter than `maxNetGex`/`minNetGex`, one shade darker than
 * `netGexPlus`/`netGexMinus`) but were removed entirely - the user found them not
 * working out after shipping them (see GexView.tsx's ALL_LEVEL_KEYS doc
 * comment, and the corresponding math/field removal in src/gex.ts/
 * src/types.ts, done in a separate PR).
 */
export type GexLevelKey = 'maxNetGex' | 'netGexPlus' | 'gammaFlip' | 'zeroGex' | 'minNetGex' | 'netGexMinus' | 'sumNetGexPlus' | 'sumNetGexMinus' | 'maxPain' | 'maxAbsGamma' | 'sigma' | 'spot';

/** Every level key with ONE price in GexLevels (`levels[key]` is a number or null). `sigma` is a ladder of six strikes
 *  (GexLevels.sigma), read through its own helpers in level-prefs.ts. */
export type PriceLevelKey = Exclude<GexLevelKey, 'sigma'>;

export interface GexLevelColor {
    hex: string;
    dot: string;
}

export const GEX_LEVEL_COLORS: Record<GexLevelKey, GexLevelColor> = {
    maxNetGex: { hex: '#089981', dot: 'bg-[#089981]' },  // TradingView's default up green (owner 2026-10-25, was green-500)
    netGexPlus: { hex: '#86efac', dot: 'bg-green-300' },  // green-300 (Net GEX+)
    gammaFlip: { hex: '#a78bfa', dot: 'bg-violet-400' }, // violet-400
    zeroGex: { hex: '#d946ef', dot: 'bg-fuchsia-500' }, // fuchsia-500 (Zero GEX, the owner's per-strike sign change; violet is the Gamma Flip)
    minNetGex: { hex: '#f23645', dot: 'bg-[#f23645]' },  // TradingView's default down red (owner 2026-10-25, was red-500)
    netGexMinus: { hex: '#fca5a5', dot: 'bg-red-300' },     // red-300 (Net GEX-)
    sumNetGexPlus: { hex: '#22d3ee', dot: 'bg-cyan-400' },  // cyan-400
    sumNetGexMinus: { hex: '#f472b6', dot: 'bg-pink-400' },   // pink-400
    maxPain: { hex: '#facc15', dot: 'bg-yellow-400' },   // yellow-400
    maxAbsGamma: { hex: '#60a5fa', dot: 'bg-blue-400' }, // blue-400 (the AG series is blue too)
    // Sigma levels (all six, both modes): one grey, readable on the white and the dark card (owner 2026-10-25: grey and
    // dotted, 1σ / 2σ / 3σ told apart by their labels only)
    sigma: { hex: '#64748b', dot: 'bg-slate-500' },     // slate-500
    spot: { hex: '#f59e0b', dot: 'bg-amber-500' },       // amber-500
};

/**
 * Absolute Gamma dots on the GEX chart (owner 2026-10-25, "AG dots v3", replaces the sign-coloured v2 dots): every strike
 * on the AG line gets a hollow RING - stroke in the Absolute Gamma line colour (`metricColors.absoluteGamma`, so it follows
 * a custom colour), no fill, so the bar or the card shows through. The dots no longer carry the Net GEX sign. Only the
 * ring of the hovered (active) dot takes a theme token: a high-contrast stroke readable on that theme's card
 * (white / slate-800) whatever the AG colour is.
 */
export const AG_DOT_HOVER_RING: Readonly<Record<'light' | 'dark', string>> = {
    light: '#0f172a', // slate-900
    dark: '#f8fafc', // slate-50
};

/** Stroke width of the AG rings, in px (owner: ~1.5-2 px, readable in both themes). */
export const AG_DOT_STROKE_WIDTH = 1.75;

/**
 * The Board's peak and runner-up dots (owner 2026-10-25, replaces the sign-coloured dots): one blue for every column and for
 * peaks and runner-ups alike, so the dot reads as "a top value" and never competes with the Net GEX sign colours of the row
 * and cell tints. Light blue on the dark table, a darker blue on the white one. Contrast of the dot against what it sits on
 * (WCAG 1.4.11 asks 3:1 for graphics): light sky-700 5.93 on white, 4.93 on the green peak tint, 4.75 on the red one, 5.03
 * on the ATM tint; dark sky-300 10.71 on slate-900, 8.77 green tint, 9.36 red tint, 5.91 ATM tint.
 */
export const BOARD_PEAK_DOT: Readonly<Record<'light' | 'dark', string>> = {
    light: '#0369a1', // sky-700 (owner 2026-10-25, was sky-600 #0284c7: 3.28 on the red tint)
    dark: '#7dd3fc', // sky-300
};

/** Lines the user adds to the Chart tab with a right click (not a GEX level, so it has no GexLevelKey). */
export const CUSTOM_LEVEL_COLOR: GexLevelColor = { hex: '#38bdf8', dot: 'bg-sky-400' }; // sky-400

/** Bar fills for the GEX tab: call-side (positive) vs put-side (negative).
 *  Used by the signed netGex pos/neg stacked bars. */
export const GEX_BAR_COLORS = {
    call: '#089981', // TradingView's default up green (owner 2026-10-25, was green-500 #22c55e)
    put: '#f23645',  // TradingView's default down red (owner 2026-10-25, was red-500 #ef4444)
} as const;

/**
 * Per-metric bar colors for the OI/Volume grouped-bar overlay (multi-metric
 * chart, section 8.1): call side stays green, put side stays red (same
 * convention as GEX_BAR_COLORS), with OI the solid shade and Volume the
 * lighter shade so the two are distinguishable when both are shown at once -
 * reuses the exact green-300/red-300 already defined above for
 * netGexPlus/netGexMinus, instead of inventing new colors.
 */
export const GEX_METRIC_COLORS: Record<'callOi' | 'putOi' | 'callVolume' | 'putVolume', string> = {
    callOi: '#22c55e',                            // green-500 (kept when the default sign green became #089981)
    callVolume: GEX_LEVEL_COLORS.netGexPlus.hex,  // green-300
    putOi: '#ef4444',                             // red-500 (kept when the default sign red became #f23645)
    putVolume: GEX_LEVEL_COLORS.netGexMinus.hex,    // red-300
};

// ---------------------------------------------------------------------------
// USER-CUSTOMIZABLE PER-METRIC CHART COLORS (GEX tab multi-metric bar chart).
// Lets the user override the bar color for each of the 6 series (Net GEX
// positive/negative + the 4 OI/Volume metrics) via a color picker. Persisted
// in its own dedicated localStorage key rather than folded into the shared
// `Settings` object/`SETTINGS_KEY` blob (see settings-store.ts): `Settings` is
// loaded/saved as one object there, and this is a small, independent,
// GEX-chart-only preference - a separate key avoids coupling its shape (and
// any future additions to it) to unrelated settings migrations. Every
// localStorage access is wrapped in try/catch, matching this app's existing
// convention (settings-store.ts's cacheGet/cacheSet/loadSettings/saveSettings).
// ---------------------------------------------------------------------------

export interface MetricColorSet {
    netGexPos: string;
    netGexNeg: string;
    /** Absolute Gamma (AG) - single unsigned series, its own secondary Y
     *  axis, rendered as a filled area rather than bars (GexView.tsx). A
     *  blue not already used by any other metric/level, so AG's area reads
     *  as visually distinct from every signed call(green)/put(red) bar. */
    absoluteGamma: string;
    callOi: string;
    putOi: string;
    callVolume: string;
    putVolume: string;
    /** Per-strike put/call ratio lines, each on the shared ratio axis. */
    pcRatioOi: string;
    pcRatioVolume: string;
}

/** Defaults mirror today's hardcoded chart colors exactly. */
export const DEFAULT_METRIC_COLORS: MetricColorSet = {
    netGexPos: GEX_BAR_COLORS.call,
    netGexNeg: GEX_BAR_COLORS.put,
    absoluteGamma: '#3b82f6', // blue-500
    callOi: GEX_METRIC_COLORS.callOi,
    putOi: GEX_METRIC_COLORS.putOi,
    callVolume: GEX_METRIC_COLORS.callVolume,
    putVolume: GEX_METRIC_COLORS.putVolume,
    pcRatioOi: '#14b8a6',     // teal-500
    pcRatioVolume: '#f97316', // orange-500
};

export const METRIC_COLORS_KEY = 'gex.metricColors.v1';

/** Load custom metric colors from localStorage, merged over the defaults
 *  (forward-compatible: a stored blob missing a key, or from an older
 *  shape, still yields a complete, valid MetricColorSet). */
export function loadMetricColors(): MetricColorSet {
    try {
        const raw = localStorage.getItem(METRIC_COLORS_KEY);
        if (!raw) return { ...DEFAULT_METRIC_COLORS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_METRIC_COLORS, ...parsed };
    } catch {
        return { ...DEFAULT_METRIC_COLORS };
    }
}

/** Persist custom metric colors to localStorage (best-effort; ignores quota/
 *  serialization errors, same convention as settings-store.ts's saveSettings). */
export function saveMetricColors(colors: MetricColorSet): void {
    try { localStorage.setItem(METRIC_COLORS_KEY, JSON.stringify(colors)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// USER-CUSTOMIZABLE PER-LEVEL CHART COLORS (GEX tab Key Levels toggle+color
// panel). Exact same pattern as MetricColorSet above, covering every
// GexLevelKey including the plain `gammaFlip` entry: GexView.tsx treats
// Gamma Flip as one ordinary toggleable/colorable Key Level now (the earlier
// gammaFlipPos/gammaFlipNeg dual-display mechanism was removed), so it needs
// its own persisted color/selection state exactly like every other level.
// `spot` WAS excluded too (it used to always be drawn, un-toggleable) but is
// now a toggleable/colorable Key Level like the rest - it's the reference
// point every other level's position is read relative to, which is reason
// enough to let the user show/hide and recolor it the same way. A dedicated
// localStorage key (not METRIC_COLORS_KEY) keeps this independent of the
// metric-color blob, same reasoning as that key's own comment above.
// ---------------------------------------------------------------------------

export type LevelColorSet = Record<GexLevelKey, string>;

/** Defaults mirror today's hardcoded GEX_LEVEL_COLORS hex values exactly. */
export const DEFAULT_LEVEL_COLORS: LevelColorSet = {
    maxNetGex: GEX_LEVEL_COLORS.maxNetGex.hex,
    netGexPlus: GEX_LEVEL_COLORS.netGexPlus.hex,
    gammaFlip: GEX_LEVEL_COLORS.gammaFlip.hex,
    zeroGex: GEX_LEVEL_COLORS.zeroGex.hex,
    minNetGex: GEX_LEVEL_COLORS.minNetGex.hex,
    netGexMinus: GEX_LEVEL_COLORS.netGexMinus.hex,
    sumNetGexPlus: GEX_LEVEL_COLORS.sumNetGexPlus.hex,
    sumNetGexMinus: GEX_LEVEL_COLORS.sumNetGexMinus.hex,
    maxPain: GEX_LEVEL_COLORS.maxPain.hex,
    maxAbsGamma: GEX_LEVEL_COLORS.maxAbsGamma.hex,
    sigma: GEX_LEVEL_COLORS.sigma.hex,
    spot: GEX_LEVEL_COLORS.spot.hex,
};

export const LEVEL_COLORS_KEY = 'gex.levelColors.v1';

/** Level keys renamed on 2026-10-07 (callWall -> maxNetGex, ...): colors saved
 *  under an old key are carried over to the new one so users keep their picks. */
export const LEGACY_LEVEL_COLOR_KEYS: Readonly<Record<string, GexLevelKey>> = {
    callWall: 'maxNetGex',
    putWall: 'minNetGex',
    callWall2: 'netGexPlus',
    putWall2: 'netGexMinus',
    gammaRangeHigh: 'sumNetGexPlus',
    gammaRangeLow: 'sumNetGexMinus',
};

/** Merges saved colors over the defaults, mapping legacy keys to their new names
 *  (a value saved under the new key wins over one under the legacy key). */
export function mergeLevelColors(parsed: unknown): LevelColorSet {
    const out: LevelColorSet = { ...DEFAULT_LEVEL_COLORS };
    if (!parsed || typeof parsed !== 'object') return out;
    const saved = parsed as Record<string, unknown>;
    for (const [oldKey, newKey] of Object.entries(LEGACY_LEVEL_COLOR_KEYS)) {
        if (typeof saved[oldKey] === 'string') out[newKey] = saved[oldKey] as string;
    }
    for (const key of Object.keys(DEFAULT_LEVEL_COLORS) as GexLevelKey[]) {
        if (typeof saved[key] === 'string') out[key] = saved[key] as string;
    }
    return out;
}

/** Load custom level colors from localStorage, merged over the defaults
 *  (forward-compatible, same convention as loadMetricColors). */
export function loadLevelColors(): LevelColorSet {
    try {
        const raw = localStorage.getItem(LEVEL_COLORS_KEY);
        if (!raw) return { ...DEFAULT_LEVEL_COLORS };
        return mergeLevelColors(JSON.parse(raw));
    } catch {
        return { ...DEFAULT_LEVEL_COLORS };
    }
}

/** Persist custom level colors to localStorage (best-effort, same convention
 *  as saveMetricColors). */
export function saveLevelColors(colors: LevelColorSet): void {
    try { localStorage.setItem(LEVEL_COLORS_KEY, JSON.stringify(colors)); } catch { /* ignore */ }
}
