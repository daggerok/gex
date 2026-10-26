/// <reference lib="esnext" />
import { useSyncExternalStore } from 'react';
import { levelColorOf, type CustomLevel } from './custom-levels';
import { DEFAULT_LEVEL_COLORS, loadLevelColors, saveLevelColors, type GexLevelKey, type LevelColorSet, type PriceLevelKey } from './gex-colors';
import { persistedChoice } from './persisted-choice';
import type { LevelLabelItem } from './level-labels';
import type { GexLevels, SigmaLevel } from './types';

// ============================================================================
// LEVEL PREFERENCES - which GEX levels are shown and in which colours, shared by
// the GEX tab and the Chart tab (both show the same Levels panel), plus the order
// of the chips in that panel. The tables of keys moved here from GexView.tsx.
// ============================================================================

/** GexView.tsx's own toggleable-level key: every GexLevelKey, including the
 *  plain collapsed `gammaFlip` - Gamma Flip is one ordinary toggleable/
 *  colorable Key Level here, same as Max Net GEX/Min Net GEX/Max Pain (an earlier
 *  adaptive gammaFlipPos/gammaFlipNeg dual-display mechanism was removed). */
export type ToggleableLevelKey = GexLevelKey;

/** The 7 toggleable Key Levels (everything in GexLevels - see
 *  ToggleableLevelKey above; also gex-colors.ts's LevelColorSet).
 *  (Resistance 1.5 / Support 1.5 - `maxNetGex1_5`/`minNetGex1_5` - were removed
 *  entirely: the user found them not working out after shipping them.
 *  Removed here alongside the corresponding
 *  `GexLevels.maxNetGex1_5`/`minNetGex1_5` fields/math removal in
 *  src/gex.ts/src/types.ts, done in a separate PR.) `spot` is listed last
 *  here - its actual rendered position (toggle panel AND sidebar card) is
 *  decided by each one's own by-strike sort (see `levelPanelKeys`/
 *  `keyLevels` below), this array is just the base/reset order. */
export const ALL_LEVEL_KEYS: ToggleableLevelKey[] = ['maxNetGex', 'netGexPlus', 'gammaFlip', 'zeroGex', 'minNetGex', 'netGexMinus', 'sumNetGexPlus', 'sumNetGexMinus', 'maxPain', 'maxAbsGamma', 'sigma', 'spot'];

/** Levels that start OFF: the four outer levels (Net GEX+ / Net GEX- and 75% Sum Net GEX+ /
 *  75% Sum Net GEX-) and Sigma (owner 2026-10-25: off on both charts and in the Levels table until turned on). They stay
 *  one click away in the Levels panel like every other level. */
export const DEFAULT_OFF_LEVELS: ToggleableLevelKey[] = ['netGexPlus', 'netGexMinus', 'sumNetGexPlus', 'sumNetGexMinus', 'sigma'];

/** Default ON selection: every level except DEFAULT_OFF_LEVELS (so Max / Min Net GEX, Gamma Flip, Zero GEX,
 *  Max Pain, Max AG and Spot). A first visit starts with it and Reset restores it. */
export const DEFAULT_SELECTED_LEVELS: ToggleableLevelKey[] = ALL_LEVEL_KEYS.filter((k) => !DEFAULT_OFF_LEVELS.includes(k));

/** i18n key for each level's sidebar/toggle-panel label. */
export const LEVEL_LABEL_KEY: Record<ToggleableLevelKey, string> = {
    maxNetGex: 'gex.level.maxNetGex',
    netGexPlus: 'gex.level.netGexPlus',
    gammaFlip: 'gex.level.gammaFlip',
    zeroGex: 'gex.level.zeroGex',
    minNetGex: 'gex.level.minNetGex',
    netGexMinus: 'gex.level.netGexMinus',
    sumNetGexPlus: 'gex.level.sumNetGexPlus',
    sumNetGexMinus: 'gex.level.sumNetGexMinus',
    maxPain: 'gex.level.maxPain',
    maxAbsGamma: 'gex.level.maxAbsGamma',
    sigma: 'gex.level.sigma',
    // Reuses the plain 'spot.label' key ("Spot"/"Спот") already shown
    // elsewhere in this file (spot.label/spot.estimated/spot.delayed i18n
    // group) rather than inventing a parallel 'gex.level.spot' string.
    spot: 'spot.label',
};

