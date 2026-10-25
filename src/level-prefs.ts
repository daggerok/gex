/// <reference lib="esnext" />
import { useSyncExternalStore } from 'react';
import type { CustomLevel } from './custom-levels';
import { DEFAULT_LEVEL_COLORS, loadLevelColors, saveLevelColors, type GexLevelKey, type LevelColorSet, type PriceLevelKey } from './gex-colors';
import { persistedChoice } from './persisted-choice';
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

/** Default ON selection: every level except DEFAULT_OFF_LEVELS (so Max / Min Net GEX, Gamma Flip,
 *  Max Pain and Spot). Reset restores it. */
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

// ---- the shared state: which built-in levels are on, and their colours ----

export interface LevelPrefs {
    selected: ToggleableLevelKey[];
    colors: LevelColorSet;
}

let prefs: LevelPrefs = { selected: [...DEFAULT_SELECTED_LEVELS], colors: loadLevelColors() };
const listeners = new Set<() => void>();
const publish = (next: LevelPrefs) => { prefs = next; listeners.forEach((l) => l()); };

export const getLevelPrefs = (): LevelPrefs => prefs;

export function toggleLevel(key: ToggleableLevelKey): void {
    publish({ ...prefs, selected: prefs.selected.includes(key) ? prefs.selected.filter((k) => k !== key) : [...prefs.selected, key] });
}

/** Sets a level's colour and remembers it in the browser (the same key as before, 'gex.levelColors.v1'). */
export function setLevelColor(key: ToggleableLevelKey, color: string): void {
    const colors = { ...prefs.colors, [key]: color };
    saveLevelColors(colors);
    publish({ ...prefs, colors });
}

/** Back to the default selection and the default colours. */
export function resetLevelPrefs(): void {
    saveLevelColors(DEFAULT_LEVEL_COLORS);
    publish({ selected: [...DEFAULT_SELECTED_LEVELS], colors: { ...DEFAULT_LEVEL_COLORS } });
    zeroGexDisplay.set(zeroGexDisplay.fallback);
    sigmaMode.set(sigmaMode.fallback);
}

export function useLevelPrefs(): LevelPrefs {
    return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, getLevelPrefs, getLevelPrefs);
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
