// ---------------------------------------------------------------------------
// GEX level colors - shared by the GEX tab (Key Levels card + recharts
// reference lines) and the Chart tab's lightweight-charts price lines (plan sections
// 8.1 / 8.2) so both tabs use the exact same color per level.
//
// `hex` is for chart libraries that take raw colors (recharts and
// lightweight-charts). `dot` is the matching Tailwind class for
// HTML swatches; class names are spelled out literally so Tailwind's source
// scanner picks them up. Values follow the Tab 2 wireframe.
// ---------------------------------------------------------------------------

export type GexLevelKey = 'callWall' | 'callWall2' | 'gammaFlip' | 'putWall' | 'putWall2' | 'maxPain' | 'spot';

export interface GexLevelColor {
    hex: string;
    dot: string;
}

export const GEX_LEVEL_COLORS: Record<GexLevelKey, GexLevelColor> = {
    callWall: { hex: '#22c55e', dot: 'bg-green-500' },   // green-500
    callWall2: { hex: '#86efac', dot: 'bg-green-300' },  // green-300 (Resistance 2)
    gammaFlip: { hex: '#a78bfa', dot: 'bg-violet-400' }, // violet-400
    putWall: { hex: '#ef4444', dot: 'bg-red-500' },      // red-500
    putWall2: { hex: '#fca5a5', dot: 'bg-red-300' },     // red-300 (Support 2)
    maxPain: { hex: '#facc15', dot: 'bg-yellow-400' },   // yellow-400
    spot: { hex: '#f59e0b', dot: 'bg-amber-500' },       // amber-500
};

/** Bar fills for the GEX tab: call-side (positive) vs put-side (negative).
 *  Used by the signed netGex pos/neg stacked bars. */
export const GEX_BAR_COLORS = {
    call: '#22c55e', // green-500
    put: '#ef4444',  // red-500
} as const;

/**
 * Per-metric bar colors for the OI/Volume grouped-bar overlay (multi-metric
 * chart, section 8.1): call side stays green, put side stays red (same
 * convention as GEX_BAR_COLORS), with OI the solid shade and Volume the
 * lighter shade so the two are distinguishable when both are shown at once -
 * reuses the exact green-300/red-300 already defined above for
 * callWall2/putWall2, instead of inventing new colors.
 */
export const GEX_METRIC_COLORS: Record<'callOi' | 'putOi' | 'callVolume' | 'putVolume', string> = {
    callOi: GEX_LEVEL_COLORS.callWall.hex,       // green-500
    callVolume: GEX_LEVEL_COLORS.callWall2.hex,  // green-300
    putOi: GEX_LEVEL_COLORS.putWall.hex,         // red-500
    putVolume: GEX_LEVEL_COLORS.putWall2.hex,    // red-300
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
    callOi: string;
    putOi: string;
    callVolume: string;
    putVolume: string;
}

/** Defaults mirror today's hardcoded chart colors exactly. */
export const DEFAULT_METRIC_COLORS: MetricColorSet = {
    netGexPos: GEX_BAR_COLORS.call,
    netGexNeg: GEX_BAR_COLORS.put,
    callOi: GEX_METRIC_COLORS.callOi,
    putOi: GEX_METRIC_COLORS.putOi,
    callVolume: GEX_METRIC_COLORS.callVolume,
    putVolume: GEX_METRIC_COLORS.putVolume,
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
// panel). Exact same pattern as MetricColorSet above, one level short of
// GEX_LEVEL_COLORS - `spot` is always drawn (it isn't one of the 6 toggleable
// Key Levels: Call Wall / Resistance 2 / Gamma Flip / Put Wall / Support 2 /
// Max Pain), so it's intentionally excluded here. A dedicated localStorage
// key (not METRIC_COLORS_KEY) keeps this independent of the metric-color
// blob, same reasoning as that key's own comment above.
// ---------------------------------------------------------------------------

export type LevelColorSet = Record<Exclude<GexLevelKey, 'spot'>, string>;

/** Defaults mirror today's hardcoded GEX_LEVEL_COLORS hex values exactly. */
export const DEFAULT_LEVEL_COLORS: LevelColorSet = {
    callWall: GEX_LEVEL_COLORS.callWall.hex,
    callWall2: GEX_LEVEL_COLORS.callWall2.hex,
    gammaFlip: GEX_LEVEL_COLORS.gammaFlip.hex,
    putWall: GEX_LEVEL_COLORS.putWall.hex,
    putWall2: GEX_LEVEL_COLORS.putWall2.hex,
    maxPain: GEX_LEVEL_COLORS.maxPain.hex,
};

export const LEVEL_COLORS_KEY = 'gex.levelColors.v1';

/** Load custom level colors from localStorage, merged over the defaults
 *  (forward-compatible, same convention as loadMetricColors). */
export function loadLevelColors(): LevelColorSet {
    try {
        const raw = localStorage.getItem(LEVEL_COLORS_KEY);
        if (!raw) return { ...DEFAULT_LEVEL_COLORS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_LEVEL_COLORS, ...parsed };
    } catch {
        return { ...DEFAULT_LEVEL_COLORS };
    }
}

/** Persist custom level colors to localStorage (best-effort, same convention
 *  as saveMetricColors). */
export function saveLevelColors(colors: LevelColorSet): void {
    try { localStorage.setItem(LEVEL_COLORS_KEY, JSON.stringify(colors)); } catch { /* ignore */ }
}