/** Same as LEVEL_LABEL_KEY but for the <ReferenceLine> label on the chart
 *  (distinct from gex.level.* - the sidebar/toggle-panel text labels - so the
 *  two can read differently: the chart line stays short even when the
 *  sidebar label carries an "(R1)"/"(S1)" suffix). */
export const LEVEL_CHART_LABEL_KEY: Record<ToggleableLevelKey, string> = {
    maxNetGex: 'gex.chart.maxNetGex',
    netGexPlus: 'gex.chart.netGexPlus',
    gammaFlip: 'gex.chart.gammaFlip',
    zeroGex: 'gex.chart.zeroGex',
    minNetGex: 'gex.chart.minNetGex',
    netGexMinus: 'gex.chart.netGexMinus',
    sumNetGexPlus: 'gex.chart.sumNetGexPlus',
    sumNetGexMinus: 'gex.chart.sumNetGexMinus',
    maxPain: 'gex.chart.maxPain',
    maxAbsGamma: 'gex.chart.maxAbsGamma',
    sigma: 'gex.chart.sigma',
    // 'gex.chart.spot' used to read "Spot {{price}}" for the old always-on,
    // never-rotated, plain horizontal <ReferenceLine> label (which had room
    // to spell out the price inline). Now that Spot is just another rotated
    // diagonal Key Level label like the rest (see the ALL_LEVEL_KEYS render
    // loop below), it reads plain "Spot" - no value baked into the label
    // text, same as every other level's chart label.
    spot: 'gex.chart.spot',
};

/** i18n tooltip key (Part 4) for every Key Levels panel entry. */
export const LEVEL_TOOLTIP_KEY: Record<ToggleableLevelKey, string> = {
    maxNetGex: 'gex.level.tooltip.maxNetGex',
    netGexPlus: 'gex.level.tooltip.netGexPlus',
    gammaFlip: 'gex.level.tooltip.gammaFlip',
    zeroGex: 'gex.level.tooltip.zeroGex',
    minNetGex: 'gex.level.tooltip.minNetGex',
    netGexMinus: 'gex.level.tooltip.netGexMinus',
    sumNetGexPlus: 'gex.level.tooltip.sumNetGexPlus',
    sumNetGexMinus: 'gex.level.tooltip.sumNetGexMinus',
    maxPain: 'gex.level.tooltip.maxPain',
    maxAbsGamma: 'gex.level.tooltip.maxAbsGamma',
    // the % mode; the statistical mode has its own text with the expiration and the IV (LevelsPanel)
    sigma: 'gex.level.tooltip.sigmaPct',
    // Plain (non-estimated) case - see `levelTooltip` below for the
    // 'gex.level.tooltip.spotEstimated' variant used when the spot shown is
    // a put-call-parity estimate rather than the provider's own reported price.
    spot: 'gex.level.tooltip.spot',
};

/** The built-in levels in the order the panel falls back to when two have no price (see levelPanelOrder). */
const LEVEL_PANEL_BASE: ToggleableLevelKey[] = ['maxNetGex', 'netGexPlus', 'gammaFlip', 'zeroGex', 'spot', 'minNetGex', 'netGexMinus', 'sumNetGexPlus', 'sumNetGexMinus', 'maxPain', 'maxAbsGamma', 'sigma'];

/** The one price of a level (null without one). */
export function levelPrice(levels: GexLevels | null, key: PriceLevelKey): number | null {
    return levels?.[key] ?? null;
}

/** Where a level's chip sits in the panel: its price, and for Sigma (six strikes around spot) the spot itself. */
export function levelPanelValue(levels: GexLevels | null, key: ToggleableLevelKey): number | null {
    if (key === 'sigma') return levels?.sigma ? levels.spot : null;
    return levelPrice(levels, key);
}

/** One chip of the Levels panel: a built-in level (`builtin`) or one of the user's own (`custom`). */
export interface PanelEntry {
    /** a GexLevelKey, or `custom:<id>` */
    key: string;
    builtin: ToggleableLevelKey | null;
    custom: CustomLevel | null;
    value: number | null;
}

/**
 * The chips of the Levels panel, left to right. The user's own levels come FIRST (by price): the row is narrow and
 * scrolls, and a level placed by its price could end up out of sight at the far right where nobody finds it. Then the
 * built-in levels ascending by each level's live price, so the lowest strike is leftmost (a level with no price sinks to
 * the far right and keeps the base order among themselves). "Net GEX-" always sits before "75% Sum Net GEX-" (owner
 * request), the two swap places when the price sort would put them the other way. `hidden` levels get no chip (Max AG
 * while the AG metric is off).
 */
export function levelPanelOrder(levels: GexLevels | null, customLevels: readonly CustomLevel[] = [], hidden: readonly ToggleableLevelKey[] = []): PanelEntry[] {
    const sorted = LEVEL_PANEL_BASE.filter((k) => !hidden.includes(k)).sort((a, b) => {
        const va = levelPanelValue(levels, a);
        const vb = levelPanelValue(levels, b);
        if (va == null) return vb == null ? 0 : 1;
        if (vb == null) return -1;
        return va - vb;
    });
    const i = sorted.indexOf('netGexMinus');
    const j = sorted.indexOf('sumNetGexMinus');
    if (i > j && j >= 0) { sorted[j] = 'netGexMinus'; sorted[i] = 'sumNetGexMinus'; }
    const own: PanelEntry[] = [...customLevels]
        .sort((a, b) => a.price - b.price)
        .map((c) => ({ key: `custom:${c.id}`, builtin: null, custom: c, value: c.price }));
    return [...own, ...sorted.map((key): PanelEntry => ({ key, builtin: key, custom: null, value: levelPanelValue(levels, key) }))];
}

// ---- the shared state: which built-in levels are on, and their colours (both remembered in the browser) ----

export interface LevelPrefs {
    selected: ToggleableLevelKey[];
    colors: LevelColorSet;
}

/** localStorage key of the on/off state of the built-in levels: `{ [key]: boolean }` for every known level. */
export const SELECTED_LEVELS_KEY = 'gex.selectedLevels.v1';

/**
 * The selection from a stored `{ [key]: boolean }` map, in ALL_LEVEL_KEYS order. Migration-safe: a level missing from
 * the map (a visit before this key existed, or a level added later) takes its default (DEFAULT_SELECTED_LEVELS),
 * unknown keys and non-boolean values are ignored, anything unreadable gives the defaults. Pure, for tests.
 */
export function parseSelectedLevels(raw: string | null): ToggleableLevelKey[] {
    let saved: Record<string, unknown> = {};
    try {
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
    } catch { /* unreadable: defaults */ }
    return ALL_LEVEL_KEYS.filter((k) => (typeof saved[k] === 'boolean' ? saved[k] === true : DEFAULT_SELECTED_LEVELS.includes(k)));
}

/** The stored selection, or the defaults when there is none (or storage is blocked). */
export function loadSelectedLevels(): ToggleableLevelKey[] {
    try {
        return parseSelectedLevels(localStorage.getItem(SELECTED_LEVELS_KEY));
    } catch {
        return [...DEFAULT_SELECTED_LEVELS];
    }
}

/** Remembers the on/off state of every known level (best-effort, like saveLevelColors). */
export function saveSelectedLevels(selected: readonly ToggleableLevelKey[]): void {
    const map: Record<string, boolean> = {};
    for (const k of ALL_LEVEL_KEYS) map[k] = selected.includes(k);
    try { localStorage.setItem(SELECTED_LEVELS_KEY, JSON.stringify(map)); } catch { /* ignore, the choice still holds for this page */ }
}

let prefs: LevelPrefs = { selected: loadSelectedLevels(), colors: loadLevelColors() };
const listeners = new Set<() => void>();
const publish = (next: LevelPrefs) => { prefs = next; listeners.forEach((l) => l()); };

export const getLevelPrefs = (): LevelPrefs => prefs;

/** Turns a level on or off and remembers the selection in the browser (SELECTED_LEVELS_KEY). */
export function toggleLevel(key: ToggleableLevelKey): void {
    const selected = prefs.selected.includes(key) ? prefs.selected.filter((k) => k !== key) : [...prefs.selected, key];
    saveSelectedLevels(selected);
    publish({ ...prefs, selected });
}

/** Sets a level's colour and remembers it in the browser (the same key as before, 'gex.levelColors.v1'). */
export function setLevelColor(key: ToggleableLevelKey, color: string): void {
    const colors = { ...prefs.colors, [key]: color };
    saveLevelColors(colors);
    publish({ ...prefs, colors });
}

/** Back to the default selection and the default colours (both remembered as such). */
export function resetLevelPrefs(): void {
    saveLevelColors(DEFAULT_LEVEL_COLORS);
    saveSelectedLevels(DEFAULT_SELECTED_LEVELS);
    publish({ selected: [...DEFAULT_SELECTED_LEVELS], colors: { ...DEFAULT_LEVEL_COLORS } });
    zeroGexDisplay.set(zeroGexDisplay.fallback);
    sigmaMode.set(sigmaMode.fallback);
}

/** One subscribe function for every reader: an inline one made React resubscribe on every render. */
const subscribeLevelPrefs = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useLevelPrefs(): LevelPrefs {
    return useSyncExternalStore(subscribeLevelPrefs, getLevelPrefs, getLevelPrefs);
}

/** How the Zero GEX level is drawn on both charts (the switch inside its Levels chip): `line` at `GexLevels.zeroGex` (the
 *  first strike of the other sign, default) or `area`, the band `GexLevels.zeroGexZone`. Remembered in the browser. */
export type ZeroGexDisplay = 'line' | 'area';
export const zeroGexDisplay = persistedChoice<ZeroGexDisplay>('gex.zeroGexDisplay.v1', ['line', 'area'], 'line');

/** Which Sigma levels are drawn (the switch inside the Sigma chip): `pct` = strikes nearest to spot +/- 1, 2, 3 % (default),
 *  `stat` = statistical sigma from the ATM IV of the nearest selected expiration (computeSigmaLevels in gex.ts). */
export type SigmaMode = 'pct' | 'stat';
export const sigmaMode = persistedChoice<SigmaMode>('gex.sigmaMode.v1', ['pct', 'stat'], 'pct');

/** One drawn Sigma level: a unique key (`sigma:+1`), its strike and its label text. */
export interface SigmaLine {
    key: string;
    strike: number;
    /** "1σ", "2σ", "3σ" in both modes (the chip and its tooltip say which mode) */
    text: string;
    level: SigmaLevel;
}

/** The Sigma levels of the chosen mode, highest strike first (the Levels table order); none when the mode has no data. */
export function sigmaLines(levels: GexLevels | null, mode: SigmaMode): SigmaLine[] {
    const ladder = mode === 'stat' ? levels?.sigma?.stat : levels?.sigma?.pct;
    if (!ladder) return [];
    return ladder
        .map((l) => ({ key: `sigma:${l.side > 0 ? '+' : '-'}${l.n}`, strike: l.strike, text: `${l.n}σ`, level: l }))
        .sort((a, b) => b.strike - a.strike || a.level.n - b.level.n);
}

/**
 * Why the Gamma Flip is not shown, for its tooltips in the Levels panel and the Levels table: too little usable IV near
 * spot, or a futures-priced symbol with no sweep (GEX-H5). Empty when it is shown.
 */
export function gammaFlipUnavailableText(levels: GexLevels | null | undefined, tr: (key: string, params?: Record<string, string | number>) => string): string {
    if (levels?.gammaFlipUnavailable === 'futuresPriced') return tr('gex.level.tooltip.gammaFlipFutures');
    if (levels?.gammaFlipUnavailable === 'ivCoverage') return tr('gex.level.tooltip.gammaFlipNoIv', { pct: `${Math.round((levels.gammaFlipIvCoverage ?? 0) * 100)}%` });
    return '';
}

/**
 * The level labels to draw (the GEX chart's level names, the Board's strike marks): every selected level with a price, in
 * ALL_LEVEL_KEYS order, Max AG only while the AG metric is on, the six Sigma strikes of the chosen mode (1σ / 2σ / 3σ),
 * then the visible custom levels. Grouping them by price is level-labels.ts's job.
 */
export function levelLabelItems(opts: {
    levels: GexLevels | null;
    selected: readonly ToggleableLevelKey[];
    colors: LevelColorSet;
    showMaxAg: boolean;
    sigma: SigmaMode;
    label: (key: ToggleableLevelKey) => string;
    customLevels?: readonly CustomLevel[];
}): LevelLabelItem[] {
    const out: LevelLabelItem[] = [];
    for (const key of ALL_LEVEL_KEYS) {
        if (!opts.selected.includes(key)) continue;
        if (key === 'maxAbsGamma' && !opts.showMaxAg) continue;
        if (key === 'sigma') {
            for (const l of sigmaLines(opts.levels, opts.sigma)) out.push({ key: l.key, value: l.strike, text: l.text, color: opts.colors.sigma });
            continue;
        }
        const value = levelPrice(opts.levels, key);
        if (value == null) continue;
        out.push({ key, value, text: opts.label(key), color: opts.colors[key] });
    }
    for (const c of opts.customLevels ?? []) {
        if (c.hidden) continue;
        out.push({ key: `custom:${c.id}`, value: c.price, text: c.name, color: levelColorOf(c) });
    }
    return out;
}
